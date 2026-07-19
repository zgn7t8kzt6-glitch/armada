"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandWordmark } from "@/components/brand";
import { supabaseBrowser } from "@/lib/supabase/client";

// Password sign-in. Email magic links were abandoned deliberately: the hosted
// email service rate-limits to a couple of messages an hour, which locked the
// team out. Admins set and reset passwords from Admin > Members.
function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const router = useRouter();

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setBusy(false);
      setError(
        err.message === "Invalid login credentials"
          ? "Wrong email or password. An admin can reset your password from Admin > Members."
          : err.message
      );
      return;
    }
    router.replace(params.get("next") ?? "/");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-700 px-4">
      {/* tide swell backdrop */}
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 h-64 w-full text-teal-200/20"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          fill="currentColor"
          d="M0,192 C240,128 480,96 720,128 C960,160 1200,256 1440,224 L1440,320 L0,320 Z"
        />
        <path
          fill="currentColor"
          opacity="0.6"
          d="M0,256 C280,200 520,180 760,208 C1000,236 1240,288 1440,272 L1440,320 L0,320 Z"
        />
      </svg>
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandWordmark
            className="flex-col !gap-4"
            markClass="mx-auto h-20 w-auto"
            textClass="mx-auto h-9 w-auto"
            variant="cream"
          />
          <p className="mt-4 text-sm text-teal-200/80">The operating system for EverTide Infusion</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl">
          <form onSubmit={signIn}>
            <label htmlFor="email" className="label">Work email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              placeholder="you@evertideinfusion.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="password" className="label mt-3">Password</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary mt-4 w-full">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="mt-3 text-center text-2xs text-slate-400">
              Access is limited to the EverTide team. Forgot your password? Any org admin can reset it.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
