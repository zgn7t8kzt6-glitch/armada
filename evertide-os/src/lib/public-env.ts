// Sanitized public Supabase config, shared by browser/server/middleware
// clients. Copy-paste artifacts (stray whitespace, wrapping quotes, trailing
// slash, and non-ASCII decorations like … or — picked up from rendered text)
// are classic silent breakers: an invalid header character makes Safari throw
// "The string did not match the expected pattern" and Node "fetch failed".
// Keys are strictly [A-Za-z0-9._-]; URLs are ASCII — enforce that here.
export function publicSupabaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[^\x21-\x7E]/g, "");
  return raw.replace(/\/+$/, "");
}

export function publicSupabaseAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "");
}
