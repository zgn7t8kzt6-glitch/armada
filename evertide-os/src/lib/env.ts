import { z } from "zod";

// Server-side environment validation. Fails fast with a readable message
// instead of mysterious runtime errors. Never import this in client code.
// Values arrive from dashboard copy-paste; strip stray whitespace, wrapping
// quotes, and trailing slashes before validating.
const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
const urlVar = z.string().transform(clean).pipe(z.string().url());
const keyVar = (min: number) => z.string().transform(clean).pipe(z.string().min(min));

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlVar,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: keyVar(20),
  SUPABASE_SERVICE_ROLE_KEY: keyVar(20).optional(),
  CRON_SECRET: keyVar(16).optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000").transform(clean).pipe(z.string().url()),
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
