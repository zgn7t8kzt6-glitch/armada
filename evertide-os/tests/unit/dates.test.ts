import { describe, expect, it } from "vitest";
import {
  daysBetween, daysUntil, isPast, isoAddDays, priorMonthRange, priorWeekRange,
  todayInTz, weeklyPeriodStart, weeklyPeriodEnd,
} from "@/lib/logic/dates";

const NY = "America/New_York";

describe("site timezone day boundaries (§2.14)", () => {
  it("computes today in the site timezone, not UTC", () => {
    // 2026-07-14 03:00 UTC is still 2026-07-13 23:00 in New York (EDT).
    const at = new Date("2026-07-14T03:00:00Z");
    expect(todayInTz(NY, at)).toBe("2026-07-13");
    expect(todayInTz("UTC", at)).toBe("2026-07-14");
  });

  it("isPast respects the site timezone", () => {
    const at = new Date("2026-07-14T03:00:00Z"); // still the 13th in NY
    expect(isPast("2026-07-13", NY, at)).toBe(false);
    expect(isPast("2026-07-12", NY, at)).toBe(true);
    expect(isPast(null, NY, at)).toBe(false);
  });
});

describe("weekly KPI periods begin Monday in site tz (§6.8)", () => {
  it("returns the Monday of the current week", () => {
    // 2026-07-17 is a Friday.
    const at = new Date("2026-07-17T15:00:00Z");
    expect(weeklyPeriodStart(NY, at)).toBe("2026-07-13");
    expect(weeklyPeriodEnd(NY, at)).toBe("2026-07-19");
  });

  it("a Monday maps to itself", () => {
    const at = new Date("2026-07-13T15:00:00Z");
    expect(weeklyPeriodStart(NY, at)).toBe("2026-07-13");
  });

  it("Sunday night in NY is still the prior week even when UTC is Monday", () => {
    // Monday 2026-07-20 02:00 UTC = Sunday 2026-07-19 22:00 in NY.
    const at = new Date("2026-07-20T02:00:00Z");
    expect(weeklyPeriodStart(NY, at)).toBe("2026-07-13");
    expect(weeklyPeriodStart("UTC", at)).toBe("2026-07-20");
  });
});

describe("report period helpers (§9)", () => {
  it("priorWeekRange returns the previous Monday–Sunday", () => {
    const at = new Date("2026-07-17T15:00:00Z"); // Friday
    expect(priorWeekRange(NY, at)).toEqual({ start: "2026-07-06", end: "2026-07-12" });
  });

  it("priorMonthRange returns the previous calendar month", () => {
    expect(priorMonthRange(NY, new Date("2026-07-17T15:00:00Z"))).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(priorMonthRange(NY, new Date("2026-01-15T15:00:00Z"))).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(priorMonthRange(NY, new Date("2026-03-05T15:00:00Z"))).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("date arithmetic", () => {
  it("adds and diffs ISO dates", () => {
    expect(isoAddDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(daysBetween("2026-07-17", "2027-01-04")).toBe(171);
    expect(daysBetween("2027-01-04", "2026-07-17")).toBe(-171);
  });

  it("daysUntil counts calendar days to the opening date", () => {
    const at = new Date("2026-07-17T12:00:00Z");
    expect(daysUntil("2027-01-04", NY, at)).toBe(171);
  });
});
