"use server";

// Strategy / goals mutations (§6.2, §7.3).
import { revalidatePath } from "next/cache";
import { getAppContext, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { goalCreateSchema, goalUpdateSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";

export async function createGoal(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "goal");
    const data = parseForm(goalCreateSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("goals").insert({
      organization_id: ctx.organization.id,
      site_id: data.siteId ?? ctx.site.id,
      parent_goal_id: data.parentGoalId ?? null,
      title: data.title,
      description: data.description ?? null,
      goal_type: data.goalType,
      start_date: data.startDate ?? null,
      due_date: data.dueDate ?? null,
      owner_id: data.ownerId,
      status: "active",
      success_criteria: data.successCriteria ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (dbErr) return err(dbErr.message);
    revalidatePath("/strategy");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function updateGoal(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "goal");
    const data = parseForm(goalUpdateSchema, formData);

    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.status !== undefined) patch.status = data.status;
    if (data.progressPercent !== undefined) patch.progress_percent = data.progressPercent;
    if (data.successCriteria !== undefined) patch.success_criteria = data.successCriteria;

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("goals").update(patch).eq("id", data.goalId);
    if (dbErr) return err(dbErr.message);
    revalidatePath("/strategy");
    revalidatePath(`/strategy/${data.goalId}`);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function linkGoal(goalId: string, linkedType: string, linkedId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(goalId);
    uuid.parse(linkedId);
    if (!["project", "kpi", "milestone"].includes(linkedType)) return err("Invalid link type");
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("goal_links")
      .insert({ goal_id: goalId, linked_type: linkedType, linked_id: linkedId });
    if (dbErr) return err(dbErr.message);
    revalidatePath("/strategy");
    revalidatePath(`/strategy/${goalId}`);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
