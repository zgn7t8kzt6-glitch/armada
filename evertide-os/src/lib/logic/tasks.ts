// Task exception logic (spec §2.5, §6.3). Pure functions over row shapes so
// the same rules drive the dashboard, My Work, huddle agendas, and tests.
import { isPast, todayInTz } from "@/lib/logic/dates";

export const STALE_DAYS = 7;

export interface TaskLike {
  status: string;
  due_date: string | null;
  last_meaningful_update_at: string;
  archived_at?: string | null;
  critical?: boolean;
}

export function isOverdue(task: TaskLike, timezone: string, at: Date = new Date()): boolean {
  if (task.archived_at) return false;
  if (task.status === "done") return false;
  return isPast(task.due_date, timezone, at);
}

export function isBlocked(task: TaskLike): boolean {
  return !task.archived_at && task.status === "blocked";
}

// Stale = in progress with no meaningful (attributed) update for 7+ days.
// Based on last_meaningful_update_at, NOT updated_at (§ definition of done).
export function isStale(task: TaskLike, at: Date = new Date()): boolean {
  if (task.archived_at) return false;
  if (task.status !== "in_progress") return false;
  const last = new Date(task.last_meaningful_update_at).getTime();
  return at.getTime() - last >= STALE_DAYS * 24 * 60 * 60 * 1000;
}

export function isCriticalOpen(task: TaskLike): boolean {
  return !task.archived_at && Boolean(task.critical) && task.status !== "done";
}

export function daysPastDue(task: TaskLike, timezone: string, at: Date = new Date()): number {
  if (!task.due_date || !isOverdue(task, timezone, at)) return 0;
  const today = todayInTz(timezone, at);
  const [dy, dm, dd] = task.due_date.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86_400_000);
}
