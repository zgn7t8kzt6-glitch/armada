import { describe, expect, it } from "vitest";
import { computeKpiStatus, statusSeverity, trendDelta } from "@/lib/logic/kpi";
import type { KpiBandInput } from "@/lib/logic/kpi";

const base: Omit<KpiBandInput, "direction"> = {
  target_value: null, green_min: null, green_max: null, yellow_min: null, yellow_max: null,
};

describe("computeKpiStatus (§6.8)", () => {
  it("missing values are MISSING — never a fake zero", () => {
    expect(computeKpiStatus(null, { ...base, direction: "higher_is_better", target_value: 6 })).toBe("missing");
    expect(computeKpiStatus(undefined, { ...base, direction: "lower_is_better", target_value: 0 })).toBe("missing");
    expect(computeKpiStatus(Number.NaN, { ...base, direction: "higher_is_better" })).toBe("missing");
  });

  it("higher_is_better with bands (cash runway: green ≥6, yellow ≥4)", () => {
    const kpi: KpiBandInput = { ...base, direction: "higher_is_better", target_value: 6, green_min: 6, yellow_min: 4 };
    expect(computeKpiStatus(7, kpi)).toBe("green");
    expect(computeKpiStatus(6, kpi)).toBe("green");
    expect(computeKpiStatus(5, kpi)).toBe("yellow");
    expect(computeKpiStatus(4, kpi)).toBe("yellow");
    expect(computeKpiStatus(3.9, kpi)).toBe("red");
  });

  it("lower_is_better with bands (budget variance: green ≤0, yellow ≤5)", () => {
    const kpi: KpiBandInput = { ...base, direction: "lower_is_better", target_value: 0, green_max: 0, yellow_max: 5 };
    expect(computeKpiStatus(-2, kpi)).toBe("green");
    expect(computeKpiStatus(0, kpi)).toBe("green");
    expect(computeKpiStatus(3, kpi)).toBe("yellow");
    expect(computeKpiStatus(5, kpi)).toBe("yellow");
    expect(computeKpiStatus(5.1, kpi)).toBe("red");
  });

  it("falls back to the target alone when no bands exist (no invented yellow)", () => {
    const higher: KpiBandInput = { ...base, direction: "higher_is_better", target_value: 10 };
    expect(computeKpiStatus(10, higher)).toBe("green");
    expect(computeKpiStatus(9, higher)).toBe("red");
    const lower: KpiBandInput = { ...base, direction: "lower_is_better", target_value: 2 };
    expect(computeKpiStatus(2, lower)).toBe("green");
    expect(computeKpiStatus(3, lower)).toBe("red");
  });

  it("target_range uses green and yellow windows", () => {
    const kpi: KpiBandInput = {
      direction: "target_range", target_value: null,
      green_min: 40, green_max: 60, yellow_min: 30, yellow_max: 70,
    };
    expect(computeKpiStatus(50, kpi)).toBe("green");
    expect(computeKpiStatus(35, kpi)).toBe("yellow");
    expect(computeKpiStatus(65, kpi)).toBe("yellow");
    expect(computeKpiStatus(75, kpi)).toBe("red");
    expect(computeKpiStatus(20, kpi)).toBe("red");
  });
});

describe("rollups", () => {
  it("missing scores red-severity (§2.10)", () => {
    expect(statusSeverity("missing")).toBe(statusSeverity("red"));
    expect(statusSeverity("green")).toBeLessThan(statusSeverity("yellow"));
    expect(statusSeverity("yellow")).toBeLessThan(statusSeverity("red"));
  });

  it("trend delta requires both points", () => {
    expect(trendDelta(5, 3)).toBe(2);
    expect(trendDelta(null, 3)).toBeNull();
    expect(trendDelta(5, null)).toBeNull();
  });
});
