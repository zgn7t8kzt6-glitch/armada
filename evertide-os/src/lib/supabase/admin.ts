import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

// Service-role client. Bypasses RLS — use ONLY in cron routes, storage
// upload/download routes, and admin server actions that have already
// re-checked authorization. The `server-only` import guarantees this module
// can never be bundled for the browser (spec §11.2).
export function supabaseAdmin() {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
