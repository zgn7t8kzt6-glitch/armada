/**
 * EverTide OS — seed verification (deliverable 13). Fails (exit 1) unless
 * counts and relationships match the specification exactly.
 */
import { loadEnv, adminClient, fail, ok } from "./lib";
import { ORGANIZATION, SITE, USERS, TASKS, MILESTONES, KPIS, FOLDERS, ANNUAL_GOAL, RACI } from "./seed-data";

loadEnv();
const supabase = adminClient();

async function main() {
  const { data: org } = await supabase
    .from("organizations").select("id,name").eq("slug", ORGANIZATION.slug).maybeSingle();
  if (!org) fail(`organization '${ORGANIZATION.slug}' missing`);
  ok(`organization: ${org.name}`);

  const { data: site } = await supabase
    .from("sites").select("id,name,timezone,target_opening_date")
    .eq("organization_id", org.id).eq("slug", SITE.slug).maybeSingle();
  if (!site) fail(`site '${SITE.slug}' missing`);
  if (site.timezone !== SITE.timezone) fail(`site timezone ${site.timezone} ≠ ${SITE.timezone}`);
  if (site.target_opening_date !== SITE.target_opening_date)
    fail(`target opening date ${site.target_opening_date} ≠ ${SITE.target_opening_date}`);
  ok(`site: ${site.name} (${site.timezone}, opens ${site.target_opening_date})`);

  // Users, profiles, memberships
  const { data: profiles } = await supabase.from("profiles").select("id,name,email");
  const profileByName = new Map((profiles ?? []).map((p) => [p.name, p]));
  for (const u of USERS) {
    if (!profileByName.has(u.name)) fail(`profile missing: ${u.name}`);
  }
  const { count: omCount } = await supabase
    .from("organization_memberships").select("id", { count: "exact", head: true })
    .eq("organization_id", org.id).eq("active", true);
  if ((omCount ?? 0) < USERS.length) fail(`expected ≥${USERS.length} active org memberships, found ${omCount}`);
  ok(`${USERS.length} profiles with active memberships`);

  // Tasks: exactly 60, unique legacy ids 1..60, owners and dates correct
  const { data: tasks } = await supabase
    .from("tasks")
    .select("legacy_id,title,owner_id,start_date,due_date,status,percent_done,critical,project_id")
    .eq("site_id", site.id).not("legacy_id", "is", null);
  if ((tasks ?? []).length !== TASKS.length) fail(`expected ${TASKS.length} tasks, found ${tasks?.length}`);
  const byLegacy = new Map((tasks ?? []).map((t) => [t.legacy_id, t]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p.name]));
  for (const spec of TASKS) {
    const t = byLegacy.get(spec.legacy_id);
    if (!t) fail(`task legacy_id ${spec.legacy_id} missing`);
    if (profileById.get(t!.owner_id) !== spec.owner)
      fail(`task ${spec.legacy_id}: owner ${profileById.get(t!.owner_id)} ≠ ${spec.owner}`);
    if (t!.due_date !== spec.due_date) fail(`task ${spec.legacy_id}: due ${t!.due_date} ≠ ${spec.due_date}`);
    if (t!.start_date !== spec.start_date) fail(`task ${spec.legacy_id}: start ${t!.start_date} ≠ ${spec.start_date}`);
    if (t!.critical !== spec.critical) fail(`task ${spec.legacy_id}: critical flag mismatch`);
    if (!t!.project_id) fail(`task ${spec.legacy_id}: not attached to a project`);
    if (!t!.owner_id) fail(`task ${spec.legacy_id}: no owner`);
  }
  ok(`${TASKS.length} tasks with correct owners, dates, criticality, and projects`);

  // Projects: one per unique phase/workstream combo
  const combos = new Set(TASKS.map((t) => `${t.phase}|${t.workstream}`));
  const { data: projects } = await supabase
    .from("projects").select("id,phase,workstream,owner_id").eq("site_id", site.id).is("archived_at", null);
  if ((projects ?? []).length !== combos.size)
    fail(`expected ${combos.size} projects, found ${projects?.length}`);
  for (const p of projects ?? []) {
    if (!p.owner_id) fail(`project ${p.phase}/${p.workstream}: no owner`);
  }
  ok(`${combos.size} projects (one per phase/workstream combo), all owned`);

  // Milestones: exactly 12 with correct owners/dates
  const { data: milestones } = await supabase
    .from("milestones").select("title,target_date,owner_id").eq("site_id", site.id);
  if ((milestones ?? []).length !== MILESTONES.length)
    fail(`expected ${MILESTONES.length} milestones, found ${milestones?.length}`);
  for (const spec of MILESTONES) {
    const m = (milestones ?? []).find((x) => x.title === spec.title);
    if (!m) fail(`milestone missing: ${spec.title}`);
    if (m!.target_date !== spec.target_date) fail(`milestone ${spec.title}: date mismatch`);
    if (profileById.get(m!.owner_id) !== spec.owner) fail(`milestone ${spec.title}: owner mismatch`);
  }
  ok(`${MILESTONES.length} milestones with correct owners and dates`);

  // KPIs: exactly 11 across the four categories, all owned
  const { data: kpis } = await supabase
    .from("kpis").select("name,category,owner_id,frequency,direction").eq("site_id", site.id);
  if ((kpis ?? []).length !== KPIS.length) fail(`expected ${KPIS.length} KPIs, found ${kpis?.length}`);
  const cats = new Set((kpis ?? []).map((k) => k.category));
  for (const c of ["Financial", "Operations", "Clinical", "Growth"]) {
    if (!cats.has(c)) fail(`KPI category missing: ${c}`);
  }
  for (const spec of KPIS) {
    const k = (kpis ?? []).find((x) => x.name === spec.name);
    if (!k) fail(`KPI missing: ${spec.name}`);
    if (profileById.get(k!.owner_id) !== spec.owner) fail(`KPI ${spec.name}: owner mismatch`);
  }
  ok(`${KPIS.length} KPIs across 4 categories, all owned`);

  // Document folders: the 12-folder taxonomy
  const { data: folders } = await supabase
    .from("document_folders").select("name").eq("organization_id", org.id)
    .is("site_id", null).is("parent_folder_id", null);
  for (const f of FOLDERS) {
    if (!(folders ?? []).some((x) => x.name === f)) fail(`folder missing: ${f}`);
  }
  ok(`${FOLDERS.length} document folders`);

  // Annual goal
  const { data: goal } = await supabase
    .from("goals").select("id,owner_id,status").eq("site_id", site.id).eq("title", ANNUAL_GOAL.title).maybeSingle();
  if (!goal) fail("annual goal missing");
  if (!goal.owner_id) fail("annual goal has no owner");
  ok("annual goal present and owned");

  // RACI reference
  const { count: raciCount } = await supabase
    .from("raci_entries").select("id", { count: "exact", head: true }).eq("site_id", site.id);
  if ((raciCount ?? 0) !== RACI.length) fail(`expected ${RACI.length} RACI rows, found ${raciCount}`);
  ok(`${RACI.length} RACI reference rows`);

  console.log("\nSeed verification passed.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
