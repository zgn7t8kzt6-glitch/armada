import { z } from "zod";

// Server-side environment validation. Fails fast with a readable message
// instead of mysterious runtime errors. Never import this in client code.
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv(): z.infer<typeof serverSchema> {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration. Check: ${missing} (see .env.example)`);
  }
  cached = parsed.data;
  return cached;
}

// True only in local/test contexts; the test-auth route depends on this and
// hard-refuses production regardless of the env var (spec §14).
export function testAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" &&
    (process.env.ALLOW_TEST_AUTH === "1" || process.env.NODE_ENV === "test");
}
