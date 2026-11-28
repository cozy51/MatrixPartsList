import { authenticate } from './access';
import { splitChunks } from './chunks';

/**
 * Matrix Parts List の API（Cloudflare Workers）。
 *
 * - 画面（dist）もAPI（`/api/*`）も、すべてのリクエストをまずこのコードで受け、Cloudflare AccessのJWTを
 *   検証してから返す（`wrangler.jsonc` の `run_worker_first: true`）。Access側の設定が漏れていても、
 *   ログインしていない人には画面そのものを返さない。
 * - 部品表・図面リンク・UnitBaseは、これまでGoogle Driveに置いていたJSONと同じ単位でD1へ保存する。
 * - アプリから保存する3Dモデルの画像はR2へ保存する（既存のDrive画像はファイルIDのまま表示する）。
 * - ログインはCloudflare Accessに任せ、ここではAccessが付けたJWTを検証して利用者を確かめる。
 */
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  /** Cloudflare Accessのチームドメイン（例: example.cloudflareaccess.com）。 */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare AccessのアプリケーションのAUDタグ。 */
  ACCESS_AUD?: string;
  /** 公開するホスト名（例: matrix-parts-list.<サブドメイン>.workers.dev）。 */
  APP_HOST?: string;
  /** ローカル開発専用。`true` のときはAccessの確認をしない。 */
  ALLOW_UNAUTHENTICATED?: string;
  DEV_USER_EMAIL?: string;
}

/** 保存できる文書。名前はDriveのファイル名に対応する。 */
const DOC_NAMES = new Set(['data', 'drawings', 'unitbase']);
/** 1文書の上限（UnitBaseが約2MBのため、余裕を持たせる）。 */
const MAX_DOC_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** R2に置く画像のファイル名（品番.png）。パス区切りや制御文字は受け付けない。 */
const IMAGE_NAME = /^[^/\\\u0000-\u001f]{1,200}\.(png|jpe?g|webp|gif)$/i;
const IMAGE_PREFIX = 'models/';

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const fail = (status: number, message: string) => json({ error: message }, status);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** 画面へのアクセスを断るページ。アプリの中身（画面のファイル）は一切返さない。 */
const denied = (message: string) => new Response(
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>アクセスできません</title></head>`
  + `<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#2d3748"><h1 style="font-size:20px">Matrix Parts List にアクセスできません</h1>`
  + `<p>${escapeHtml(message)}</p><p>Cloudflare Accessでログインできる正しいURLから開いてください。</p></body></html>`,
  { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), isApi = url.pathname.startsWith('/api/');
    let user: string;
    try { user = await authenticate(request, env); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'ログインが必要です。';
      return isApi ? fail(401, message) : denied(message);
    }
    if (!isApi) return env.ASSETS.fetch(request);
    try { return await route(request, env, url, user); }
    catch (error) {
      console.error(error);
      return fail(500, error instanceof Error ? error.message : 'サーバーでエラーが発生しました。');
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL, user: string): Promise<Response> {
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
  const [kind, name] = parts;
  if (kind === 'me' && parts.length === 1 && request.method === 'GET') return json({ email: user });
  if (kind === 'docs' && parts.length === 2) {
    if (!DOC_NAMES.has(name)) return fail(404, '文書が見つかりません。');
    if (request.method === 'GET') return readDoc(env.DB, name);
    if (request.method === 'PUT') return writeDoc(env.DB, name, request, user);
    return fail(405, '使えない操作です。');
  }
  if (kind === 'images' && parts.length === 1 && request.method === 'GET') return listImages(env.IMAGES);
  if (kind === 'images' && parts.length === 2) {
    if (!IMAGE_NAME.test(name)) return fail(400, '画像のファイル名が正しくありません。');
    if (request.method === 'GET' || request.method === 'HEAD') return readImage(env.IMAGES, name, request, url);
    if (request.method === 'PUT') return writeImage(env.IMAGES, name, request, user);
    if (request.method === 'DELETE') { await env.IMAGES.delete(IMAGE_PREFIX + name); return json({ deleted: `r2:${name}` }); }
    return fail(405, '使えない操作です。');
  }
  return fail(404, 'APIが見つかりません。');
}

/* ---------- 文書（D1） ---------- */

async function readDoc(db: D1Database, name: string): Promise<Response> {
  const meta = await db.prepare('SELECT chunks, updated_at, updated_by FROM docs WHERE name = ?').bind(name).first<{ chunks: number; updated_at: string; updated_by: string }>();
  if (!meta) return fail(404, 'まだ保存されていません。');
  const rows = await db.prepare('SELECT body FROM doc_chunks WHERE name = ? ORDER BY seq').bind(name).all<{ body: string }>();
  if (rows.results.length !== meta.chunks) return fail(500, '保存データが壊れています。もう一度保存してください。');
  return new Response(rows.results.map(row => row.body).join(''), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Updated-At': meta.updated_at, 'X-Updated-By': encodeURIComponent(meta.updated_by) },
  });
}

