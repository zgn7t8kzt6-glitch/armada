#!/usr/bin/env node
/**
 * Dependency-free formatting gate (see ADR-0003).
 * Enforces the .editorconfig basics on git-tracked text files:
 *   - LF line endings (no CRLF)
 *   - no trailing whitespace (markdown exempt — trailing spaces are hard breaks)
 *   - file ends with exactly one final newline
 *   - no tab indentation (tabs allowed only in Makefiles)
 * The frozen legacy/ tree and binary assets are excluded.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXCLUDED_PREFIXES = ['legacy/'];
const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'pdf', 'woff', 'woff2', 'zip']);

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)))
  .filter((f) => !BINARY_EXTENSIONS.has(f.split('.').pop()?.toLowerCase() ?? ''));

const problems = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (content.length === 0) continue;
  if (content.includes('\r')) {
    problems.push(`${file}: CRLF line endings (use LF)`);
  }
  if (!content.endsWith('\n')) {
    problems.push(`${file}: missing final newline`);
  } else if (content.endsWith('\n\n')) {
    problems.push(`${file}: multiple trailing newlines`);
  }
  const isMarkdown = file.endsWith('.md');
  const isMakefile = /(^|\/)Makefile$/.test(file);
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (!isMarkdown && /[ \t]+$/.test(line)) {
      problems.push(`${file}:${i + 1}: trailing whitespace`);
    }
    if (!isMakefile && /^\t/.test(line)) {
      problems.push(`${file}:${i + 1}: tab indentation (use 2 spaces)`);
    }
  });
}

if (problems.length > 0) {
  console.error(`Format check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const p of problems.slice(0, 100)) console.error(`  ${p}`);
  if (problems.length > 100) console.error(`  ... and ${problems.length - 100} more`);
  process.exit(1);
}
console.log(`Format check passed (${files.length} files).`);
