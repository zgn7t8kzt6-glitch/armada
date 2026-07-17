/**
 * Generates two copy-paste-able SQL files for people who prefer the Supabase
 * dashboard's SQL Editor over the CLI (no terminal required):
 *
 *   supabase/setup.sql — all migrations, concatenated in order
 *   supabase/seed.sql  — the complete §12 seed, idempotent (safe to re-run)
 *
 * Regenerate after editing migrations or seed-data:  npx tsx scripts/generate-sql.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ORGANIZATION, SITE, USERS, TASKS, MILESTONES, KPIS, FOLDERS, ANNUAL_GOAL, RACI,
} from "./seed-data";

const q = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
};

// ── setup.sql ───────────────────────────────────────────────────────────────
const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const setup = [
  "-- EverTide OS — complete database setup.",
  "-- Paste into the Supabase SQL Editor and Run. Apply ONCE on a fresh project.",
  "-- (Generated from supabase/migrations by scripts/generate-sql.ts — do not edit.)",
  "",
  ...files.map((f) => `-- ═══ ${f} ═══\n${readFileSync(path.join(dir, f), "utf8")}`),
].join("\n");
writeFileSync(path.join(process.cwd(), "supabase", "setup.sql"), setup);

// ── seed.sql ────────────────────────────────────────────────────────────────
const L: string[] = [];
L.push(`-- EverTide OS — seed data (§12). Idempotent: safe to run more than once.
-- Paste into the Supabase SQL Editor and Run AFTER setup.sql.
-- (Generated from scripts/seed-data.ts by scripts/generate-sql.ts — do not edit.)

do $seed$
declare
  v_org uuid;
  v_site uuid;
  v_project uuid;
  v_task uuid;
  v_user uuid;
begin
`);

// Placeholder auth users. GoTrue-compatible rows; these accounts never log in
// (real users are invited from Admin → Members), so no password is set.
for (const u of USERS) {
  L.push(`  -- user: ${u.name}
  select id into v_user from auth.users where email = ${q(u.email)};
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', ${q(u.email)}, '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', ${q(u.name)}), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, ${q(u.name)}, ${q(u.email)}, ${q(u.title)}, ${q(u.avatar_color)})
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;
`);
}

L.push(`  -- organization + site
  insert into public.organizations (name, slug) values (${q(ORGANIZATION.name)}, ${q(ORGANIZATION.slug)})
  on conflict (slug) do nothing;
  select id into v_org from public.organizations where slug = ${q(ORGANIZATION.slug)};

  select id into v_site from public.sites where organization_id = v_org and slug = ${q(SITE.slug)};
  if v_site is null then
    insert into public.sites (organization_id, name, slug, address_line_1, city, state, timezone, target_opening_date)
    values (v_org, ${q(SITE.name)}, ${q(SITE.slug)}, ${q(SITE.address_line_1)}, ${q(SITE.city)}, ${q(SITE.state)}, ${q(SITE.timezone)}, ${q(SITE.target_opening_date)})
    returning id into v_site;
  end if;
`);

for (const u of USERS) {
  L.push(`  select id into v_user from auth.users where email = ${q(u.email)};
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, ${q(u.role)}, true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;
`);
}

// Projects per unique phase/workstream combo (owner = most frequent task owner).
const combos = new Map<string, { phase: string; workstream: string; owners: string[] }>();
for (const t of TASKS) {
  const key = `${t.phase}|${t.workstream}`;
  const c = combos.get(key) ?? { phase: t.phase, workstream: t.workstream, owners: [] };
  c.owners.push(t.owner);
  combos.set(key, c);
}
const ownerEmail = (name: string) => USERS.find((u) => u.name === name)!.email;

for (const c of combos.values()) {
  const counts = c.owners.reduce<Record<string, number>>((m, o) => ((m[o] = (m[o] ?? 0) + 1), m), {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const tasksIn = TASKS.filter((t) => t.phase === c.phase && t.workstream === c.workstream);
  const start = tasksIn.map((t) => t.start_date).sort()[0];
  const due = tasksIn.map((t) => t.due_date).sort().at(-1)!;
  L.push(`  if not exists (select 1 from public.projects where site_id = v_site and phase = ${q(c.phase)} and workstream = ${q(c.workstream)} and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, ${q(`${c.workstream} — ${c.phase}`)}, ${q(c.phase)}, ${q(c.workstream)},
            (select id from public.profiles where email = ${q(ownerEmail(top))}), ${q(start)}, ${q(due)}, ${tasksIn.some((t) => t.critical)});
  end if;
`);
}

for (const t of TASKS) {
  const helpers = t.helpers === "All"
    ? USERS.map((u) => u.name).filter((n) => n !== t.owner)
    : t.helpers.split(",").map((h) => h.trim()).filter((h) => h && h !== t.owner && USERS.some((u) => u.name === h));
  L.push(`  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = ${t.legacy_id}) then
    select id into v_project from public.projects where site_id = v_site and phase = ${q(t.phase)} and workstream = ${q(t.workstream)} and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, ${t.legacy_id}, ${q(t.phase)}, ${q(t.workstream)}, ${q(t.title)},
            (select id from public.profiles where email = ${q(ownerEmail(t.owner))}),
            ${q(t.start_date)}, ${q(t.due_date)}, ${q(t.status)}, ${t.percent_done},
            ${q(t.critical ? "critical" : "normal")}, ${t.critical}, ${q(t.notes || null)}, ${t.legacy_id})
    returning id into v_task;
${helpers.map((h) => `    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = ${q(ownerEmail(h))})) on conflict do nothing;`).join("\n")}
  end if;
`);
}

for (const m of MILESTONES) {
  L.push(`  if not exists (select 1 from public.milestones where site_id = v_site and title = ${q(m.title)}) then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, ${q(m.title)}, ${q(m.target_date)}, ${q(m.gate_criteria)},
            (select id from public.profiles where email = ${q(ownerEmail(m.owner))}), ${q(m.status)});
  end if;
`);
}

KPIS.forEach((k, i) => {
  L.push(`  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, ${q(k.category)}, ${q(k.name)}, ${q(k.description)}, ${q(k.unit)}, ${q(k.frequency)},
          (select id from public.profiles where email = ${q(ownerEmail(k.owner))}), ${q(k.direction)}, ${k.target},
          ${q(k.green_min ?? null)}, ${q(k.green_max ?? null)}, ${q(k.yellow_min ?? null)}, ${q(k.yellow_max ?? null)}, true, ${i + 1})
  on conflict (site_id, name) do nothing;
`);
});

FOLDERS.forEach((name, i) => {
  L.push(`  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = ${q(name)}) then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, ${q(name)}, ${i + 1});
  end if;
`);
});

L.push(`  if not exists (select 1 from public.goals where site_id = v_site and title = ${q(ANNUAL_GOAL.title)}) then
    insert into public.goals (organization_id, site_id, title, goal_type, owner_id, start_date, due_date, status, success_criteria)
    values (v_org, v_site, ${q(ANNUAL_GOAL.title)}, ${q(ANNUAL_GOAL.goal_type)},
            (select id from public.profiles where email = ${q(ownerEmail(ANNUAL_GOAL.owner))}),
            ${q(ANNUAL_GOAL.start_date)}, ${q(ANNUAL_GOAL.due_date)}, ${q(ANNUAL_GOAL.status)}, ${q(ANNUAL_GOAL.success_criteria)});
  end if;
`);

RACI.forEach((r, i) => {
  L.push(`  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = ${q(r.workstream)}) then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, ${q(r.workstream)}, ${q(JSON.stringify(r.assignments))}::jsonb, ${i + 1});
  end if;
`);
});

L.push(`end
$seed$;

-- Result check — the numbers on the right should read 60 / 12 / 11 / 15 / 12 / 12 / 6:
select 'tasks' as what, count(*) from public.tasks where legacy_id is not null
union all select 'milestones', count(*) from public.milestones
union all select 'kpis', count(*) from public.kpis
union all select 'projects', count(*) from public.projects
union all select 'folders', count(*) from public.document_folders
union all select 'raci rows', count(*) from public.raci_entries
union all select 'team profiles', count(*) from public.profiles;
`);

writeFileSync(path.join(process.cwd(), "supabase", "seed.sql"), L.join("\n"));

console.log(`Wrote supabase/setup.sql (${(setup.length / 1024).toFixed(0)} KB, ${files.length} migrations)`);
console.log(`Wrote supabase/seed.sql (${(L.join("\n").length / 1024).toFixed(0)} KB)`);
