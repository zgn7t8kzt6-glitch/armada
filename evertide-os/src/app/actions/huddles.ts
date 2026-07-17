"use server";

// Huddle lifecycle and commitments (§6.9, §7.6). Multi-step transitions go
// through the transactional RPCs from migration 0007.
import { revalidatePath } from "next/cache";
import { getAppContext, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { commitmentCreateSchema, commitmentResolveSchema, huddleCreateSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";

function revalidate(huddleId?: string) {
  revalidatePath("/huddles");
  if (huddleId) revalidatePath(`/huddles/${huddleId}`);
  revalidatePath("/");
}

export async function createHuddle(formData: FormData): Promise<ActionResult & { huddleId?: string }> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "huddle");
    const data = parseForm(huddleCreateSchema, formData);

    const supabase = supabaseServer();
    const { data: row, error: dbErr } = await supabase
      .from("huddles")
      .insert({
        organization_id: ctx.organization.id,
        site_id: ctx.site.id,
        huddle_date: data.huddleDate,
        facilitator_id: data.facilitatorId ?? ctx.userId,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (dbErr || !row) return err(dbErr?.message ?? "Failed to create huddle");
    revalidate(row.id);
    return { ok: true, huddleId: row.id };
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function startHuddle(huddleId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(huddleId);
    const supabase = supabaseServer();
    const { error: rpcErr } = await supabase.rpc("start_huddle", { p_huddle: huddleId });
    if (rpcErr) return err(rpcErr.message);
    revalidate(huddleId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function endHuddle(huddleId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(huddleId);
    const supabase = supabaseServer();
    const { error: rpcErr } = await supabase.rpc("end_huddle", { p_huddle: huddleId });
    if (rpcErr) return err(rpcErr.message);
    revalidate(huddleId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function saveHuddleNotes(huddleId: string, field: "wins" | "notes" | "attendees", value: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(huddleId);
    if (value.length > 10000) return err("Too long");
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("huddles").update({ [field]: value }).eq("id", huddleId);
    if (dbErr) return err(dbErr.message);
    revalidate(huddleId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function setAgendaDisposition(itemId: string, disposition: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(itemId);
    if (disposition.length > 1000) return err("Too long");
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("huddle_agenda_items")
      .update({ disposition: disposition || null })
      .eq("id", itemId);
    if (dbErr) return err(dbErr.message);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function addCommitment(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "commitment");
    const data = parseForm(commitmentCreateSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("huddle_commitments").insert({
      organization_id: ctx.organization.id,
      site_id: ctx.site.id,
      huddle_id: data.huddleId,
      commitment: data.commitment,
      owner_id: data.ownerId,
      due_date: data.dueDate,
    });
    if (dbErr) return err(dbErr.message);
    revalidate(data.huddleId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Resolve a prior commitment: done, cancelled (with note), or carried over
// into the current huddle via the carry_commitment RPC (§2.8, §2.9).
export async function resolveCommitment(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    const data = parseForm(commitmentResolveSchema, formData);
    const supabase = supabaseServer();

    if (data.action === "carry") {
      if (!data.newHuddleId || !data.newDueDate) return err("Carrying needs the current huddle and a new due date.");
      const { error: rpcErr } = await supabase.rpc("carry_commitment", {
        p_commitment: data.commitmentId,
        p_new_huddle: data.newHuddleId,
        p_due: data.newDueDate,
      });
      if (rpcErr) return err(rpcErr.message);
    } else if (data.action === "done") {
      const { error: dbErr } = await supabase
        .from("huddle_commitments")
        .update({ status: "done", completed_at: new Date().toISOString(), completion_note: data.note ?? null })
        .eq("id", data.commitmentId);
      if (dbErr) return err(dbErr.message);
    } else {
      if (!data.note) return err("A reason is required to cancel a commitment.");
      const { error: dbErr } = await supabase
        .from("huddle_commitments")
        .update({ status: "cancelled", completion_note: data.note })
        .eq("id", data.commitmentId);
      if (dbErr) return err(dbErr.message);
    }
    revalidate(data.newHuddleId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
