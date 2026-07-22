#!/usr/bin/env node
/**
 * Validates that .env.example stays complete and well-formed against each
 * app's declared environment schema. Run after `npm run build`.
 */
import { readFileSync } from 'node:fs';
import { loadEnv, baseSchema } from '../packages/env/dist/index.js';
import { apiEnvSchema } from '../apps/api/dist/env.js';

function parseDotEnv(path) {
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) {
      throw new Error(`Malformed line in ${path}: ${line}`);
    }
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const example = parseDotEnv(new URL('../.env.example', import.meta.url).pathname);

const checks = [
  ['base', baseSchema],
  ['apps/api', apiEnvSchema],
];

let failed = false;
for (const [name, schema] of checks) {
  try {
    loadEnv(schema, example);
    console.log(`.env.example satisfies ${name} schema`);
  } catch (err) {
    failed = true;
    console.error(`.env.example fails ${name} schema:\n${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
