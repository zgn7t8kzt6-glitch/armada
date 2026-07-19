import "server-only";
import type { z } from "zod";

export type ActionResult = { ok: true } | { ok: false; error: string };

export const OK: ActionResult = { ok: true };

export function err(message: string): ActionResult {
  return { ok: false, error: message };
}

// Parse a FormData payload against a zod schema; empty strings become
// undefined so optional fields behave naturally in HTML forms. Throws a
// readable Error on validation failure — actions catch it and return err().
export function parseForm<S extends z.ZodTypeAny>(schema: S, formData: FormData): z.infer<S> {
  const raw: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    if (key.startsWith("$")) return; // next internal fields
    raw[key] = typeof value === "string" && value === "" ? undefined : value;
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`${first.path.join(".") || "input"}: ${first.message}`);
  }
  return parsed.data;
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// Translate raw Postgres/PostgREST errors into messages a human can act on.
// Trigger-raised exceptions (P0001) are already written for humans and pass
// through unchanged.
const UNIQUE_HINTS: Array<[string, string]> = [
  ["huddles_site_id_huddle_date", "A huddle already exists for that date — open it from the Huddles page instead of creating a new one."],
  ["kpi_entries_kpi_id_period_start", "An entry for that period already exists — edit the existing one instead."],
  ["kpis_site_id_name", "A KPI with that name already exists."],
  ["reports_site_id_report_type_period_start", "A report for that period already exists."],
  ["task_dependencies_predecessor_task_id_successor_task_id", "That dependency already exists."],
  ["projects_phase_workstream", "A project for that phase and workstream already exists."],
  ["document_versions_document_id_version_number", "Two uploads collided — try the upload once more."],
  ["task_helpers_pkey", "They are already a helper on this task."],
  ["huddle_attendees_pkey", "They are already listed as an attendee."],
  ["document_access_grants_pkey", "That person already has access."],
  ["_linked_type_linked_id", "That link already exists."],
];

export function dbMsg(e: { code?: string | null; message?: string | null } | null | undefined): string {
  if (!e?.message) return "The change could not be saved. Please try again.";
  const code = e.code ?? "";
  const msg = e.message;
  if (code === "P0001") return msg; // human-written trigger message
  if (code === "23505" || msg.includes("duplicate key value")) {
    for (const [needle, friendly] of UNIQUE_HINTS) if (msg.includes(needle)) return friendly;
    return "That already exists — duplicates are not allowed here.";
  }
  if (code === "42501" || msg.includes("row-level security")) {
    return "You don't have permission for that action. If that seems wrong, ask an org admin to check your role under Admin > Members.";
  }
  if (code === "23503") return "This change references a record that no longer exists. Refresh the page and try again.";
  if (code === "23502") return "A required field is missing.";
  if (code === "23514") return "The change breaks a data rule — check required fields (for example, a blocked task needs a reason, and closing needs a resolution).";
  if (code === "22P02") return "Something in the form was malformed. Refresh the page and try again.";
  if (code === "PGRST116") return "Not found — it may have been removed, or you may not have access.";
  return msg;
}
