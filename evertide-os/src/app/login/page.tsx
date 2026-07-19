"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TideMark } from "@/components/brand";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const linkFailed = params.get("error") === "link";

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const next = params.get("next") ?? "/";
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
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
          <TideMark className="mx-auto h-16 w-16 text-teal-200" />
          <h1 className="font-brand mt-3 text-4xl lowercase leading-none tracking-tight text-teal-100">evertide</h1>
          <p className="mt-2 text-sm text-teal-200/80">The operating system for EverTide Infusion</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl">
          {sent ? (
            <div className="text-center" role="status">
              <p className="text-3xl" aria-hidden>📬</p>
              <h2 className="mt-2 text-sm font-bold text-navy-700">Check your email</h2>
              <p className="mt-1 text-xs text-slate-500">
                We sent a magic sign-in link to <strong>{email}</strong>. It expires shortly — open it on this device.
              </p>
              <button type="button" onClick={() => setSent(false)} className="mt-4 text-xs font-semibold text-teal-600 hover:underline">
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={sendLink}>
              {linkFailed && (
                <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
                  That sign-in link didn&apos;t work. Links are single-use, expire quickly, and must be opened in the{" "}
                  <strong>same browser on the same device</strong> where you requested them. Request a fresh one below
                  and open it here.
                </p>
              )}
              <label htmlFor="email" className="label">Work email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                placeholder="you@evertide.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{error}</p>}
              <button type="submit" disabled={busy} className="btn-primary mt-4 w-full">
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
              <p className="mt-3 text-center text-2xs text-slate-400">
                No passwords. Access is limited to invited EverTide team members.
              </p>
            </form>
          )}
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
