import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticate } from './access';

const DOMAIN = 'team.cloudflareaccess.com', AUD = 'aud-123';
const env = { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD };
let keys: CryptoKeyPair, jwk: JsonWebKey & { kid?: string };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const part = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
async function sign(claims: Record<string, unknown>, kid = 'k1', key = keys.privateKey) {
  const head = part({ alg: 'RS256', kid }), body = part(claims);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(signature)}`;
}
const request = (token?: string, cookie = false) =>
  new Request('https://parts.example.com/api/me', { headers: token ? (cookie ? { Cookie: `a=b; CF_Authorization=${token}` } : { 'Cf-Access-Jwt-Assertion': token }) : {} });
const valid = () => ({ aud: [AUD], iss: `https://${DOMAIN}`, exp: Math.floor(Date.now() / 1000) + 600, email: 'user@example.com' });

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey) as JsonWebKey), kid: 'k1' };
});
afterEach(() => vi.unstubAllGlobals());
const stubCerts = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));

describe('Cloudflare AccessのJWT検証', () => {
  it('正しいJWTなら利用者のメールアドレスを返す（ヘッダー・Cookieのどちらでも）', async () => {
    stubCerts();
    const token = await sign(valid());
    await expect(authenticate(request(token), env)).resolves.toBe('user@example.com');
    await expect(authenticate(request(token, true), env)).resolves.toBe('user@example.com');
  });
  it('JWTがない・期限切れ・別アプリ・署名違いは拒否する', async () => {
    stubCerts();
    await expect(authenticate(request(), env)).rejects.toThrow('ログインが必要');
    await expect(authenticate(request(await sign({ ...valid(), exp: 1 })), env)).rejects.toThrow('有効期限');
    await expect(authenticate(request(await sign({ ...valid(), aud: ['other'] })), env)).rejects.toThrow('このアプリ');
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    await expect(authenticate(request(await sign(valid(), 'k1', other.privateKey)), env)).rejects.toThrow('確認できませんでした');
  });
  it('設定がなければ拒否し、ローカル開発の指定があるときだけ通す', async () => {
    await expect(authenticate(request(), {})).rejects.toThrow('ACCESS_TEAM_DOMAIN');
    await expect(authenticate(request(), { ALLOW_UNAUTHENTICATED: 'true', DEV_USER_EMAIL: 'dev@example.com' })).resolves.toBe('dev@example.com');
  });
});
