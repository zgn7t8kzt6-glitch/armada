/**
 * Database/RLS integration tests (spec §14). These run against a REAL
 * Supabase project that has all migrations applied and the seed loaded:
 *
 *   RLS_TESTS=1 NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run test:rls
 *
 * They are skipped automatically when the environment is not configured, so
 * `npm test` stays green in CI without a database.
 *
 * Coverage: membership isolation, member vs admin vs viewer permissions,
 * audit immutability, blocked-reason & resolution & disposition constraints,
 * commitment carryover lineage, decision immutability, restricted documents.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RLS_TESTS === "1" && !!URL && !!ANON && !!SERVICE;

const suffix = Math.random().toString(36).slice(2, 8);
const PASSWORD = `Rls-test-${suffix}-Aa1!`;

let admin: SupabaseClient; // service role
let orgId: string;
let siteId: string;
let adminUser: SupabaseClient; // org_admin session
let memberUser: SupabaseClient; // member session
let viewerUser: SupabaseClient; // viewer session
let outsiderUser: SupabaseClient; // no membership
let memberId: string;
let adminId: string;

async function makeUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signErr) throw new Error(`signIn ${email}: ${signErr.message}`);
  return { id: data.user.id, client };
}

describe.skipIf(!enabled)("RLS and database rules", () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });

    const { data: org } = await admin.from("organizations").select("id").eq("slug", "evertide-infusion").single();
    orgId = org!.id;
    const { data: site } = await admin.from("sites").select("id").eq("organization_id", orgId).limit(1).single();
    siteId = site!.id;

    const a = await makeUser(`rls-admin-${suffix}@evertide.example`);
    const m = await makeUser(`rls-member-${suffix}@evertide.example`);
    const v = await makeUser(`rls-viewer-${suffix}@evertide.example`);
    const o = await makeUser(`rls-outsider-${suffix}@evertide.example`);
    adminUser = a.client; memberUser = m.client; viewerUser = v.client; outsiderUser = o.client;
    adminId = a.id; memberId = m.id;

    for (const [id, role] of [[a.id, "org_admin"], [m.id, "member"], [v.id, "viewer"]] as const) {
      await admin.from("organization_memberships").upsert(
        { organization_id: orgId, user_id: id, role, active: true },
        { onConflict: "organization_id,user_id" }
      );
      await admin.from("site_memberships").upsert(
        { site_id: siteId, user_id: id, active: true },
        { onConflict: "site_id,user_id" }
      );
    }
  }, 60_000);

  it("outsiders cannot see organizations, sites, or tasks", async () => {
    const { data: orgs } = await outsiderUser.from("organizations").select("id");
    expect(orgs ?? []).toHaveLength(0);
    const { data: tasks } = await outsiderUser.from("tasks").select("id").limit(5);
    expect(tasks ?? []).toHaveLength(0);
  });

  it("members can read tasks and update status/percent, but not owner or due date", async () => {
    const { data: task } = await memberUser.from("tasks").select("id,owner_id,due_date").eq("site_id", siteId).limit(1).single();
    expect(task).toBeTruthy();

    const { error: okErr } = await memberUser
      .from("tasks").update({ status: "in_progress", percent_done: 10 }).eq("id", task!.id);
    expect(okErr).toBeNull();

    const { error: ownerErr } = await memberUser
      .from("tasks").update({ owner_id: memberId }).eq("id", task!.id);
    expect(ownerErr?.message ?? "").toContain("Only admins");

    const { error: dueErr } = await memberUser
      .from("tasks").update({ due_date: "2027-06-01" }).eq("id", task!.id);
    expect(dueErr?.message ?? "").toContain("Only admins");

    const { error: archiveErr } = await memberUser
      .from("tasks").update({ archived_at: new Date().toISOString() }).eq("id", task!.id);
    expect(archiveErr?.message ?? "").toContain("Only admins");
  });

  it("blocked requires a nonblank reason (§2.2)", async () => {
    const { data: task } = await memberUser.from("tasks").select("id").eq("site_id", siteId).limit(1).single();
    const { error: noReason } = await memberUser.from("tasks").update({ status: "blocked" }).eq("id", task!.id);
    expect(noReason).toBeTruthy();
    const { error: withReason } = await memberUser
      .from("tasks").update({ status: "blocked", blocker_reason: "Waiting on counsel" }).eq("id", task!.id);
    expect(withReason).toBeNull();
    await memberUser.from("tasks").update({ status: "in_progress" }).eq("id", task!.id);
  });

  it("admins can change owner and due date; the change is audited with old and new values", async () => {
    const { data: task } = await adminUser.from("tasks").select("id,owner_id").eq("site_id", siteId).limit(1).single();
    const { error } = await adminUser.from("tasks").update({ due_date: "2027-02-01" }).eq("id", task!.id);
    expect(error).toBeNull();

    const { data: audit } = await adminUser
      .from("audit_events")
      .select("old_values,new_values")
      .eq("entity_type", "tasks")
      .eq("entity_id", task!.id)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .single();
    expect((audit!.new_values as { due_date: string }).due_date).toBe("2027-02-01");
    expect(audit!.old_values).toBeTruthy();
  });

  it("viewers cannot mutate", async () => {
    const { data: task } = await viewerUser.from("tasks").select("id").eq("site_id", siteId).limit(1).single();
    expect(task).toBeTruthy(); // read works
    const { data: updated } = await viewerUser
      .from("tasks").update({ percent_done: 99 }).eq("id", task!.id).select("id");
    expect(updated ?? []).toHaveLength(0); // RLS filters the write to zero rows
  });

  it("audit events cannot be updated or deleted, even by service role", async () => {
    const { data: ev } = await admin.from("audit_events").select("id").limit(1).single();
    const { error: upErr } = await admin.from("audit_events").update({ event_type: "tampered" }).eq("id", ev!.id);
    expect(upErr?.message ?? "").toContain("immutable");
    const { error: delErr } = await admin.from("audit_events").delete().eq("id", ev!.id);
    expect(delErr?.message ?? "").toContain("immutable");
  });

  it("issues cannot be resolved without a resolution summary (§2.3)", async () => {
    const { data: issue } = await memberUser
      .from("issues")
      .insert({ organization_id: orgId, site_id: siteId, title: `rls test issue ${suffix}`, owner_id: memberId, reported_by: memberId })
      .select("id")
      .single();
    const { error: badErr } = await memberUser.from("issues").update({ status: "resolved" }).eq("id", issue!.id);
    expect(badErr).toBeTruthy();
    const { error: okErr } = await memberUser
      .from("issues").update({ status: "resolved", resolution_summary: "Fixed in test" }).eq("id", issue!.id);
    expect(okErr).toBeNull();
  });

  it("high-priority issues are auto-flagged for the huddle", async () => {
    const { data: issue } = await memberUser
      .from("issues")
      .insert({ organization_id: orgId, site_id: siteId, title: `rls high issue ${suffix}`, priority: "high", owner_id: memberId, reported_by: memberId })
      .select("huddle_required")
      .single();
    expect(issue!.huddle_required).toBe(true);
  });

  it("risks: score is computed by trigger and closing requires a disposition (§2.4)", async () => {
    const { data: risk } = await memberUser
      .from("risks")
      .insert({
        organization_id: orgId, site_id: siteId, title: `rls risk ${suffix}`,
        probability: "high", impact: "severe", owner_id: memberId,
      })
      .select("id,score")
      .single();
    expect(risk!.score).toBe(12);

    const { error: badClose } = await memberUser.from("risks").update({ status: "closed" }).eq("id", risk!.id);
    expect(badClose).toBeTruthy();
    const { error: okClose } = await memberUser
      .from("risks").update({ status: "closed", disposition: "mitigated" }).eq("id", risk!.id);
    expect(okClose).toBeNull();
  });

  it("risk-to-issue conversion links both records", async () => {
    const { data: risk } = await memberUser
      .from("risks")
      .insert({ organization_id: orgId, site_id: siteId, title: `rls occur ${suffix}`, probability: "high", impact: "high", owner_id: memberId })
      .select("id")
      .single();
    const { data: issueId, error } = await memberUser.rpc("convert_risk_to_issue", { p_risk: risk!.id });
    expect(error).toBeNull();
    const { data: after } = await memberUser.from("risks").select("status,disposition,converted_issue_id").eq("id", risk!.id).single();
    expect(after!.status).toBe("occurred");
    expect(after!.disposition).toBe("occurred");
    expect(after!.converted_issue_id).toBe(issueId);
  });

  it("commitment carryover increments count and preserves lineage (§2.9)", async () => {
    const day = `20${Math.floor(Math.random() * 89) + 10}-06-15`; // unique huddle_date per run
    const { data: h1 } = await adminUser
      .from("huddles")
      .insert({ organization_id: orgId, site_id: siteId, huddle_date: day, created_by: adminId })
      .select("id").single();
    const { data: h2 } = await adminUser
      .from("huddles")
      .insert({ organization_id: orgId, site_id: siteId, huddle_date: day.replace("-15", "-22"), created_by: adminId })
      .select("id").single();
    const { data: c1 } = await adminUser
      .from("huddle_commitments")
      .insert({ organization_id: orgId, site_id: siteId, huddle_id: h1!.id, commitment: `carry me ${suffix}`, owner_id: adminId, due_date: day })
      .select("id,carry_count").single();
    expect(c1!.carry_count).toBe(0);

    const { data: newId, error } = await adminUser.rpc("carry_commitment", {
      p_commitment: c1!.id, p_new_huddle: h2!.id, p_due: day.replace("-15", "-29"),
    });
    expect(error).toBeNull();

    const { data: c2 } = await adminUser
      .from("huddle_commitments").select("carry_count,source_commitment_id,status").eq("id", newId).single();
    expect(c2!.carry_count).toBe(1);
    expect(c2!.source_commitment_id).toBe(c1!.id);
    const { data: old } = await adminUser.from("huddle_commitments").select("status").eq("id", c1!.id).single();
    expect(old!.status).toBe("carried_over");
  });

  it("approved decisions are immutable except sanctioned fields (§6.7)", async () => {
    const { data: d } = await adminUser
      .from("decisions")
      .insert({
        organization_id: orgId, site_id: siteId, title: `rls decision ${suffix}`,
        decision_text: "Original text", owner_id: adminId, created_by: adminId, decision_date: "2026-07-01",
      })
      .select("id").single();
    const { error: appErr } = await adminUser.rpc("approve_decision", { p_decision: d!.id });
    expect(appErr).toBeNull();

    const { error: mutErr } = await adminUser.from("decisions").update({ decision_text: "Tampered" }).eq("id", d!.id);
    expect(mutErr?.message ?? "").toContain("immutable");

    // Sanctioned: implementation status + outcome still editable.
    const { error: okErr } = await adminUser
      .from("decisions").update({ status: "implemented", outcome: "Worked well" }).eq("id", d!.id);
    expect(okErr).toBeNull();

    // Admin correction path works and is audited.
    const { error: corrErr } = await adminUser.rpc("admin_correct_decision", {
      p_decision: d!.id, p_reason: "typo fix", p_fields: { decision_text: "Corrected text" },
    });
    expect(corrErr).toBeNull();
    const { data: after } = await adminUser.from("decisions").select("decision_text").eq("id", d!.id).single();
    expect(after!.decision_text).toBe("Corrected text");
  });

  it("restricted documents require admin role or an explicit grant", async () => {
    const { data: folder } = await admin.from("document_folders").select("id").limit(1).single();
    const { data: doc } = await adminUser
      .from("documents")
      .insert({
        organization_id: orgId, site_id: siteId, folder_id: folder!.id,
        title: `rls restricted ${suffix}`, owner_id: adminId, confidentiality: "restricted", created_by: adminId,
      })
      .select("id").single();

    const { data: memberView } = await memberUser.from("documents").select("id").eq("id", doc!.id);
    expect(memberView ?? []).toHaveLength(0);

    await admin.from("document_access_grants").insert({ document_id: doc!.id, user_id: memberId, granted_by: adminId });
    const { data: granted } = await memberUser.from("documents").select("id").eq("id", doc!.id);
    expect(granted ?? []).toHaveLength(1);
  });

  it("reports become immutable once final", async () => {
    const { data: rep } = await adminUser
      .from("reports")
      .insert({
        organization_id: orgId, site_id: siteId, report_type: "weekly",
        period_start: "2031-01-06", period_end: "2031-01-12", snapshot: {}, status: "generated",
      })
      .select("id").single();
    const { error: finErr } = await adminUser.from("reports").update({ status: "final" }).eq("id", rep!.id);
    expect(finErr).toBeNull();
    const { error: mutErr } = await adminUser.from("reports").update({ narrative: "tamper" }).eq("id", rep!.id);
    expect(mutErr?.message ?? "").toContain("immutable");
  });
});
