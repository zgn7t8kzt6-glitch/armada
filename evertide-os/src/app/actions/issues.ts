"use server";

// Defect log mutations (§6.5, §7.7).
import { revalidatePath } from "next/cache";
import { getAppContext, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueCommentSchema, issueCreateSchema, issueUpdateSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, dbMsg, messageOf, type ActionResult } from "./helpers";

function revalidate(issueId?: string) {
  revalidatePath("/issues");
  if (issueId) revalidatePath(`/issues/${issueId}`);
  revalidatePath("/");
}

export async function createIssue(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "issue");
    const data = parseForm(issueCreateSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("issues").insert({
      organization_id: ctx.organization.id,
      site_id: ctx.site.id,
      project_id: data.projectId ?? null,
      task_id: data.taskId ?? null,
      title: data.title,
      description: data.description ?? null,
      category: data.category ?? null,
      priority: data.priority,
      owner_id: data.ownerId,
      reported_by: ctx.userId,
      due_date: data.dueDate ?? null,
    });
    if (dbErr) return err(dbMsg(dbErr));
    revalidate();
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Updates enforce: resolved/closed requires a resolution summary (§2.3) —
// checked here for a friendly message and again by the DB constraint.
export async function updateIssue(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "issue");
    const data = parseForm(issueUpdateSchema, formData);

    const supabase = supabaseServer();
    const { data: current } = await supabase
      .from("issues").select("status,resolution_summary").eq("id", data.issueId).maybeSingle();
    if (!current) return err("Issue not found");

    const nextStatus = data.status ?? (current.status as string);
    const nextResolution = data.resolutionSummary ?? (current.resolution_summary as string | null);
    if ((nextStatus === "resolved" || nextStatus === "closed") && !nextResolution?.trim()) {
      return err("A resolution summary is required to resolve or close an issue.");
    }

    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.ownerId !== undefined) patch.owner_id = data.ownerId;
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;
    if (data.rootCause !== undefined) patch.root_cause = data.rootCause;
    if (data.correctiveAction !== undefined) patch.corrective_action = data.correctiveAction;
    if (data.resolutionSummary !== undefined) patch.resolution_summary = data.resolutionSummary;
    if (data.huddleRequired !== undefined) patch.huddle_required = data.huddleRequired;
    if (data.relatedIssueId !== undefined) patch.related_issue_id = data.relatedIssueId;

    const { error: dbErr } = await supabase.from("issues").update(patch).eq("id", data.issueId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidate(data.issueId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function addIssueComment(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "comment", 60);
    const data = parseForm(issueCommentSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("issue_updates").insert({
      issue_id: data.issueId,
      author_id: ctx.userId,
      body: data.body,
    });
    if (dbErr) return err(dbMsg(dbErr));
    revalidate(data.issueId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Reopen with a required reason; prior resolution history is preserved by
// the issue_guard trigger (§6.5).
export async function reopenIssue(issueId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(issueId);
    if (!reason.trim()) return err("A reason is required to reopen an issue.");

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("issues").update({ status: "open" }).eq("id", issueId);
    if (dbErr) return err(dbMsg(dbErr));
    const { error: cErr } = await supabase.from("issue_updates").insert({
      issue_id: issueId,
      author_id: ctx.userId,
      body: `Reopen reason: ${reason.trim()}`,
    });
    if (cErr) return err(dbMsg(cErr));
    revalidate(issueId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function sendIssueToHuddle(issueId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(issueId);
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("issues").update({ huddle_required: true }).eq("id", issueId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidate(issueId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