async function writeDoc(db: D1Database, name: string, request: Request, user: string): Promise<Response> {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_DOC_BYTES) return fail(413, 'データが大きすぎます。');
  const text = await request.text();
  if (text.length > MAX_DOC_BYTES) return fail(413, 'データが大きすぎます。');
  /* 数MBのJSONを丸ごと解析するとWorkerのCPU時間の上限（無料プランは10ms）に触れるため、形だけ確かめる。
     書き込むのはログイン済みの利用者のアプリだけで、中身はアプリ側で作ったJSON。 */
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return fail(400, 'JSONとして読めないデータは保存できません。');
  const chunks = splitChunks(text), now = new Date().toISOString();
  /* batchは1つのトランザクションで実行されるため、途中で失敗しても古い内容が残る。 */
  await db.batch([
    db.prepare('DELETE FROM doc_chunks WHERE name = ?').bind(name),
    ...chunks.map((body, seq) => db.prepare('INSERT INTO doc_chunks (name, seq, body) VALUES (?, ?, ?)').bind(name, seq, body)),
    db.prepare('INSERT INTO docs (name, chunks, size, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET chunks = excluded.chunks, size = excluded.size, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(name, chunks.length, text.length, now, user),
  ]);
  return json({ name, updatedAt: now });
}

/* ---------- 画像（R2） ---------- */

async function readImage(bucket: R2Bucket, name: string, request: Request, url: URL): Promise<Response> {
  const object = await bucket.get(IMAGE_PREFIX + name, { onlyIf: request.headers });
  if (!object) return fail(404, '画像が見つかりません。');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  /* `?v=` 付き（登録の更新日時）は中身が変わらないため長く持たせる。付いていなければ毎回確かめる。 */
  headers.set('Cache-Control', url.searchParams.has('v') ? 'private, max-age=31536000, immutable' : 'private, no-cache');
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

/** 保存している画像のファイル名（品番.png）の一覧。使われていない画像を探すために使う。 */
async function listImages(bucket: R2Bucket): Promise<Response> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: IMAGE_PREFIX, cursor, limit: 1000 });
    for (const object of page.objects) names.push(object.key.slice(IMAGE_PREFIX.length));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ names });
}

async function writeImage(bucket: R2Bucket, name: string, request: Request, user: string): Promise<Response> {
  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('image/')) return fail(415, '画像だけを保存できます。');
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, '画像が空です。');
  if (body.byteLength > MAX_IMAGE_BYTES) return fail(413, '画像が大きすぎます（10MBまで）。');
  const key = IMAGE_PREFIX + name;
  const replaced = !!(await bucket.head(key));
  await bucket.put(key, body, { httpMetadata: { contentType: type }, customMetadata: { uploadedBy: user } });
  return json({ id: `r2:${name}`, replaced });
}
