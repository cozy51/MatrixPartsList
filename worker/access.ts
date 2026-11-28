/**
 * Cloudflare Access が付けたJWT（`Cf-Access-Jwt-Assertion` ヘッダー、または `CF_Authorization` Cookie）を検証する。
 * Accessの外（workers.dev や別のルート）から直接呼ばれても、正しいJWTがなければAPIを使えないようにするため。
 */
export type AccessEnv = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_UNAUTHENTICATED?: string;
  DEV_USER_EMAIL?: string;
};

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
  if (env.ALLOW_UNAUTHENTICATED === 'true') return env.DEV_USER_EMAIL || 'dev@localhost';
  const domain = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''), aud = env.ACCESS_AUD || '';
  if (!domain || !aud) throw Error('Cloudflare Accessの設定（ACCESS_TEAM_DOMAIN・ACCESS_AUD）がありません。');
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookieValue(request.headers.get('Cookie'), 'CF_Authorization');
  if (!token) throw Error('ログインが必要です。ページを再読み込みしてください。');
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature) throw Error('ログイン情報が正しくありません。');
  const header = base64UrlJson<{ alg?: string; kid?: string }>(head);
  if (header.alg !== 'RS256') throw Error('ログイン情報が正しくありません。');
  let jwk = (await accessKeys(domain)).find(key => key.kid === header.kid);
  /* 鍵は定期的に入れ替わるため、見つからなければ取り直す。 */
  if (!jwk) jwk = (await accessKeys(domain, true)).find(key => key.kid === header.kid);
  if (!jwk) throw Error('ログイン情報を確認できませんでした。');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlBytes(signature), new TextEncoder().encode(`${head}.${body}`));
  if (!ok) throw Error('ログイン情報を確認できませんでした。');
  const claims = base64UrlJson<{ aud?: string | string[]; exp?: number; iss?: string; email?: string; common_name?: string }>(body);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) throw Error('このアプリへのログインではありません。');
  if (claims.iss && claims.iss !== `https://${domain}`) throw Error('ログイン情報の発行元が違います。');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw Error('ログインの有効期限が切れました。ページを再読み込みしてください。');
  return claims.email || claims.common_name || '';
}
