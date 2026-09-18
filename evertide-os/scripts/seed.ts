/**
 * EverTide OS — idempotent production bootstrap seed (spec §12).
 *
 * Creates (only if missing): the organization, Jacksonville Site 1, six
 * placeholder users + memberships, projects derived from phase/workstream
 * combinations, all 60 opening tasks (with helpers), 12 milestones, 11 KPIs,
 * the document folder taxonomy, the annual goal, and the RACI reference.
 *
 * Usage:
 *   npm run db:seed            # idempotent bootstrap (safe to re-run)
 *   npm run db:seed:reset      # prints the dev reset procedure first
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { loadEnv, adminClient, fail, ok } from "./lib";
import {
  ORGANIZATION, SITE, USERS, TASKS, MILESTONES, KPIS, FOLDERS, ANNUAL_GOAL, RACI,
} from "./seed-data";

loadEnv();
const supabase = adminClient();

if (process.argv.includes("--reset")) {
  console.log(
    "Development reset: audit events and update feeds are append-only by design,\n" +
      "so row deletes are intentionally blocked. To reset a development database run:\n\n" +
      "  supabase db reset        # replays all migrations on the local stack\n" +
      "  npm run db:seed          # then re-seed\n\n" +
      "For a hosted dev project, restore from a backup or recreate the project.\n" +
      "Continuing with the idempotent seed...\n"
  );
}

type Ids = Record<string, string>;

async function ensureUsers(): Promise<Ids> {
  const ids: Ids = {};
  const { data: page, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) fail(`listUsers: ${listErr.message}`);
  const byEmail = new Map(page.users.map((u) => [u.email?.toLowerCase(), u.id]));

  for (const u of USERS) {
    let id = byEmail.get(u.email.toLowerCase());
    if (!id) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        email_confirm: true,
        user_metadata: { name: u.name },
      });
      if (error || !data.user) fail(`createUser ${u.email}: ${error?.message}`);
      id = data.user.id;
    }
    ids[u.name] = id;
    const { error: pErr } = await supabase.from("profiles").upsert(
      { id, name: u.name, email: u.email, title: u.title, avatar_color: u.avatar_color },
      { onConflict: "id" }
    );
    if (pErr) fail(`profile ${u.name}: ${pErr.message}`);
  }
  ok(`${USERS.length} users + profiles`);
  return ids;
}

async function ensureOrgAndSite(): Promise<{ orgId: string; siteId: string }> {
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .upsert({ name: ORGANIZATION.name, slug: ORGANIZATION.slug }, { onConflict: "slug" })
    .select("id")
    .single();
  if (orgErr || !org) fail(`organization: ${orgErr?.message}`);

  const { data: existing } = await supabase
    .from("sites").select("id").eq("organization_id", org.id).eq("slug", SITE.slug).maybeSingle();
  let siteId = existing?.id as string | undefined;
  if (!siteId) {
    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .insert({ organization_id: org.id, ...SITE })
      .select("id")
      .single();
    if (siteErr || !site) fail(`site: ${siteErr?.message}`);
    siteId = site.id;
  }
  ok("organization + site");
  return { orgId: org.id, siteId: siteId! };
}

async function ensureMemberships(orgId: string, siteId: string, ids: Ids) {
  for (const u of USERS) {
    const { error: omErr } = await supabase.from("organization_memberships").upsert(
      { organization_id: orgId, user_id: ids[u.name], role: u.role, active: true },
      { onConflict: "organization_id,user_id" }
    );
    if (omErr) fail(`org membership ${u.name}: ${omErr.message}`);
    const { error: smErr } = await supabase.from("site_memberships").upsert(
      { site_id: siteId, user_id: ids[u.name], active: true },
      { onConflict: "site_id,user_id" }
    );
    if (smErr) fail(`site membership ${u.name}: ${smErr.message}`);
  }
  ok("memberships");
}

async function ensureProjects(orgId: string, siteId: string, ids: Ids): Promise<Map<string, string>> {
  // One project per unique phase/workstream combination (§12.1); the owner is
  // the most frequent task owner in that combination.
  const combos = new Map<string, { phase: string; workstream: string; owners: string[] }>();
  for (const t of TASKS) {
    const key = `${t.phase}|${t.workstream}`;
    const c = combos.get(key) ?? { phase: t.phase, workstream: t.workstream, owners: [] };
    c.owners.push(t.owner);
    combos.set(key, c);
  }

  const projectIds = new Map<string, string>();
  for (const [key, c] of combos) {
    const { data: existing } = await supabase
      .from("projects").select("id")
      .eq("site_id", siteId).eq("phase", c.phase).eq("workstream", c.workstream)
      .is("archived_at", null).maybeSingle();
    if (existing) {
      projectIds.set(key, existing.id);
      continue;
    }
    const counts = c.owners.reduce<Record<string, number>>((m, o) => ((m[o] = (m[o] ?? 0) + 1), m), {});
    const topOwner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const tasksIn = TASKS.filter((t) => t.phase === c.phase && t.workstream === c.workstream);
    const start = tasksIn.map((t) => t.start_date).sort()[0];
    const due = tasksIn.map((t) => t.due_date).sort().at(-1);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        organization_id: orgId, site_id: siteId,
        name: `${c.workstream} — ${c.phase}`,
        phase: c.phase, workstream: c.workstream,
        owner_id: ids[topOwner], start_date: start, due_date: due,
        critical_path: tasksIn.some((t) => t.critical),
      })
      .select("id").single();
    if (error || !data) fail(`project ${key}: ${error?.message}`);
    projectIds.set(key, data.id);
  }
  ok(`${projectIds.size} projects (unique phase/workstream combos)`);
  return projectIds;
}

async function ensureTasks(orgId: string, siteId: string, ids: Ids, projectIds: Map<string, string>) {
  const { data: existing, error } = await supabase
    .from("tasks").select("legacy_id").eq("site_id", siteId).not("legacy_id", "is", null);
  if (error) fail(`tasks query: ${error.message}`);
  const have = new Set((existing ?? []).map((t) => t.legacy_id));

  let created = 0;
  for (const t of TASKS) {
    if (have.has(t.legacy_id)) continue;
    const { data: row, error: insErr } = await supabase
      .from("tasks")
      .insert({
        organization_id: orgId, site_id: siteId,
        project_id: projectIds.get(`${t.phase}|${t.workstream}`),
        legacy_id: t.legacy_id, phase: t.phase, workstream: t.workstream,
        title: t.title, owner_id: ids[t.owner],
        start_date: t.start_date, due_date: t.due_date,
        status: t.status, percent_done: t.percent_done,
        priority: t.critical ? "critical" : "normal",
        critical: t.critical, notes: t.notes || null,
        sort_order: t.legacy_id,
      })
      .select("id").single();
    if (insErr || !row) fail(`task ${t.legacy_id}: ${insErr?.message}`);
    created++;

    const helpers = t.helpers === "All"
      ? USERS.map((u) => u.name).filter((n) => n !== t.owner)
      : t.helpers.split(",").map((h) => h.trim()).filter((h) => h && h !== t.owner);
    for (const h of helpers) {
      if (!ids[h]) continue;
      const { error: hErr } = await supabase
        .from("task_helpers")
        .upsert({ task_id: row.id, user_id: ids[h] }, { onConflict: "task_id,user_id" });
      if (hErr) fail(`helper ${h} on task ${t.legacy_id}: ${hErr.message}`);
    }
  }
  ok(`${TASKS.length} tasks (${created} created, ${TASKS.length - created} already present)`);
}

async function ensureMilestones(orgId: string, siteId: string, ids: Ids) {
  let created = 0;
  for (const m of MILESTONES) {
    const { data: existing } = await supabase
      .from("milestones").select("id").eq("site_id", siteId).eq("title", m.title).maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from("milestones").insert({
      organization_id: orgId, site_id: siteId,
      title: m.title, target_date: m.target_date, gate_criteria: m.gate_criteria,
      owner_id: ids[m.owner], status: m.status,
    });
    if (error) fail(`milestone ${m.title}: ${error.message}`);
    created++;
  }
  ok(`${MILESTONES.length} milestones (${created} created)`);
}

async function ensureKpis(orgId: string, siteId: string, ids: Ids) {
  for (const [i, k] of KPIS.entries()) {
    const { error } = await supabase.from("kpis").upsert(
      {
        organization_id: orgId, site_id: siteId,
        category: k.category, name: k.name, description: k.description,
        unit: k.unit, frequency: k.frequency, owner_id: ids[k.owner],
        direction: k.direction, target_value: k.target,
        green_min: k.green_min ?? null, green_max: k.green_max ?? null,
        yellow_min: k.yellow_min ?? null, yellow_max: k.yellow_max ?? null,
        active: true, sort_order: i + 1,
      },
      { onConflict: "site_id,name" }
    );
    if (error) fail(`kpi ${k.name}: ${error.message}`);
  }
  ok(`${KPIS.length} KPIs`);
}

async function ensureFolders(orgId: string) {
  let created = 0;
  for (const [i, name] of FOLDERS.entries()) {
    const { data: existing } = await supabase
      .from("document_folders").select("id")
      .eq("organization_id", orgId).is("site_id", null).is("parent_folder_id", null)
      .eq("name", name).maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from("document_folders").insert({
      organization_id: orgId, name, sort_order: i + 1,
    });
    if (error) fail(`folder ${name}: ${error.message}`);
    created++;
  }
  ok(`${FOLDERS.length} document folders (${created} created)`);
}

async function ensureGoal(orgId: string, siteId: string, ids: Ids) {
  const { data: existing } = await supabase
    .from("goals").select("id").eq("site_id", siteId).eq("title", ANNUAL_GOAL.title).maybeSingle();
  if (!existing) {
    const { error } = await supabase.from("goals").insert({
      organization_id: orgId, site_id: siteId,
      title: ANNUAL_GOAL.title, goal_type: ANNUAL_GOAL.goal_type,
      owner_id: ids[ANNUAL_GOAL.owner],
      start_date: ANNUAL_GOAL.start_date, due_date: ANNUAL_GOAL.due_date,
      status: ANNUAL_GOAL.status, success_criteria: ANNUAL_GOAL.success_criteria,
    });
    if (error) fail(`goal: ${error.message}`);
  }
  ok("annual goal");
}

async function ensureRaci(orgId: string, siteId: string) {
  const { count } = await supabase
    .from("raci_entries").select("id", { count: "exact", head: true }).eq("site_id", siteId);
  if ((count ?? 0) === 0) {
    const rows = RACI.map((r, i) => ({
      organization_id: orgId, site_id: siteId,
      workstream: r.workstream, assignments: r.assignments, sort_order: i + 1,
    }));
    const { error } = await supabase.from("raci_entries").insert(rows);
    if (error) fail(`raci: ${error.message}`);
  }
  ok(`${RACI.length} RACI reference rows`);
}

async function main() {
  const ids = await ensureUsers();
  const { orgId, siteId } = await ensureOrgAndSite();
  await ensureMemberships(orgId, siteId, ids);
  const projectIds = await ensureProjects(orgId, siteId, ids);
  await ensureTasks(orgId, siteId, ids, projectIds);
  await ensureMilestones(orgId, siteId, ids);
  await ensureKpis(orgId, siteId, ids);
  await ensureFolders(orgId);
  await ensureGoal(orgId, siteId, ids);
  await ensureRaci(orgId, siteId);
  console.log("\nSeed complete. Run `npm run db:verify` to validate.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
