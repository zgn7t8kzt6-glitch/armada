#!/usr/bin/env node
/**
 * Dependency-free secret scan for git-tracked files (see ADR-0003, SECURITY.md).
 * Patterns are deliberately high-confidence: a hit is a build failure, so
 * false positives must be near zero. Platform-level secret scanning and a
 * dedicated scanner can be layered on later; this gate always runs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained PAT', regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI-style API key', regex: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', regex: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Azure connection string', regex: /AccountKey=[A-Za-z0-9+/=]{40,}/ },
];

const SKIP_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'pdf', 'woff', 'woff2', 'zip']);
const SKIP_FILES = new Set(['scripts/check-secrets.mjs']);

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !SKIP_FILES.has(f))
  .filter((f) => !SKIP_EXTENSIONS.has(f.split('.').pop()?.toLowerCase() ?? ''));

const findings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, regex } of PATTERNS) {
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (regex.test(line)) {
        // Report location only — never echo the matched value.
        findings.push(`${file}:${i + 1}: possible ${name}`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error('Secret scan FAILED. Rotate any real credential immediately; git history retains it.');
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files).`);
