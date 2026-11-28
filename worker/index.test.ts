import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

/* 認証を通らないリクエストには、画面のファイル（ASSETS）もAPIも一切返さないことを確かめる。 */
const makeEnv = (vars: Partial<Env> = {}) => {
  const assets = vi.fn(async () => new Response('<html>app</html>'));
  return { env: { DB: {} as D1Database, IMAGES: {} as R2Bucket, ASSETS: { fetch: assets } as unknown as Fetcher, ...vars } as Env, assets };
};
const call = (url: string, env: Env) => worker.fetch(new Request(url), env);

describe('Workerの入口', () => {
  it('設定がないまま公開しても、画面を返さず403にする', async () => {
    const { env, assets } = makeEnv();
    const r = await call('https://matrix-parts-list.example.workers.dev/', env);
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain('app');
    expect(assets).not.toHaveBeenCalled();
  });
  it('JWTのない画面・APIへのリクエストは拒否する', async () => {
    const { env, assets } = makeEnv({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', APP_HOST: 'matrix-parts-list.example.workers.dev' });
    expect((await call('https://matrix-parts-list.example.workers.dev/index.html', env)).status).toBe(403);
    expect((await call('https://matrix-parts-list.example.workers.dev/assets/index.js', env)).status).toBe(403);
    expect((await call('https://matrix-parts-list.example.workers.dev/api/docs/data', env)).status).toBe(401);
    expect(assets).not.toHaveBeenCalled();
  });
  it('本番の設定に開発用の省略が紛れ込んでも、workers.devでは効かない', async () => {
    const { env, assets } = makeEnv({ ALLOW_UNAUTHENTICATED: 'true', APP_HOST: 'matrix-parts-list.example.workers.dev' });
    expect((await call('https://matrix-parts-list.example.workers.dev/', env)).status).toBe(403);
    expect(assets).not.toHaveBeenCalled();
  });
  it('ローカル開発（localhost）では画面を返す', async () => {
    const { env, assets } = makeEnv({ ALLOW_UNAUTHENTICATED: 'true' });
    expect((await call('http://localhost:8787/', env)).status).toBe(200);
    expect(assets).toHaveBeenCalledOnce();
  });
});
