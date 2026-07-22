#!/usr/bin/env node
/**
 * Hosted launcher: runs the API (internal) and the web app (public $PORT)
 * in one service — used by the Render deployment.
 *
 * This deployment always runs in STAGING mode with synthetic data, even if
 * the host sets NODE_ENV=production: true production mode disables the dev
 * identity provider and all synthetic seeds, and is gated on the blueprint
 * §35 production-readiness checklist (BAAs, SSO+MFA, pen test, sign-offs).
 * Until that gate is signed, a hosted instance is a demo — and says so.
 */
import { spawn } from 'node:child_process';

const publicPort = process.env.PORT ?? process.env.WEB_PORT ?? '3100';
const apiPort = process.env.INTERNAL_API_PORT ?? '4000';

if (process.env.NODE_ENV === 'production') {
  console.log(
    '[start] NODE_ENV=production requested, but the §35 production-readiness gate is not signed; ' +
      'running in staging (demo) mode with synthetic data only.',
  );
}

function start(name, script, env) {
  const child = spawn('node', [script], {
    env: { ...process.env, ...env, NODE_ENV: 'staging' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    console.error(`[start] ${name} exited (${code}); shutting down.`);
    process.exit(code ?? 1);
  });
  return child;
}

const api = start('api', 'apps/api/dist/main.js', {
  API_PORT: apiPort,
  API_HOST: '127.0.0.1',
});
const web = start('web', 'apps/web/dist/main.js', {
  WEB_PORT: publicPort,
  WEB_HOST: '0.0.0.0',
  API_BASE_URL: `http://127.0.0.1:${apiPort}`,
});

console.log(`[start] Armada Excellence OS (staging demo) — web on :${publicPort}, api internal on :${apiPort}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    api.kill();
    web.kill();
    process.exit(0);
  });
}
