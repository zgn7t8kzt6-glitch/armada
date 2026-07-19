import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgres://familyos:familyos_dev@127.0.0.1:5432/familyos',
  max: 5,
});

export const q = (text, params) => pool.query(text, params);

export async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations
           (name TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await q('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = readdirSync(join(__dirname, 'migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(__dirname, 'migrations', f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('migrated', f);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function audit(userId, action, entity, entityId, detail = {}) {
  await q(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail_json) VALUES ($1,$2,$3,$4,$5)',
    [userId, action, entity ?? null, entityId != null ? String(entityId) : null, JSON.stringify(detail)]
  );
}

if (process.argv[2] === 'migrate') {
  migrate().then(() => { console.log('migrations complete'); process.exit(0); })
           .catch(e => { console.error(e); process.exit(1); });
}
