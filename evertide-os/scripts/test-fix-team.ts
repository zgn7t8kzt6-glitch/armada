/**
 * Proves supabase/fix-team.sql runs clean against a real Postgres loaded with
 * the production failure conditions: placeholder Shlomo referenced as huddle
 * facilitator + author of immutable history rows + owner of an approved
 * decision, Richard owning tasks with Mordechai as helper, etc.
 */
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 54331;
const APP = "/home/user/armada/evertide-os";
let failures = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };

const SHIM_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );
  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    provider_id text not null,
    user_id uuid references auth.users(id) on delete cascade,
    provider text not null default 'email',
    identity_data jsonb not null default '{}'::jsonb,
    last_sign_in_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (provider, provider_id)
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, created_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, created_at timestamptz default now());
`;

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "evertide-fixteam-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir, user: "postgres", password: "postgres", port: PORT,
    persistent: false, createPostgresUser: process.getuid?.() === 0,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("evertide");
  const client = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "evertide" });
  await client.connect();
  const q = (sql: string, params?: unknown[]) => client.query(sql, params);

  try {
    await q(SHIM_SQL);
    for (const f of readdirSync(path.join(APP, "supabase", "migrations")).sort()) {
      await q(readFileSync(path.join(APP, "supabase", "migrations", f), "utf8"));
    }
    ok("migrations applied");

    // ── Production-like state ──────────────────────────────────────────────
    const mkUser = async (email: string, name: string) => {
      const { rows } = await q(
        "insert into auth.users (email) values ($1) returning id", [email]);
      const id = rows[0].id as string;
      await q("insert into auth.identities (provider_id, user_id, provider, identity_data) values ($1::text,$1::uuid,'email',jsonb_build_object('email',$2::text,'sub',$1::text))", [id, email]);
      await q("insert into public.profiles (id, name, email) values ($1,$2,$3) on conflict (id) do update set name = excluded.name, email = excluded.email", [id, name, email]);
      return id;
    };
    const ph = await mkUser("shlomo@evertide.example", "Shlomo");
    const real = await mkUser("shlomo@armadarecovery.com", "Shlomo");
    const jared = await mkUser("jared@evertide.example", "Jared Friedman");
    const zev = await mkUser("zev@evertide.example", "Dr. Zev Neurwith");
    const mord = await mkUser("mordechai@evertide.example", "Mordechai Neurwith");
    const aaron = await mkUser("aaron@evertide.example", "Aaron Jacobs");
    const rich = await mkUser("richard@evertide.example", "Richard Hunt");
    // Strays auto-created by magic-link attempts with the new addresses
    // (the production 23505 collision): no memberships, no work.
    const strayS = await mkUser("shlomo@evertideinfusion.com", "shlomo");
    const strayJ = await mkUser("jfriedman@evertideinfusion.com", "jfriedman");

    const { rows: orgR } = await q(
      "insert into public.organizations (name, slug) values ('EverTide Infusion','evertide') returning id");
    const org = orgR[0].id as string;
    const { rows: siteR } = await q(
      "insert into public.sites (organization_id, name, slug, timezone) values ($1,'Jacksonville — Site 1','jax-1','America/New_York') returning id", [org]);
    const site = siteR[0].id as string;
    for (const [u, role] of [[ph, "org_admin"], [real, "org_admin"], [jared, "member"], [zev, "member"], [mord, "site_admin"], [aaron, "member"], [rich, "member"]] as const) {
      await q("insert into public.organization_memberships (organization_id, user_id, role) values ($1,$2,$3)", [org, u, role]);
      await q("insert into public.site_memberships (site_id, user_id) values ($1,$2)", [site, u]);
    }

    // Tasks: placeholder-owned with real as helper (dup risk), richard-owned with mord as helper.
    const task = async (owner: string, title: string) =>
      (await q("insert into public.tasks (organization_id, site_id, title, owner_id) values ($1,$2,$3,$4) returning id", [org, site, title, owner])).rows[0].id as string;
    const t1 = await task(ph, "Placeholder task");
    const t2 = await task(rich, "Richard task");
    const t3 = await task(rich, "Richard task 2");
    await q("insert into public.task_helpers (task_id, user_id) values ($1,$2),($1,$3),($1,$8),($4,$5),($6,$7)", [t1, real, jared, t2, mord, t3, aaron, strayS]);

    // The exact production failure: huddles referencing the placeholder, one frozen.
    const h1 = (await q("insert into public.huddles (organization_id, site_id, huddle_date, facilitator_id, created_by) values ($1,$2,'2026-07-14',$3,$3) returning id", [org, site, ph])).rows[0].id as string;
    await q("update public.huddles set status='completed' where id=$1", [h1]);
    await q("insert into public.huddles (organization_id, site_id, huddle_date, facilitator_id, created_by) values ($1,$2,'2026-07-21',$3,$3)", [org, site, ph]);
    await q("insert into public.huddle_attendees (huddle_id, user_id) values ($1,$2),($1,$3),($1,$4)", [h1, ph, real, rich]);

    // Immutable history rows authored by the placeholder and by richard.
    await q("insert into public.task_updates (organization_id, site_id, task_id, author_id, body) values ($1,$2,$3,$4,'placeholder note'),($1,$2,$5,$6,'richard note')", [org, site, t1, ph, t2, rich]);
    const issue = (await q("insert into public.issues (organization_id, site_id, title, owner_id, reported_by) values ($1,$2,'Issue',$3,$3) returning id", [org, site, ph])).rows[0].id as string;
    await q("insert into public.issue_updates (issue_id, author_id, body) values ($1,$2,'note')", [issue, rich]);

    // Approved decision owned by the placeholder (immutability guard).
    const dec = (await q("insert into public.decisions (organization_id, site_id, title, decision_text, owner_id, created_by) values ($1,$2,'Pick EMR','We pick X',$3,$3) returning id", [org, site, ph])).rows[0].id as string;
    await q("update public.decisions set status='approved', approved_by_id=$2 where id=$1", [dec, ph]);

    // Document version uploaded by richard; restricted grant overlap.
    const folder = (await q("insert into public.document_folders (organization_id, name) values ($1,'Legal') returning id", [org])).rows[0].id as string;
    const doc = (await q("insert into public.documents (organization_id, site_id, folder_id, title, owner_id, confidentiality) values ($1,$2,$3,'Lease',$4,'restricted') returning id", [org, site, folder, ph])).rows[0].id as string;
    await q("insert into public.document_versions (document_id, version_number, storage_path, original_filename, mime_type, size_bytes, uploaded_by) values ($1,1,'x/y','lease.pdf','application/pdf',10,$2)", [doc, rich]);
    await q("insert into public.document_access_grants (document_id, user_id, granted_by) values ($1,$2,$3),($1,$4,$3)", [doc, ph, ph, real]);

    await q("insert into public.raci_entries (organization_id, workstream, assignments, sort_order) values ($1,'Legal & Corporate','{\"Shlomo\":\"A\",\"Richard Hunt\":\"C\"}'::jsonb,1)", [org]);
    ok("production-like state loaded (all known failure conditions present)");

    // ── Run the fix, twice ────────────────────────────────────────────────
    const fixSql = readFileSync(path.join(APP, "supabase", "fix-team.sql"), "utf8");
    await q(fixSql);
    ok("fix-team.sql ran clean (first run)");
    await q(fixSql);
    ok("fix-team.sql ran clean (second run — idempotent)");

    // ── Verify ────────────────────────────────────────────────────────────
    const emails = (await q("select email from auth.users order by email")).rows.map((r) => r.email);
    const expect = ["ajacobs@evertideinfusion.com", "jfriedman@evertideinfusion.com", "mneurwith@evertideinfusion.com", "shlomo@evertideinfusion.com", "zneurwith@evertideinfusion.com"];
    if (JSON.stringify(emails) === JSON.stringify(expect)) ok("exactly 5 users, correct emails, no placeholder, no richard");
    else fail(`emails wrong: ${emails.join(", ")}`);

    const own = async (label: string, sql: string, id: string, n: number) => {
      const c = Number((await q(sql, [id])).rows[0].c);
      if (c === n) ok(`${label} = ${n}`); else fail(`${label}: expected ${n}, got ${c}`);
    };
    await own("real shlomo tasks", "select count(*) c from public.tasks where owner_id=$1", real, 1);
    await own("mordechai tasks (richard's)", "select count(*) c from public.tasks where owner_id=$1", mord, 2);
    await own("placeholder profile gone", "select count(*) c from public.profiles where id=$1", ph, 0);
    await own("richard profile gone", "select count(*) c from public.profiles where id=$1", rich, 0);
    await own("stray shlomo account merged away", "select count(*) c from public.profiles where id=$1", strayS, 0);
    await own("stray jfriedman account merged away", "select count(*) c from public.profiles where id=$1", strayJ, 0);
    await own("keeper for shlomo is the real login", "select count(*) c from auth.users where id=$1 and email='shlomo@evertideinfusion.com'", real, 1);
    await own("keeper for jared is the seed account", "select count(*) c from auth.users where id=$1 and email='jfriedman@evertideinfusion.com'", jared, 1);
    await own("huddles now facilitated by real shlomo", "select count(*) c from public.huddles where facilitator_id=$1", real, 2);
    await own("task_updates re-authored", "select count(*) c from public.task_updates where author_id=$1", real, 1);
    await own("decision owned by real shlomo", "select count(*) c from public.decisions where owner_id=$1", real, 1);
    await own("doc version uploaded_by mordechai", "select count(*) c from public.document_versions where uploaded_by=$1", mord, 1);

    const helpers = (await q("select count(*) c from public.task_helpers th join public.tasks t on t.id=th.task_id where th.user_id=t.owner_id")).rows[0].c;
    if (Number(helpers) === 0) ok("no owner-as-helper rows"); else fail(`owner-as-helper rows: ${helpers}`);
    const grants = (await q("select count(*) c from public.document_access_grants where document_id=$1", [doc])).rows[0].c;
    if (Number(grants) === 1) ok("access grants deduped to 1"); else fail(`grants: ${grants}`);
    const raci = (await q("select assignments from public.raci_entries limit 1")).rows[0].assignments;
    if (!("Richard Hunt" in raci)) ok("richard out of RACI"); else fail("richard still in RACI");
    const ident = (await q("select count(*) c from auth.identities i join auth.users u on u.id=i.user_id where i.identity_data->>'email' is distinct from u.email")).rows[0].c;
    if (Number(ident) === 0) ok("identities synced to new emails"); else fail(`stale identities: ${ident}`);
    const loginReady = (await q("select count(*) c from auth.users u where u.email_confirmed_at is not null and exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='email')")).rows[0].c;
    if (Number(loginReady) === 5) ok("all 5 accounts confirmed with an email identity (password-login ready)"); else fail(`login-ready accounts: ${loginReady}/5`);
    const trig = (await q("select count(*) c from pg_trigger where tgname in ('task_updates_immutable','issue_updates_immutable','document_versions_immutable','reports_guard') and tgenabled='O'")).rows[0].c;
    if (Number(trig) === 4) ok("immutability triggers re-enabled"); else fail(`re-enabled triggers: ${trig}/4`);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    await client.end().catch(() => {});
    await pg.stop().catch(() => {});
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

void main();
