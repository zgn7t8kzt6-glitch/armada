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
