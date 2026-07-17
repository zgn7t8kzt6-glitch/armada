"use server";

// Decision log mutations (§6.7, §7.9). Approval, supersession, and admin
// correction run through the transactional RPCs; the decisions_guard trigger
// enforces immutability of approved decisions.
import { revalidatePath } from "next/cache";
import { getAppContext, requireAdmin, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { decisionCreateSchema, decisionEditSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";

function revalidate(id?: string) {
  revalidatePath("/decisions");
  if (id) revalidatePath(`/decisions/${id}`);
  revalidatePath("/");
}

export async function createDecision(formData: FormData): Promise<ActionResult & { decisionId?: string }> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "decision");
    const data = parseForm(decisionCreateSchema, formData);

    const supabase = supabaseServer();
    const { data: row, error: dbErr } = await supabase
      .from("decisions")
      .insert({
        organization_id: ctx.organization.id,
        site_id: data.siteId ?? ctx.site.id,
        project_id: data.projectId ?? null,
        title: data.title,
        context: data.context ?? null,
        decision_text: data.decisionText ?? null,
        rationale: data.rationale ?? null,
        alternatives_considered: data.alternativesConsidered ?? null,
        decision_date: data.decisionDate,
        owner_id: data.ownerId,
        review_date: data.reviewDate ?? null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select("id")
      .single();
    if (dbErr || !row) return err(dbErr?.message ?? "Failed to create decision");
    revalidate(row.id);
    return { ok: true, decisionId: row.id };
  } catch (e) {
    return err(messageOf(e));
  }
}

// Editing: proposed decisions are freely editable; approved ones only allow
// implementation status, review date, and outcome (trigger-enforced too).
export async function editDecision(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "decision");
    const data = parseForm(decisionEditSchema, formData);

    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    if (data.title !== undefined) patch.title = data.title;
    if (data.context !== undefined) patch.context = data.context;
    if (data.decisionText !== undefined) patch.decision_text = data.decisionText;
    if (data.rationale !== undefined) patch.rationale = data.rationale;
    if (data.alternativesConsidered !== undefined) patch.alternatives_considered = data.alternativesConsidered;
    if (data.reviewDate !== undefined) patch.review_date = data.reviewDate;
    if (data.status !== undefined) patch.status = data.status;
    if (data.outcome !== undefined) patch.outcome = data.outcome;

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("decisions").update(patch).eq("id", data.decisionId);
    if (dbErr) return err(dbErr.message);
    revalidate(data.decisionId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function approveDecision(decisionId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    uuid.parse(decisionId);
    const supabase = supabaseServer();
    const { error: rpcErr } = await supabase.rpc("approve_decision", { p_decision: decisionId });
    if (rpcErr) return err(rpcErr.message);
    revalidate(decisionId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Supersede: creates the replacement (proposed), then marks the old one
// superseded and links them — atomic via RPC.
export async function supersedeDecision(oldId: string, formData: FormData): Promise<ActionResult & { decisionId?: string }> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    uuid.parse(oldId);
    const created = await createDecision(formData);
    if (!created.ok || !created.decisionId) return created;

    const supabase = supabaseServer();
    const { error: rpcErr } = await supabase.rpc("supersede_decision", { p_old: oldId, p_new: created.decisionId });
    if (rpcErr) return err(rpcErr.message);
    revalidate(oldId);
    revalidate(created.decisionId);
    return { ok: true, decisionId: created.decisionId };
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function adminCorrectDecision(decisionId: string, reason: string, fields: Record<string, string>): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    uuid.parse(decisionId);
    if (!reason.trim()) return err("A correction reason is required.");
    const allowed = ["title", "context", "decision_text", "rationale", "alternatives_considered"];
    const safeFields = Object.fromEntries(Object.entries(fields).filter(([k, v]) => allowed.includes(k) && typeof v === "string"));
    const supabase = supabaseServer();
    const { error: rpcErr } = await supabase.rpc("admin_correct_decision", {
      p_decision: decisionId,
      p_reason: reason.trim(),
      p_fields: safeFields,
    });
    if (rpcErr) return err(rpcErr.message);
    revalidate(decisionId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function linkDecision(decisionId: string, linkedType: string, linkedId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(decisionId);
    uuid.parse(linkedId);
    if (!["task", "issue", "risk", "document", "vendor", "goal", "milestone"].includes(linkedType)) {
      return err("Invalid link type");
    }
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("decision_links")
      .insert({ decision_id: decisionId, linked_type: linkedType, linked_id: linkedId });
    if (dbErr) return err(dbErr.message);
    revalidate(decisionId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
