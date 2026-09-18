"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseAnonKey, publicSupabaseUrl } from "@/lib/public-env";

// Browser client — anon key only. RLS is the enforcement layer.
export function supabaseBrowser() {
  return createBrowserClient(publicSupabaseUrl(), publicSupabaseAnonKey());
}
