#!/usr/bin/env node
/**
 * One-command development preview: starts the API and the web app together.
 * Usage: npm run dev   (then open http://localhost:3100)
 * Synthetic identities only — no real logins, no real data.
 */
import { spawn } from 'node:child_process';

const API_PORT = process.env.API_PORT ?? '3000';
const WEB_PORT = process.env.WEB_PORT ?? '3100';

function start(name, script, env) {
  const child = spawn('node', [script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => {
    console.error(`${name} exited (${code}); shutting down.`);
    process.exit(code ?? 1);
  });
  return child;
}

const api = start('api', 'apps/api/dist/main.js', { API_PORT });
const web = start('web', 'apps/web/dist/main.js', {
  WEB_PORT,
  API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
});

setTimeout(() => {
  console.log('');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Armada Excellence OS (development preview)`);
  console.log(`  Open:  http://localhost:${WEB_PORT}`);
  console.log('');
  console.log('  Sign in with a synthetic user (no password):');
  console.log('    executive@dev.armada.example        — executive scorecard');
  console.log('    quality@dev.armada.example          — compliance, identity review');
  console.log('    nurse.akron@dev.armada.example      — clinical view, Akron');
  console.log('    ur.akron@dev.armada.example         — utilization review queue');
  console.log('    bht.akron@dev.armada.example        — BHT view, lineup, library');
  console.log('    sysadmin@dev.armada.example         — connector administration');
  console.log('    privacy@dev.armada.example          — audit + identity review');
  console.log('  Ctrl+C stops both servers.');
  console.log('────────────────────────────────────────────────────────────');
}, 1500);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    api.kill();
    web.kill();
    process.exit(0);
  });
}
