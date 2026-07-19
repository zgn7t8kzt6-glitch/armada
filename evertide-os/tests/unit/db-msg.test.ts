import { describe, expect, it } from "vitest";
import { dbMsg } from "@/app/actions/helpers";

describe("dbMsg — raw database errors become actionable messages", () => {
  it("maps the huddle date collision", () => {
    expect(
      dbMsg({ code: "23505", message: 'duplicate key value violates unique constraint "huddles_site_id_huddle_date_key"' })
    ).toMatch(/huddle already exists for that date/i);
  });

  it("maps KPI period and report period collisions", () => {
    expect(dbMsg({ code: "23505", message: '... "kpi_entries_kpi_id_period_start_key"' })).toMatch(/entry for that period/i);
    expect(dbMsg({ code: "23505", message: '... "reports_site_id_report_type_period_start_key"' })).toMatch(/report for that period/i);
  });

  it("maps link and junction duplicates", () => {
    expect(dbMsg({ code: "23505", message: '... "decision_links_decision_id_linked_type_linked_id_key"' })).toMatch(/link already exists/i);
    expect(dbMsg({ code: "23505", message: '... "task_helpers_pkey"' })).toMatch(/already a helper/i);
  });

  it("falls back to a generic duplicate message", () => {
    expect(dbMsg({ code: "23505", message: 'duplicate key value violates unique constraint "something_new_key"' })).toMatch(/already exists/i);
  });

  it("explains RLS denials in plain language", () => {
    expect(dbMsg({ code: "42501", message: 'new row violates row-level security policy for table "documents"' })).toMatch(/permission/i);
  });

  it("passes through human-written trigger messages untouched", () => {
    const msg = "Approved decisions are immutable; supersede them or use an admin correction";
    expect(dbMsg({ code: "P0001", message: msg })).toBe(msg);
  });

  it("maps FK, not-null, and check violations", () => {
    expect(dbMsg({ code: "23503", message: "..." })).toMatch(/no longer exists/i);
    expect(dbMsg({ code: "23502", message: "..." })).toMatch(/required field/i);
    expect(dbMsg({ code: "23514", message: "..." })).toMatch(/data rule/i);
  });

  it("handles null and empty errors", () => {
    expect(dbMsg(null)).toMatch(/could not be saved/i);
    expect(dbMsg({ message: null })).toMatch(/could not be saved/i);
  });
});
