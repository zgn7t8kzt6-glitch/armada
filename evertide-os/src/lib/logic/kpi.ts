// KPI RAG scoring (spec §6.8). Deterministic: bands win when configured,
// otherwise the target alone decides (green at/beyond target, red otherwise —
// no invented yellow zone). A missing value is always `missing` (never a fake
// zero) and is scored red for rollups.
import type { Kpi, KpiEntryStatus } from "@/lib/types";

export type KpiBandInput = Pick<
  Kpi,
  "direction" | "target_value" | "green_min" | "green_max" | "yellow_min" | "yellow_max"
>;

export function computeKpiStatus(value: number | null | undefined, kpi: KpiBandInput): KpiEntryStatus {
  if (value === null || value === undefined || Number.isNaN(value)) return "missing";

  switch (kpi.direction) {
    case "higher_is_better": {
      const green = kpi.green_min ?? kpi.target_value;
      if (green !== null && green !== undefined && value >= green) return "green";
      if (kpi.yellow_min !== null && kpi.yellow_min !== undefined && value >= kpi.yellow_min) return "yellow";
      return "red";
    }
    case "lower_is_better": {
      const green = kpi.green_max ?? kpi.target_value;
      if (green !== null && green !== undefined && value <= green) return "green";
      if (kpi.yellow_max !== null && kpi.yellow_max !== undefined && value <= kpi.yellow_max) return "yellow";
      return "red";
    }
    case "target_range": {
      if (
        kpi.green_min !== null && kpi.green_max !== null &&
        kpi.green_min !== undefined && kpi.green_max !== undefined &&
        value >= kpi.green_min && value <= kpi.green_max
      ) {
        return "green";
      }
      if (
        kpi.yellow_min !== null && kpi.yellow_max !== null &&
        kpi.yellow_min !== undefined && kpi.yellow_max !== undefined &&
        value >= kpi.yellow_min && value <= kpi.yellow_max
      ) {
        return "yellow";
      }
      return "red";
    }
  }
}

// Rollup color for scorecard summaries: missing counts as red (§2.10).
export function statusSeverity(status: KpiEntryStatus): number {
  return status === "green" ? 0 : status === "yellow" ? 1 : 2;
}

export function trendDelta(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null) return null;
  return current - prior;
}
