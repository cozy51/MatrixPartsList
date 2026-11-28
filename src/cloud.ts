import type { AppData } from './types';
import type { DrawingData } from './drawings';
import type { UnitBaseData } from './unitbase';

/**
 * Cloudflare（Workers + D1 + R2）との同期。
 *
 * ログインはCloudflare Accessが画面を開く前に済ませるため、アプリでは認証の画面を出さない。
 * Accessのログインが切れているとAPIはAccessのログイン画面へリダイレクトするため、
 * リダイレクトを追わずに「再読み込みしてください」と知らせる。
 */
export class CloudError extends Error { constructor(message: string, readonly status = 0) { super(message); } }
const EXPIRED = 'ログインの有効期限が切れました。ページを再読み込みしてログインし直してください。';

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  let r: Response;
  try { r = await fetch(path, { ...init, credentials: 'same-origin', redirect: 'manual' }); }
  catch { throw new CloudError('サーバーに接続できませんでした。ネットワークを確認してください。'); }
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) throw new CloudError(EXPIRED, r.status || 401);
  return r;
}
async function failure(r: Response, message: string): Promise<CloudError> {
  let detail = '';
  try { detail = ((await r.json()) as { error?: string }).error || ''; } catch { /* 本文がJSONでないときは状態コードだけ出す。 */ }
  return new CloudError(`${message}（${r.status}${detail ? `: ${detail}` : ''}）`, r.status);
}

let user = '';
/** Accessでログイン済みか確かめ、利用者のメールアドレスを返す。 */
export async function checkSession(): Promise<string> {
  const r = await api('/api/me');
  if (!r.ok) throw await failure(r, 'ログイン状態を確認できませんでした。');
  user = ((await r.json()) as { email?: string }).email || '';
  return user;
}
export const signedInUser = () => user;

/** 保存する文書。Drive時代のファイル（MatrixPartsList-latest.json など）に1対1で対応する。 */
type DocName = 'data' | 'drawings' | 'unitbase';
async function readDoc<T>(name: DocName): Promise<{ id?: string; data?: T }> {
  const r = await api(`/api/docs/${name}`, { cache: 'no-store' });
  if (r.status === 404) return {};
  if (!r.ok) throw await failure(r, 'クラウドのデータを読み込めませんでした。');
  return { id: name, data: (await r.json()) as T };
}
async function writeDoc(name: DocName, data: unknown): Promise<string> {
  const r = await api(`/api/docs/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw await failure(r, 'クラウドへの保存に失敗しました。');
  return name;
}

/* 呼ぶ側はDrive時代と同じ形（ファイルIDを受け取って返す）で使えるようにしている。IDは文書名。 */
export const readCloud = () => readDoc<AppData>('data');
export const writeCloud = (data: AppData, _id?: string) => writeDoc('data', data);
export const readCloudDrawings = () => readDoc<DrawingData>('drawings');
export const writeCloudDrawings = (data: DrawingData, _id?: string) => writeDoc('drawings', data);
export const readCloudUnitBase = () => readDoc<UnitBaseData>('unitbase');
export const writeCloudUnitBase = (data: UnitBaseData, _id?: string) => writeDoc('unitbase', data);

/**
 * 画像をR2へ `fileName`（品番.png）で保存し、登録に使うID（`r2:品番.png`）を返す。
 * 同名の画像があれば上書きする（IDは変わらない）。
 */
export async function uploadImageFile(fileName: string, image: Blob): Promise<{ id: string; replaced: boolean }> {
  const r = await api(`/api/images/${encodeURIComponent(fileName)}`, { method: 'PUT', headers: { 'Content-Type': image.type || 'image/png' }, body: image });
  if (!r.ok) throw await failure(r, '画像の保存に失敗しました。');
  return (await r.json()) as { id: string; replaced: boolean };
}

/** R2の画像を削除する。`fileName` は `品番.png`（`r2:` は付けない）。もう無いときも成功とみなす。 */
export async function deleteImageFile(fileName: string): Promise<void> {
  const r = await api(`/api/images/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw await failure(r, `${fileName} を削除できませんでした。`);
}

/** R2に保存している画像のファイル名（`品番.png`）の一覧。 */
export async function listImageFiles(): Promise<string[]> {
  const r = await api('/api/images', { cache: 'no-store' });
  if (!r.ok) throw await failure(r, '画像の一覧を取得できませんでした。');
  return ((await r.json()) as { names?: string[] }).names ?? [];
}
