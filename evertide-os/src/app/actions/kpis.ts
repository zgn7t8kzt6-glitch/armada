"use server";

// Scoreboard mutations (§6.8, §7.5).
import { revalidatePath } from "next/cache";
import { getAppContext, requireAdmin } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { kpiDefinitionSchema, kpiEntrySchema, kpiOverrideSchema } from "@/lib/schemas";
import { computeKpiStatus } from "@/lib/logic/kpi";
import { isoAddDays } from "@/lib/logic/dates";
import { parseForm, err, OK, dbMsg, messageOf, type ActionResult } from "./helpers";
import type { Kpi } from "@/lib/types";

// Enter (or update) a KPI value for a period. Only the KPI owner or an admin
// may write — RLS enforces the same rule.
export async function saveKpiEntry(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    checkRateLimit(ctx.userId, "kpi-entry");
    const data = parseForm(kpiEntrySchema, formData);

    const supabase = supabaseServer();
    const { data: kpi } = await supabase.from("kpis").select("*").eq("id", data.kpiId).maybeSingle();
    if (!kpi) return err("KPI not found");
    const k = kpi as unknown as Kpi;
    if (k.owner_id !== ctx.userId && !ctx.isAdmin) {
      return err("Only the KPI owner or an admin can enter this value.");
    }

    const status = computeKpiStatus(data.value, k);
    const periodEnd = isoAddDays(data.periodStart, k.frequency === "weekly" ? 6 : 27);

    const { error: dbErr } = await supabase.from("kpi_entries").upsert(
      {
        kpi_id: data.kpiId,
        period_start: data.periodStart,
        period_end: periodEnd,
        value: data.value,
        status,
        narrative: data.narrative ?? null,
        entered_by: ctx.userId,
        entered_at: new Date().toISOString(),
      },
      { onConflict: "kpi_id,period_start" }
    );
    if (dbErr) return err(dbMsg(dbErr));
    revalidatePath("/scoreboard");
    revalidatePath("/");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Admin-only RAG override with a required note; audited by trigger (§6.8).
export async function overrideKpiStatus(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    const data = parseForm(kpiOverrideSchema, formData);

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("kpi_entries")
      .update({ status: data.status, status_override_note: data.note })
      .eq("id", data.entryId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidatePath("/scoreboard");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Admin KPI definition editor (§7.5).
export async function saveKpiDefinition(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    const data = parseForm(kpiDefinitionSchema, formData);

    const supabase = supabaseServer();
    const row = {
      organization_id: ctx.organization.id,
      site_id: data.siteId,
      category: data.category,
      name: data.name,
      description: data.description ?? null,
      unit: data.unit ?? null,
      frequency: data.frequency,
      owner_id: data.ownerId,
      direction: data.direction,
      target_value: data.targetValue ?? null,
      green_min: data.greenMin ?? null,
      green_max: data.greenMax ?? null,
      yellow_min: data.yellowMin ?? null,
      yellow_max: data.yellowMax ?? null,
      active: data.active,
    };
    const { error: dbErr } = data.kpiId
      ? await supabase.from("kpis").update(row).eq("id", data.kpiId)
      : await supabase.from("kpis").insert(row);
    if (dbErr) return err(dbMsg(dbErr));
    revalidatePath("/scoreboard");
    revalidatePath("/admin/kpis");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
