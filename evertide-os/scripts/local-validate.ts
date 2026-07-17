/**
 * Local migration + seed dry-run (development validation).
 *
 * Boots an embedded PostgreSQL, shims the Supabase-provided surfaces
 * (auth schema + auth.uid(), storage schema, API roles), applies every
 * migration in order, loads the full §12 seed via SQL, verifies the counts
 * and relationships, and exercises the core database rules (blocked reason,
 * resolution/disposition constraints, owner/due-date guard, decision
 * immutability, commitment carryover, audit immutability) under RLS with
 * simulated user JWTs.
 *
 * This does NOT replace a real Supabase project — Auth, Realtime, Storage,
 * and PostgREST behavior still need the hosted stack (see README). It exists
 * so the SQL layer can be proven anywhere, including offline CI.
 *
 *   npx tsx scripts/local-validate.ts
 */
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ORGANIZATION, SITE, USERS, TASKS, MILESTONES, KPIS, FOLDERS, ANNUAL_GOAL, RACI,
} from "./seed-data";

const PORT = 54329;
let failures = 0;

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string) {
  failures++;
  console.error(`  ✗ ${msg}`);
}
async function expectError(p: Promise<unknown>, contains: string, label: string) {
  try {
    await p;
    fail(`${label}: expected an error containing "${contains}" but it succeeded`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.toLowerCase().includes(contains.toLowerCase())) ok(label);
    else fail(`${label}: wrong error — ${m}`);
  }
}

// Supabase-provided surfaces that exist before our migrations run.
const SHIM_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants table/sequence/function privileges to the API roles via
  -- default privileges; RLS remains the actual gate.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );
  -- PostgREST-compatible: current user id from the request JWT claim.
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  -- Supabase grants API roles access to auth.uid() and the auth schema.
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    created_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text,
    created_at timestamptz default now()
  );
