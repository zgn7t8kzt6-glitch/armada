import { describe, expect, it } from "vitest";
import { computeOpeningRisk } from "@/lib/logic/opening";

const NY = "America/New_York";
const at = new Date("2026-07-17T15:00:00Z");

const baseInput = {
  timezone: NY,
  criticalTasks: [] as Array<{ title: string; status: string; due_date: string | null; last_meaningful_update_at: string; critical?: boolean; archived_at?: string | null }>,
  milestones: [] as Array<{ title: string; status: string; target_date: string; archived_at?: string | null }>,
  manualDeclared: false,
  manualReason: null as string | null,
  at,
};

const criticalTask = (over: Record<string, unknown>) => ({
  title: "AHCA filing",
  status: "in_progress",
  due_date: "2026-08-21",
  last_meaningful_update_at: "2026-07-16T00:00:00Z",
  critical: true,
  archived_at: null,
  ...over,
});

describe("opening-risk banner logic (§7.1)", () => {
  it("no causes → not at risk", () => {
    const r = computeOpeningRisk(baseInput);
    expect(r.atRisk).toBe(false);
    expect(r.primaryCause).toBeNull();
  });

  it("blocked critical task triggers", () => {
    const r = computeOpeningRisk({ ...baseInput, criticalTasks: [criticalTask({ status: "blocked" })] });
    expect(r.atRisk).toBe(true);
    expect(r.primaryCause).toContain("Critical task blocked");
  });

  it("overdue critical task triggers", () => {
    const r = computeOpeningRisk({ ...baseInput, criticalTasks: [criticalTask({ due_date: "2026-07-10" })] });
    expect(r.atRisk).toBe(true);
    expect(r.primaryCause).toContain("Critical task overdue");
  });

  it("non-critical or done tasks never trigger", () => {
    expect(computeOpeningRisk({ ...baseInput, criticalTasks: [criticalTask({ critical: false, status: "blocked" })] }).atRisk).toBe(false);
    expect(computeOpeningRisk({ ...baseInput, criticalTasks: [criticalTask({ status: "done", due_date: "2026-01-01" })] }).atRisk).toBe(false);
  });

  it("at-risk or missed milestones trigger", () => {
    const r = computeOpeningRisk({
      ...baseInput,
      milestones: [
        { title: "Lease executed", status: "at_risk", target_date: "2026-07-28" },
        { title: "Construction start", status: "missed", target_date: "2026-09-14" },
      ],
    });
    expect(r.atRisk).toBe(true);
    expect(r.causes).toHaveLength(2);
  });

  it("go/no-go milestone past target and still pending forecasts failure", () => {
    const r = computeOpeningRisk({
      ...baseInput,
      at: new Date("2027-01-02T15:00:00Z"),
      milestones: [{ title: "Go/no-go readiness sign-off", status: "pending", target_date: "2027-01-01" }],
    });
    expect(r.atRisk).toBe(true);
    expect(r.causes[0]).toContain("Go/no-go");
  });

  it("manual admin declaration triggers with its reason", () => {
    const r = computeOpeningRisk({ ...baseInput, manualDeclared: true, manualReason: "Payer contract slipped" });
    expect(r.atRisk).toBe(true);
    expect(r.primaryCause).toContain("Payer contract slipped");
  });

  it("multiple causes are all listed, first is primary", () => {
    const r = computeOpeningRisk({
      ...baseInput,
      criticalTasks: [criticalTask({ status: "blocked" })],
      manualDeclared: true,
      manualReason: "x",
    });
    expect(r.causes.length).toBe(2);
    expect(r.primaryCause).toContain("blocked");
  });
});
