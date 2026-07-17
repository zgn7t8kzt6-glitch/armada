"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client — anon key only. RLS is the enforcement layer.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
