import { describe, expect, it } from "vitest";
import { HIGH_RISK_THRESHOLD, isHighRisk, riskScore } from "@/lib/logic/risk";

describe("risk score — must mirror app.risk_score in the database (§6.6)", () => {
  it("is probability (1-3) × impact (1-4)", () => {
    expect(riskScore("low", "low")).toBe(1);
    expect(riskScore("low", "severe")).toBe(4);
    expect(riskScore("medium", "medium")).toBe(4);
    expect(riskScore("medium", "severe")).toBe(8);
    expect(riskScore("high", "high")).toBe(9);
    expect(riskScore("high", "severe")).toBe(12);
  });

  it("high/severe surfacing threshold is 6", () => {
    expect(HIGH_RISK_THRESHOLD).toBe(6);
    expect(isHighRisk(riskScore("high", "medium"))).toBe(true); // 6
    expect(isHighRisk(riskScore("medium", "high"))).toBe(true); // 6
    expect(isHighRisk(riskScore("medium", "medium"))).toBe(false); // 4
    expect(isHighRisk(riskScore("low", "severe"))).toBe(false); // 4
  });
});
