// Sanitized public Supabase config, shared by browser/server/middleware
// clients. Copy-paste artifacts (stray whitespace, trailing slash, wrapping
// quotes) in deployment env vars are a classic silent breaker — normalize
// them once here.
export function publicSupabaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
  return raw.replace(/\/+$/, "");
}

export function publicSupabaseAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim().replace(/^["']|["']$/g, "");
}
