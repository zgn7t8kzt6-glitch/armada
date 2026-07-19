"use server";

// Report generation and finalization (§7.12) — admin only.
import { revalidatePath } from "next/cache";
import { getAppContext, requireAdmin } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { buildReportSnapshot } from "@/lib/reports";
import { priorWeekRange, priorMonthRange, weeklyPeriodStart, weeklyPeriodEnd } from "@/lib/logic/dates";
import { uuid } from "@/lib/schemas";
import { err, OK, dbMsg, messageOf, type ActionResult } from "./helpers";

export async function generateReport(reportType: "weekly" | "monthly", period: "current" | "prior"): Promise<ActionResult & { reportId?: string }> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    const tz = ctx.site.timezone;

    let start: string, end: string;
    if (reportType === "weekly") {
      ({ start, end } = period === "prior" ? priorWeekRange(tz) : { start: weeklyPeriodStart(tz), end: weeklyPeriodEnd(tz) });
    } else {
      const r = priorMonthRange(tz);
      start = r.start;
      end = r.end;
    }

    const supabase = supabaseServer();
    const snapshot = await buildReportSnapshot(supabase, ctx.site, reportType, start, end);

    const { data: existing } = await supabase
      .from("reports").select("id,status").eq("site_id", ctx.site.id)
      .eq("report_type", reportType).eq("period_start", start).maybeSingle();
    if (existing?.status === "final") return err("A finalized report already exists for this period.");

    const row = {
      organization_id: ctx.organization.id,
      site_id: ctx.site.id,
      report_type: reportType,
      period_start: start,
      period_end: end,
      generated_at: new Date().toISOString(),
      generated_by: ctx.userId,
      snapshot: snapshot as unknown as Record<string, unknown>,
      status: "generated" as const,
    };

    let reportId: string;
    if (existing) {
      const { error: upErr } = await supabase.from("reports").update(row).eq("id", existing.id);
      if (upErr) return err(dbMsg(upErr));
      reportId = existing.id;
    } else {
      const { data: created, error: insErr } = await supabase.from("reports").insert(row).select("id").single();
      if (insErr || !created) return err(dbMsg(insErr));
      reportId = created.id;
    }
    revalidatePath("/reports");
    return { ok: true, reportId };
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function finalizeReport(reportId: string, narrative: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    uuid.parse(reportId);
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("reports")
      .update({ status: "final", narrative: narrative.slice(0, 10000) || null })
      .eq("id", reportId);
    if (dbErr) return err(dbMsg(dbErr));
    revalidatePath("/reports");
    revalidatePath(`/reports/${reportId}`);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
