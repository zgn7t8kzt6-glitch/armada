// Opening-date risk (spec §7.1): the global banner shows when any critical
// task is blocked/overdue, a milestone is at risk or missed, the go/no-go
// milestone is forecast to fail, or an admin declared risk manually.
import { isOverdue, type TaskLike } from "@/lib/logic/tasks";

export interface MilestoneLike {
  title: string;
  status: string;
  target_date: string;
  archived_at?: string | null;
}

export interface OpeningRiskInput {
  timezone: string;
  criticalTasks: Array<TaskLike & { title: string }>;
  milestones: MilestoneLike[];
  manualDeclared: boolean;
  manualReason: string | null;
  at?: Date;
}

export interface OpeningRisk {
  atRisk: boolean;
  causes: string[];
  primaryCause: string | null;
}

const GO_NO_GO_TITLE = "Go/no-go readiness sign-off";

export function computeOpeningRisk(input: OpeningRiskInput): OpeningRisk {
  const at = input.at ?? new Date();
  const causes: string[] = [];

  for (const t of input.criticalTasks) {
    if (t.archived_at || t.status === "done" || !t.critical) continue;
    if (t.status === "blocked") causes.push(`Critical task blocked: ${t.title}`);
    else if (isOverdue(t, input.timezone, at)) causes.push(`Critical task overdue: ${t.title}`);
  }

  for (const m of input.milestones) {
    if (m.archived_at) continue;
    if (m.status === "at_risk") causes.push(`Milestone at risk: ${m.title}`);
    if (m.status === "missed") causes.push(`Milestone missed: ${m.title}`);
  }

  // Go/no-go forecast: the gate milestone is forecast to fail when any of its
  // predecessors (all other milestones) are missed/at risk past their target,
  // or the gate itself is pending with its target date already passed.
  const gate = input.milestones.find((m) => m.title === GO_NO_GO_TITLE && !m.archived_at);
  if (gate && gate.status === "pending") {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
    if (gate.target_date < today) {
      causes.push(`Go/no-go readiness sign-off is past its target date and not met`);
    }
  }

  if (input.manualDeclared) {
    causes.push(`Declared by admin: ${input.manualReason ?? "no reason recorded"}`);
  }

  return { atRisk: causes.length > 0, causes, primaryCause: causes[0] ?? null };
}
