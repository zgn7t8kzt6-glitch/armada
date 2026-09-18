import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeOpeningRisk, type OpeningRisk } from "@/lib/logic/opening";
import { daysUntil } from "@/lib/logic/dates";
import type { Site } from "@/lib/types";

// Opening-risk state powers the global banner on every page (§7.1).
export async function fetchOpeningRisk(supabase: SupabaseClient, site: Site): Promise<OpeningRisk> {
  const [{ data: criticalTasks }, { data: milestones }] = await Promise.all([
    supabase
      .from("tasks")
      .select("title,status,due_date,last_meaningful_update_at,critical,archived_at")
      .eq("site_id", site.id)
      .eq("critical", true)
      .neq("status", "done")
      .is("archived_at", null),
    supabase
      .from("milestones")
      .select("title,status,target_date,archived_at")
      .eq("site_id", site.id)
      .is("archived_at", null),
  ]);

  return computeOpeningRisk({
    timezone: site.timezone,
    criticalTasks: (criticalTasks ?? []) as never,
    milestones: (milestones ?? []) as never,
    manualDeclared: site.opening_risk_declared,
    manualReason: site.opening_risk_reason,
  });
}

export function daysToOpening(site: Site): number | null {
  if (!site.target_opening_date) return null;
  return daysUntil(site.target_opening_date, site.timezone);
}
