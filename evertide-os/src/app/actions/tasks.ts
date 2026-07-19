"use server";

// Task mutations (§6.3, §7.4). Every action re-checks authorization at the
// application layer; database triggers and RLS remain the final enforcement.
import { revalidatePath } from "next/cache";
import { getAppContext, requireAdmin, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  commentSchema, dependencySchema, helperSchema, taskCreateSchema,
  taskReassignSchema, taskStatusChangeSchema, taskUpdateFieldsSchema, archiveSchema,
} from "@/lib/schemas";
import { parseForm, err, OK, dbMsg, messageOf, type ActionResult } from "./helpers";

function revalidateTaskPaths(taskId?: string) {
  revalidatePath("/projects");
  revalidatePath("/my-work");
  revalidatePath("/");
  if (taskId) revalidatePath(`/projects/tasks/${taskId}`);
}

export async function createTask(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "task-write");
    const data = parseForm(taskCreateSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("tasks").insert({
      organization_id: ctx.organization.id,
      site_id: ctx.site.id,
      project_id: data.projectId ?? null,
      milestone_id: data.milestoneId ?? null,
      title: data.title,
      description: data.description ?? null,
      owner_id: data.ownerId,
      start_date: data.startDate ?? null,
      due_date: data.dueDate ?? null,
      priority: data.priority,
      critical: data.critical,
      phase: data.phase ?? null,
      workstream: data.workstream ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths();
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Status transitions enforce the blocked-reason rule client- and DB-side (§2.2).
export async function changeTaskStatus(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "task-write");
    const data = parseForm(taskStatusChangeSchema, formData);
    if (data.status === "blocked" && !data.blockerReason) {
      return err("A current blocking reason is required to mark a task blocked.");
    }

    const supabase = supabaseServer();
    const patch: Record<string, unknown> = {
      status: data.status,
      updated_by: ctx.userId,
      blocker_reason: data.status === "blocked" ? data.blockerReason : null,
    };
    if (data.status === "done") patch.percent_done = 100;
    else if (data.percentDone !== undefined) patch.percent_done = data.percentDone;

    const { error: dbErr } = await supabase.from("tasks").update(patch).eq("id", data.taskId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths(data.taskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function updateTaskFields(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "task-write");
    const data = parseForm(taskUpdateFieldsSchema, formData);

    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.percentDone !== undefined) patch.percent_done = data.percentDone;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.critical !== undefined) patch.critical = data.critical;
    if (data.projectId !== undefined) patch.project_id = data.projectId;
    if (data.milestoneId !== undefined) patch.milestone_id = data.milestoneId;

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("tasks").update(patch).eq("id", data.taskId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths(data.taskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Owner and due-date changes are admin-only (§7.4); the tasks_guard trigger
// enforces the same rule in the database.
export async function reassignTask(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    checkRateLimit(ctx.userId, "task-admin");
    const data = parseForm(taskReassignSchema, formData);

    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    if (data.ownerId !== undefined) patch.owner_id = data.ownerId;
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;
    if (data.startDate !== undefined) patch.start_date = data.startDate;

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("tasks").update(patch).eq("id", data.taskId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths(data.taskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function addTaskComment(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "comment", 60);
    const data = parseForm(commentSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("task_updates").insert({
      organization_id: ctx.organization.id,
      site_id: ctx.site.id,
      task_id: data.taskId,
      author_id: ctx.userId,
      update_type: "comment",
      body: data.body,
    });
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths(data.taskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function toggleTaskHelper(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    const data = parseForm(helperSchema, formData);

    const supabase = supabaseServer();
    const { data: existing } = await supabase
      .from("task_helpers").select("task_id").eq("task_id", data.taskId).eq("user_id", data.userId).maybeSingle();
    if (existing) {
      const { error: dbErr } = await supabase
        .from("task_helpers").delete().eq("task_id", data.taskId).eq("user_id", data.userId);
      if (dbErr) return err(dbMsg(dbErr));
    } else {
      const { error: dbErr } = await supabase
        .from("task_helpers").insert({ task_id: data.taskId, user_id: data.userId });
      if (dbErr) return err(dbMsg(dbErr));
    }
    revalidateTaskPaths(data.taskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function addDependency(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    const data = parseForm(dependencySchema, formData);
    if (data.predecessorId === data.successorId) return err("A task cannot depend on itself.");

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("task_dependencies").insert({
      predecessor_task_id: data.predecessorId,
      successor_task_id: data.successorId,
      dependency_type: data.dependencyType,
      lag_days: data.lagDays,
    });
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths(data.successorId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function removeDependency(dependencyId: string, taskId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("task_dependencies").delete().eq("id", dependencyId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths(taskId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Generic archive/restore for business records — admin only (§2.7, §11.14).
export async function archiveRecord(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    checkRateLimit(ctx.userId, "archive");
    const data = parseForm(archiveSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from(data.entity)
      .update({ archived_at: data.restore ? null : new Date().toISOString() })
      .eq("id", data.id);
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths();
    revalidatePath("/admin/archive");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Bulk owner/due-date changes are admin-only and fully audited via the
// per-row triggers (§7.4). Bulk status change is intentionally not offered.
export async function bulkReassign(taskIds: string[], ownerId: string | null, dueDate: string | null): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    checkRateLimit(ctx.userId, "task-admin");
    if (taskIds.length === 0 || taskIds.length > 100) return err("Select between 1 and 100 tasks.");
    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    if (ownerId) patch.owner_id = ownerId;
    if (dueDate) patch.due_date = dueDate;
    if (Object.keys(patch).length === 1) return err("Nothing to change.");

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("tasks").update(patch).in("id", taskIds);
    if (dbErr) return err(dbMsg(dbErr));
    revalidateTaskPaths();
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
