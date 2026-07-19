// Shared helpers for the seed/verify scripts (run with tsx, outside Next.js).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Minimal .env.local / .env loader so scripts work without extra deps.
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined) continue;
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in evertide-os/.env.local (see .env.example)."
    );
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

export function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}
