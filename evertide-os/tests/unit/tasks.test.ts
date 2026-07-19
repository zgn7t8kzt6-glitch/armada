import { describe, expect, it } from "vitest";
import { daysPastDue, isBlocked, isCriticalOpen, isOverdue, isStale, STALE_DAYS } from "@/lib/logic/tasks";

const NY = "America/New_York";
const at = new Date("2026-07-17T15:00:00Z"); // Friday, 11am NY

const task = (over: Partial<Parameters<typeof isOverdue>[0]> = {}) => ({
  status: "in_progress",
  due_date: null,
  last_meaningful_update_at: "2026-07-16T00:00:00Z",
  archived_at: null,
  critical: false,
  ...over,
});

describe("overdue (§2.5)", () => {
  it("past due date and not done → overdue", () => {
    expect(isOverdue(task({ due_date: "2026-07-16" }), NY, at)).toBe(true);
    expect(isOverdue(task({ due_date: "2026-07-17" }), NY, at)).toBe(false);
    expect(isOverdue(task({ due_date: "2026-07-18" }), NY, at)).toBe(false);
  });

  it("done and archived tasks are never overdue", () => {
    expect(isOverdue(task({ due_date: "2026-07-01", status: "done" }), NY, at)).toBe(false);
    expect(isOverdue(task({ due_date: "2026-07-01", archived_at: "2026-07-02T00:00:00Z" }), NY, at)).toBe(false);
  });

  it("daysPastDue counts calendar days", () => {
    expect(daysPastDue(task({ due_date: "2026-07-14" }), NY, at)).toBe(3);
    expect(daysPastDue(task({ due_date: "2026-07-18" }), NY, at)).toBe(0);
  });
});

describe("stale (based on meaningful updates, not updated_at)", () => {
  it(`in-progress with no meaningful update for ${STALE_DAYS}+ days is stale`, () => {
    expect(isStale(task({ last_meaningful_update_at: "2026-07-10T14:00:00Z" }), at)).toBe(true);
    expect(isStale(task({ last_meaningful_update_at: "2026-07-11T00:00:00Z" }), at)).toBe(false);
  });

  it("only in-progress tasks can be stale", () => {
    expect(isStale(task({ status: "not_started", last_meaningful_update_at: "2026-01-01T00:00:00Z" }), at)).toBe(false);
    expect(isStale(task({ status: "blocked", last_meaningful_update_at: "2026-01-01T00:00:00Z" }), at)).toBe(false);
    expect(isStale(task({ status: "done", last_meaningful_update_at: "2026-01-01T00:00:00Z" }), at)).toBe(false);
  });
});

describe("blocked and critical", () => {
  it("blocked detection ignores archived", () => {
    expect(isBlocked(task({ status: "blocked" }))).toBe(true);
    expect(isBlocked(task({ status: "blocked", archived_at: "2026-07-01T00:00:00Z" }))).toBe(false);
  });

  it("critical open excludes done", () => {
    expect(isCriticalOpen(task({ critical: true }))).toBe(true);
    expect(isCriticalOpen(task({ critical: true, status: "done" }))).toBe(false);
    expect(isCriticalOpen(task({ critical: false }))).toBe(false);
  });
});