`;

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "evertide-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    // Allows running under root (CI/sandbox): creates a postgres system user
    // and chowns the data dir before initdb.
    createPostgresUser: process.getuid?.() === 0,
  });

  console.log("Booting embedded PostgreSQL…");
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("evertide");

  const client = new Client({
    host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "evertide",
  });
  await client.connect();
  const q = (sql: string, params?: unknown[]) => client.query(sql, params);

  try {
    console.log("\n1) Supabase surface shims");
    await q(SHIM_SQL);
    ok("auth schema, auth.uid(), storage schema, API roles");

    console.log("\n2) Applying migrations in order");
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of readdirSync(dir).sort()) {
      await q(readFileSync(path.join(dir, file), "utf8"));
      ok(file);
    }

    console.log("\n3) Seeding (§12) via SQL");
    const userIds = new Map<string, string>();
    for (const u of USERS) {
      const { rows } = await q(
        `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('name', $2::text)) returning id`,
        [u.email, u.name]
      );
      userIds.set(u.name, rows[0].id);
      // handle_new_user trigger created the profile; enrich it like seed.ts does.
      await q(`update public.profiles set name = $2, title = $3, avatar_color = $4 where id = $1`, [
        rows[0].id, u.name, u.title, u.avatar_color,
      ]);
    }
    ok(`${USERS.length} auth users → profiles created by trigger`);

    const { rows: orgRows } = await q(
      `insert into public.organizations (name, slug) values ($1, $2) returning id`,
      [ORGANIZATION.name, ORGANIZATION.slug]
    );
    const orgId = orgRows[0].id;
    const { rows: siteRows } = await q(
      `insert into public.sites (organization_id, name, slug, address_line_1, city, state, timezone, target_opening_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [orgId, SITE.name, SITE.slug, SITE.address_line_1, SITE.city, SITE.state, SITE.timezone, SITE.target_opening_date]
    );
    const siteId = siteRows[0].id;
    for (const u of USERS) {
      await q(`insert into public.organization_memberships (organization_id, user_id, role) values ($1,$2,$3)`, [
        orgId, userIds.get(u.name), u.role,
      ]);
      await q(`insert into public.site_memberships (site_id, user_id) values ($1,$2)`, [siteId, userIds.get(u.name)]);
    }
    ok("organization, site, memberships");

    // Projects per unique phase/workstream combo, like seed.ts.
    const combos = new Map<string, { phase: string; workstream: string; owners: string[] }>();
    for (const t of TASKS) {
      const key = `${t.phase}|${t.workstream}`;
      const c = combos.get(key) ?? { phase: t.phase, workstream: t.workstream, owners: [] };
      c.owners.push(t.owner);
      combos.set(key, c);
    }
    const projectIds = new Map<string, string>();
    for (const [key, c] of combos) {
      const counts = c.owners.reduce<Record<string, number>>((m, o) => ((m[o] = (m[o] ?? 0) + 1), m), {});
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const { rows } = await q(
        `insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [orgId, siteId, `${c.workstream} — ${c.phase}`, c.phase, c.workstream, userIds.get(top)]
      );
      projectIds.set(key, rows[0].id);
    }
    ok(`${projectIds.size} projects`);

    for (const t of TASKS) {
      const { rows } = await q(
        `insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title,
           owner_id, start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [
          orgId, siteId, projectIds.get(`${t.phase}|${t.workstream}`), t.legacy_id, t.phase, t.workstream,
          t.title, userIds.get(t.owner), t.start_date, t.due_date, t.status, t.percent_done,
          t.critical ? "critical" : "normal", t.critical, t.notes || null, t.legacy_id,
        ]
      );
      const helpers = t.helpers === "All"
        ? USERS.map((u) => u.name).filter((n) => n !== t.owner)
        : t.helpers.split(",").map((h) => h.trim()).filter((h) => h && h !== t.owner);
      for (const h of helpers) {
        if (userIds.has(h)) {
          await q(`insert into public.task_helpers (task_id, user_id) values ($1,$2)`, [rows[0].id, userIds.get(h)]);
        }
      }
    }
    ok(`${TASKS.length} tasks + helpers`);

    for (const m of MILESTONES) {
      await q(
        `insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [orgId, siteId, m.title, m.target_date, m.gate_criteria, userIds.get(m.owner)]
      );
    }
    ok(`${MILESTONES.length} milestones`);

    for (const [i, k] of KPIS.entries()) {
      await q(
        `insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
           direction, target_value, green_min, green_max, yellow_min, yellow_max, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          orgId, siteId, k.category, k.name, k.description, k.unit, k.frequency, userIds.get(k.owner),
          k.direction, k.target, k.green_min ?? null, k.green_max ?? null, k.yellow_min ?? null, k.yellow_max ?? null, i + 1,
        ]
      );
    }
    ok(`${KPIS.length} KPIs`);

    for (const [i, name] of FOLDERS.entries()) {
      await q(`insert into public.document_folders (organization_id, name, sort_order) values ($1,$2,$3)`, [orgId, name, i + 1]);
    }
    await q(
      `insert into public.goals (organization_id, site_id, title, goal_type, owner_id, start_date, due_date, status, success_criteria)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, siteId, ANNUAL_GOAL.title, ANNUAL_GOAL.goal_type, userIds.get(ANNUAL_GOAL.owner),
       ANNUAL_GOAL.start_date, ANNUAL_GOAL.due_date, ANNUAL_GOAL.status, ANNUAL_GOAL.success_criteria]
    );
    for (const [i, r] of RACI.entries()) {
      await q(`insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order) values ($1,$2,$3,$4,$5)`, [
        orgId, siteId, r.workstream, JSON.stringify(r.assignments), i + 1,
      ]);
    }
    ok(`${FOLDERS.length} folders, annual goal, ${RACI.length} RACI rows`);

    console.log("\n4) Verifying seed counts & relationships");
    const counts: Array<[string, string, number]> = [
      ["tasks", `select count(*) from public.tasks where site_id = '${siteId}'`, 60],
      ["milestones", `select count(*) from public.milestones where site_id = '${siteId}'`, 12],
      ["kpis", `select count(*) from public.kpis where site_id = '${siteId}'`, 11],
      ["kpi categories", `select count(distinct category) from public.kpis where site_id = '${siteId}'`, 4],
      ["projects", `select count(*) from public.projects where site_id = '${siteId}'`, combos.size],
      ["folders", `select count(*) from public.document_folders where organization_id = '${orgId}'`, 12],
      ["raci", `select count(*) from public.raci_entries where site_id = '${siteId}'`, 12],
      ["profiles", `select count(*) from public.profiles`, 6],
      ["ownerless tasks", `select count(*) from public.tasks where owner_id is null`, 0],
      ["projectless tasks", `select count(*) from public.tasks where project_id is null and site_id = '${siteId}'`, 0],
      ["audit rows", `select count(*) from public.audit_events where organization_id = '${orgId}' and entity_type = 'tasks'`, 60],
    ];
    for (const [label, sql, expected] of counts) {
      const { rows } = await q(sql);
      const actual = Number(rows[0].count);
      if (actual === expected) ok(`${label}: ${actual}`);
      else fail(`${label}: expected ${expected}, got ${actual}`);
    }

    console.log("\n5) Business rules under simulated user sessions");
    const adminId = userIds.get("Shlomo")!;
    const memberId = userIds.get("Mordechai Neurwith")!;
    const { rows: taskRows } = await q(`select id from public.tasks where legacy_id = 2`);
    const taskId = taskRows[0].id;

    const as = async (uid: string, role: "authenticated", sql: string, params?: unknown[]) => {
      await q("begin");
      try {
        await q(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
        await q(`set local role ${role}`);
        const r = await q(sql, params);
        await q("commit");
        return r;
      } catch (e) {
        await q("rollback");
        throw e;
      }
    };

    // Member updates status/percent — allowed.
    await as(memberId, "authenticated", `update public.tasks set status = 'in_progress', percent_done = 25 where id = $1`, [taskId]);
    ok("member can update status/percent under RLS");

    // Blocked without a reason — rejected by CHECK.
    await expectError(
      as(memberId, "authenticated", `update public.tasks set status = 'blocked' where id = $1`, [taskId]),
      "check", "blocked without reason rejected"
    );
    await as(memberId, "authenticated",
      `update public.tasks set status = 'blocked', blocker_reason = 'Waiting on counsel' where id = $1`, [taskId]);
    ok("blocked with reason accepted");

    // Member changing owner/due — trigger blocks.
    await expectError(
      as(memberId, "authenticated", `update public.tasks set due_date = '2027-03-01' where id = $1`, [taskId]),
      "Only admins", "member cannot change due date"
    );
    await as(adminId, "authenticated", `update public.tasks set due_date = '2026-07-30' where id = $1`, [taskId]);
    ok("admin can change due date");

    // Outsider (no membership) sees nothing.
    const { rows: outsider } = await q(`insert into auth.users (email) values ('outsider@example.com') returning id`);
    const { rows: visible } = await as(outsider[0].id, "authenticated", `select count(*) from public.tasks`);
    if (Number(visible[0].count) === 0) ok("outsider sees zero tasks (RLS isolation)");
    else fail(`outsider sees ${visible[0].count} tasks`);

    // Issue resolution requires a summary.
    const { rows: issueRows } = await as(memberId, "authenticated",
      `insert into public.issues (organization_id, site_id, title, priority, owner_id, reported_by)
       values ($1,$2,'Validation issue','high',$3,$3) returning id, huddle_required`, [orgId, siteId, memberId]);
    if (issueRows[0].huddle_required) ok("high-priority issue auto-flagged for huddle");
    else fail("high-priority issue not flagged for huddle");
    await expectError(
      as(memberId, "authenticated", `update public.issues set status = 'resolved' where id = $1`, [issueRows[0].id]),
      "check", "resolve without summary rejected"
    );

    // Risk: trigger-computed score; closing needs a disposition; conversion links.
    const { rows: riskRows } = await as(memberId, "authenticated",
      `insert into public.risks (organization_id, site_id, title, probability, impact, owner_id)
       values ($1,$2,'Validation risk','high','severe',$3) returning id, score`, [orgId, siteId, memberId]);
    if (riskRows[0].score === 12) ok("risk score computed by trigger (high×severe=12)");
    else fail(`risk score ${riskRows[0].score} ≠ 12`);
    await expectError(
      as(memberId, "authenticated", `update public.risks set status = 'closed' where id = $1`, [riskRows[0].id]),
      "check", "close without disposition rejected"
    );
    const { rows: conv } = await as(memberId, "authenticated", `select public.convert_risk_to_issue($1) as issue_id`, [riskRows[0].id]);
    const { rows: convRisk } = await q(`select status, disposition, converted_issue_id from public.risks where id = $1`, [riskRows[0].id]);
    if (convRisk[0].status === "occurred" && convRisk[0].converted_issue_id === conv[0].issue_id) {
      ok("occurred risk converts to linked issue, record retained");
    } else fail("risk conversion linkage wrong");

    // Huddle lifecycle: agenda snapshot + carryover lineage + end validation.
    const { rows: h1 } = await as(adminId, "authenticated",
      `insert into public.huddles (organization_id, site_id, huddle_date, created_by) values ($1,$2,'2026-07-21',$3) returning id`,
      [orgId, siteId, adminId]);
    await as(adminId, "authenticated", `select public.start_huddle($1)`, [h1[0].id]);
    const { rows: agenda } = await q(`select count(*), count(*) filter (where item_type = 'missing_kpi') as missing
                                      from public.huddle_agenda_items where huddle_id = $1`, [h1[0].id]);
    if (Number(agenda[0].count) > 0 && Number(agenda[0].missing) === 11) {
      ok(`start_huddle generated agenda (${agenda[0].count} items, 11 missing KPIs first)`);
    } else fail(`agenda generation: ${agenda[0].count} items, ${agenda[0].missing} missing KPIs (expected 11)`);
    const { rows: c1 } = await as(adminId, "authenticated",
      `insert into public.huddle_commitments (organization_id, site_id, huddle_id, commitment, owner_id, due_date)
       values ($1,$2,$3,'Call the GC','${adminId}','2026-07-24') returning id`, [orgId, siteId, h1[0].id]);
    await as(adminId, "authenticated", `select public.end_huddle($1)`, [h1[0].id]);
    ok("end_huddle froze the agenda snapshot");

    const { rows: h2 } = await as(adminId, "authenticated",
      `insert into public.huddles (organization_id, site_id, huddle_date, created_by) values ($1,$2,'2026-07-28',$3) returning id`,
      [orgId, siteId, adminId]);
    await as(adminId, "authenticated", `select public.start_huddle($1)`, [h2[0].id]);
    await expectError(
      as(adminId, "authenticated", `select public.end_huddle($1)`, [h2[0].id]),
      "prior commitment", "end_huddle blocked while prior commitment open"
    );
    const { rows: carried } = await as(adminId, "authenticated",
      `select public.carry_commitment($1, $2, '2026-07-31') as id`, [c1[0].id, h2[0].id]);
    const { rows: lineage } = await q(
      `select carry_count, source_commitment_id from public.huddle_commitments where id = $1`, [carried[0].id]);
    if (Number(lineage[0].carry_count) === 1 && lineage[0].source_commitment_id === c1[0].id) {
      ok("carryover increments count and preserves lineage");
    } else fail("carryover lineage wrong");
    await as(adminId, "authenticated", `select public.end_huddle($1)`, [h2[0].id]);
    ok("huddle ends once commitments are dispositioned");

    // Decision immutability + audited correction.
    const { rows: dec } = await as(adminId, "authenticated",
      `insert into public.decisions (organization_id, site_id, title, decision_text, owner_id, created_by)
       values ($1,$2,'Validation decision','Original',$3,$3) returning id`, [orgId, siteId, adminId]);
    await as(adminId, "authenticated", `select public.approve_decision($1)`, [dec[0].id]);
    await expectError(
      as(adminId, "authenticated", `update public.decisions set decision_text = 'Tampered' where id = $1`, [dec[0].id]),
      "immutable", "approved decision substance frozen"
    );
    await as(adminId, "authenticated",
      `select public.admin_correct_decision($1, 'typo', '{"decision_text":"Corrected"}'::jsonb)`, [dec[0].id]);
    const { rows: corrected } = await q(`select decision_text from public.decisions where id = $1`, [dec[0].id]);
    if (corrected[0].decision_text === "Corrected") ok("audited admin correction path works");
    else fail("admin correction did not apply");

    // Audit immutability, even as superuser.
    await expectError(
      q(`update public.audit_events set event_type = 'tampered' where id = (select id from public.audit_events limit 1)`),
      "immutable", "audit events immutable to update"
    );
    await expectError(
      q(`delete from public.audit_events where id = (select id from public.audit_events limit 1)`),
      "immutable", "audit events immutable to delete"
    );

    // Storage bucket from migration 0006.
    const { rows: bucket } = await q(`select id, public from storage.buckets where id = 'evertide-documents'`);
    if (bucket.length === 1 && bucket[0].public === false) ok("private evertide-documents bucket created");
    else fail("storage bucket missing or public");

    console.log(failures === 0
      ? "\nAll local validations passed — migrations + seed are sound."
      : `\n${failures} validation(s) FAILED`);
  } finally {
    await client.end().catch(() => {});
    await pg.stop().catch(() => {});
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
