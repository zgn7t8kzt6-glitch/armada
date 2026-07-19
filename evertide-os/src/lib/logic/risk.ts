// Deterministic risk scoring — must match app.risk_score in the database:
// probability (1–3) × impact (1–4), range 1–12. High/severe = score ≥ 6.
import type { RiskImpact, RiskProbability } from "@/lib/types";

const PROB: Record<RiskProbability, number> = { low: 1, medium: 2, high: 3 };
const IMPACT: Record<RiskImpact, number> = { low: 1, medium: 2, high: 3, severe: 4 };

export function riskScore(probability: RiskProbability, impact: RiskImpact): number {
  return PROB[probability] * IMPACT[impact];
}

export const HIGH_RISK_THRESHOLD = 6;

export function isHighRisk(score: number): boolean {
  return score >= HIGH_RISK_THRESHOLD;
}
