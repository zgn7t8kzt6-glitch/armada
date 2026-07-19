// Timezone-aware date logic. All "today" math happens in the site's timezone
// (spec §2.14); dates are exchanged as ISO `yyyy-MM-dd` strings.
import { formatInTimeZone } from "date-fns-tz";
import { addDays, differenceInCalendarDays, parseISO } from "date-fns";

export function todayInTz(timezone: string, at: Date = new Date()): string {
  return formatInTimeZone(at, timezone, "yyyy-MM-dd");
}

// ISO weekday 1 (Monday) start of the current week in the site timezone —
// weekly KPI periods key off this (§6.8). Matches public.weekly_period_start.
export function weeklyPeriodStart(timezone: string, at: Date = new Date()): string {
  const today = todayInTz(timezone, at);
  const dow = Number(formatInTimeZone(at, timezone, "i")); // 1=Mon .. 7=Sun
  return isoAddDays(today, -(dow - 1));
}

export function weeklyPeriodEnd(timezone: string, at: Date = new Date()): string {
  return isoAddDays(weeklyPeriodStart(timezone, at), 6);
}

export function isoAddDays(isoDate: string, days: number): string {
  const d = addDays(parseISO(isoDate), days);
  return d.toISOString().slice(0, 10);
}

// Calendar-day difference: isoB - isoA.
export function daysBetween(isoA: string, isoB: string): number {
  return differenceInCalendarDays(parseISO(isoB), parseISO(isoA));
}

// Days until a target date from "today" in the site tz. Negative = past.
export function daysUntil(targetIso: string, timezone: string, at: Date = new Date()): number {
  return daysBetween(todayInTz(timezone, at), targetIso);
}

export function isPast(dateIso: string | null, timezone: string, at: Date = new Date()): boolean {
  if (!dateIso) return false;
  return dateIso < todayInTz(timezone, at);
}

// Prior full Monday–Sunday week (for the Sunday-night weekly report, §9).
export function priorWeekRange(timezone: string, at: Date = new Date()): { start: string; end: string } {
  const thisMonday = weeklyPeriodStart(timezone, at);
  return { start: isoAddDays(thisMonday, -7), end: isoAddDays(thisMonday, -1) };
}

// Prior calendar month (for the monthly report, §9).
export function priorMonthRange(timezone: string, at: Date = new Date()): { start: string; end: string } {
  const today = todayInTz(timezone, at);
  const [y, m] = today.split("-").map(Number);
  const firstOfThis = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const start = `${String(prevY).padStart(4, "0")}-${String(prevM).padStart(2, "0")}-01`;
  return { start, end: isoAddDays(firstOfThis, -1) };
}
