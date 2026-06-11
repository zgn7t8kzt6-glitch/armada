// Kipu EMR connector. Kipu signs requests with the APIAuth (HMAC-SHA1) scheme.
// Credentials come from the environment (set them on your HIPAA host — never commit):
//   KIPU_ACCESS_ID, KIPU_SECRET_KEY, KIPU_APP_ID (a.k.a. recipient/location id),
//   KIPU_BASE_URL (default https://api.kipuapi.com)
// NOTE: the exact canonical string + roster endpoint can vary by Kipu API
// version; this implements the documented v3 pattern and is verified on first
// connect via /api/kipu/test before any sync.
import crypto from 'node:crypto';
import { db } from './db.js';

export function kipuConfigured() {
  return Boolean(process.env.KIPU_ACCESS_ID && process.env.KIPU_SECRET_KEY && process.env.KIPU_APP_ID);
}

async function kipuGet(path) {
  if (!kipuConfigured()) throw new Error('Kipu not configured. Set KIPU_ACCESS_ID, KIPU_SECRET_KEY, and KIPU_APP_ID.');
  const base = process.env.KIPU_BASE_URL || 'https://api.kipuapi.com';
  const app = process.env.KIPU_APP_ID;
  const uri = path + (path.includes('?') ? '&' : '?') + 'app_id=' + encodeURIComponent(app);
  const contentType = 'application/vnd.kipusystems+json; version=3';
  const date = new Date().toUTCString();
  const contentMd5 = crypto.createHash('md5').update('').digest('base64');
  const canonical = [contentType, contentMd5, uri, date].join(',');
  const sig = crypto.createHmac('sha1', process.env.KIPU_SECRET_KEY).update(canonical).digest('base64');
  const r = await fetch(base + uri, {
    headers: {
      Accept: contentType,
      'Content-MD5': contentMd5,
      Date: date,
      Authorization: `APIAuth ${process.env.KIPU_ACCESS_ID}:${sig}`,
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Kipu ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch (e) { return text; }
}

// Quick connectivity check.
export async function kipuTest() {
  const path = process.env.KIPU_TEST_PATH || '/api/patients/census';
  const data = await kipuGet(path);
  const n = Array.isArray(data?.patients) ? data.patients.length : (Array.isArray(data) ? data.length : null);
  return { ok: true, sampleCount: n };
}

// Pull the active roster and upsert into clients (matched by name). Non-destructive.
export async function kipuSyncRoster() {
  const path = process.env.KIPU_ROSTER_PATH || '/api/patients/census';
  const data = await kipuGet(path);
  const list = data?.patients || data?.census || (Array.isArray(data) ? data : []);
  let created = 0, matched = 0;
  const find = db.prepare(`SELECT id FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, admit) VALUES (?, ?, ?, ?, ?)`);
  for (const p of list) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name;
    if (!name) continue;
    if (find.get(name, name)) { matched++; continue; }
    ins.run(name, p.first_name || name, p.bed_name || p.room || null, p.level_of_care || p.program || null, (p.admission_date || '').slice(0, 10) || null);
    created++;
  }
  return { total: list.length, created, matched };
}
