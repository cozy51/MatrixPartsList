/**
 * Cloudflare Access が付けたJWT（`Cf-Access-Jwt-Assertion` ヘッダー、または `CF_Authorization` Cookie）を検証する。
 *
 * workers.dev で公開するため、Access側の設定だけに頼らず、Worker自身も次の場合は必ず拒否する（設定漏れでも閉じたままにする）。
 * - Accessの設定（チームドメイン・AUD・公開ホスト名）が1つでも欠けている
 * - 公開ホスト名（`APP_HOST`）以外へのリクエスト（プレビューURL `<版>-<Worker名>.<サブドメイン>.workers.dev` など）
 * - JWTがない・署名が正しくない・別のAccessアプリ向け・期限切れ・発行元が違う
 */
export type AccessEnv = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** 公開するホスト名（例: matrix-parts-list.<サブドメイン>.workers.dev）。これ以外のホストは拒否する。 */
  APP_HOST?: string;
  ALLOW_UNAUTHENTICATED?: string;
  DEV_USER_EMAIL?: string;
};

/** ローカル開発（wrangler dev）のホスト。開発用の認証の省略は、ここからのリクエストにだけ効かせる。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const normalizeHost = (value: string | undefined) => (value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

type Jwk = JsonWebKey & { kid?: string };
let certCache: { domain: string; keys: Jwk[]; at: number } | null = null;

async function accessKeys(domain: string, force = false): Promise<Jwk[]> {
  if (!force && certCache && certCache.domain === domain && Date.now() - certCache.at < 60 * 60 * 1000) return certCache.keys;
  const r = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!r.ok) throw Error('Cloudflare Accessの公開鍵を取得できませんでした。');
  const keys = ((await r.json()) as { keys?: Jwk[] }).keys ?? [];
  certCache = { domain, keys, at: Date.now() };
  return keys;
}

const base64UrlBytes = (value: string) => {
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(text, c => c.charCodeAt(0));
};
const base64UrlJson = <T>(value: string): T => JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;

const cookieValue = (header: string | null, name: string) =>
  header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);

/** Accessが付けたJWTを検証し、利用者のメールアドレスを返す。検証できなければ例外にする。 */
export async function authenticate(request: Request, env: AccessEnv): Promise<string> {
  const host = new URL(request.url).hostname.toLowerCase();
  /* 開発用の省略は、設定を本番へ持ち込んでもlocalhost以外では効かない。 */
  if (env.ALLOW_UNAUTHENTICATED === 'true' && LOCAL_HOSTS.has(host)) return env.DEV_USER_EMAIL || 'dev@localhost';
  const domain = normalizeHost(env.ACCESS_TEAM_DOMAIN), aud = (env.ACCESS_AUD || '').trim(), appHost = normalizeHost(env.APP_HOST);
  if (!domain || !aud || !appHost) throw Error('Cloudflare Accessの設定（ACCESS_TEAM_DOMAIN・ACCESS_AUD・APP_HOST）がありません。');
  /* プレビューURLや別のホストからは、JWTの有無にかかわらず使わせない。 */
  if (host !== appHost) throw Error('このURLからは利用できません。');
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookieValue(request.headers.get('Cookie'), 'CF_Authorization');
  if (!token) throw Error('ログインが必要です。ページを再読み込みしてください。');
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature) throw Error('ログイン情報が正しくありません。');
  let header: { alg?: string; kid?: string };
  try { header = base64UrlJson(head); } catch { throw Error('ログイン情報が正しくありません。'); }
  if (header.alg !== 'RS256') throw Error('ログイン情報が正しくありません。');
  let jwk = (await accessKeys(domain)).find(key => key.kid === header.kid);
  /* 鍵は定期的に入れ替わるため、見つからなければ取り直す。 */
  if (!jwk) jwk = (await accessKeys(domain, true)).find(key => key.kid === header.kid);
  if (!jwk) throw Error('ログイン情報を確認できませんでした。');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlBytes(signature), new TextEncoder().encode(`${head}.${body}`));
  if (!ok) throw Error('ログイン情報を確認できませんでした。');
  const claims = base64UrlJson<{ aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string; common_name?: string }>(body);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) throw Error('このアプリへのログインではありません。');
  if (claims.iss !== `https://${domain}`) throw Error('ログイン情報の発行元が違います。');
  if (claims.nbf && claims.nbf * 1000 > Date.now() + 60_000) throw Error('ログイン情報がまだ有効ではありません。');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw Error('ログインの有効期限が切れました。ページを再読み込みしてください。');
  return claims.email || claims.common_name || '';
}
