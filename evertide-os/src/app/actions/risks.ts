"use server";

// Risk register mutations (§6.6, §7.8).
import { revalidatePath } from "next/cache";
import { getAppContext, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { riskCreateSchema, riskUpdateSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";

function revalidate(riskId?: string) {
  revalidatePath("/risks");
  if (riskId) revalidatePath(`/risks/${riskId}`);
  revalidatePath("/");
}

export async function createRisk(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "risk");
    const data = parseForm(riskCreateSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("risks").insert({
      organization_id: ctx.organization.id,
      site_id: ctx.site.id,
      title: data.title,
      description: data.description ?? null,
      category: data.category ?? null,
      probability: data.probability,
      impact: data.impact,
      owner_id: data.ownerId,
      mitigation_plan: data.mitigationPlan ?? null,
      trigger_condition: data.triggerCondition ?? null,
      review_date: data.reviewDate ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (dbErr) return err(dbErr.message);
    revalidate();
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Closing requires a disposition (§2.4) — friendly check here, hard CHECK in DB.
export async function updateRisk(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "risk");
    const data = parseForm(riskUpdateSchema, formData);

    if ((data.status === "closed" || data.status === "occurred") && !data.disposition) {
      return err("Closing a risk requires a disposition: avoided, mitigated, accepted, transferred, or occurred.");
    }

    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.probability !== undefined) patch.probability = data.probability;
    if (data.impact !== undefined) patch.impact = data.impact;
    if (data.ownerId !== undefined) patch.owner_id = data.ownerId;
    if (data.mitigationPlan !== undefined) patch.mitigation_plan = data.mitigationPlan;
    if (data.triggerCondition !== undefined) patch.trigger_condition = data.triggerCondition;
    if (data.reviewDate !== undefined) patch.review_date = data.reviewDate;
    if (data.status !== undefined) patch.status = data.status;
    if (data.disposition !== undefined) patch.disposition = data.disposition;

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("risks").update(patch).eq("id", data.riskId);
    if (dbErr) return err(dbErr.message);
    revalidate(data.riskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Convert an occurred risk into a linked issue (retains the risk) via RPC.
export async function convertRiskToIssue(riskId: string): Promise<ActionResult & { issueId?: string }> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(riskId);
    const supabase = supabaseServer();
    const { data, error: rpcErr } = await supabase.rpc("convert_risk_to_issue", { p_risk: riskId });
    if (rpcErr) return err(rpcErr.message);
    revalidate(riskId);
    revalidatePath("/issues");
    return { ok: true, issueId: data as string };
  } catch (e) {
    return err(messageOf(e));
  }
}
