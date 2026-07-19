import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Site } from "@/lib/types";

// Cron route protection (§3): Vercel sends `Authorization: Bearer $CRON_SECRET`.
export function authorizeCron(request: NextRequest): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function activeSites(admin: SupabaseClient): Promise<Site[]> {
  const { data } = await admin.from("sites").select("*").is("archived_at", null);
  return (data ?? []) as Site[];
}

// Record each run in the append-only audit log so the diagnostics page can
// show last-run timestamps (§15) without a dedicated table.
export async function recordCronRun(
  admin: SupabaseClient,
  organizationId: string,
  job: string,
  details: Record<string, unknown>
): Promise<void> {
  await admin.from("audit_events").insert({
    organization_id: organizationId,
    entity_type: "cron",
    entity_id: job,
    event_type: "run",
    metadata: details,
  });
}

export interface NotificationRow {
  organization_id: string;
  site_id: string | null;
  user_id: string;
  type: string;
  title: string;
  body?: string | null;
  linked_type?: string | null;
  linked_id?: string | null;
  expires_at?: string | null;
}

// Insert notifications, skipping ones the user already has unread for the
// same (type, linked object) — keeps daily crons from stacking duplicates.
export async function notifyOnce(admin: SupabaseClient, rows: NotificationRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: existing } = await admin
    .from("notifications")
    .select("user_id,type,linked_type,linked_id")
    .in("user_id", userIds)
    .is("read_at", null);
  const seen = new Set(
    (existing ?? []).map((n) => `${n.user_id}|${n.type}|${n.linked_type ?? ""}|${n.linked_id ?? ""}`)
  );
  const fresh = rows.filter(
    (r) => !seen.has(`${r.user_id}|${r.type}|${r.linked_type ?? ""}|${r.linked_id ?? ""}`)
  );
  if (fresh.length === 0) return 0;
  await admin.from("notifications").insert(fresh);
  return fresh.length;
}
