"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-black tracking-tight text-navy-600">EverTide OS</h1>
          <p className="mt-1 text-sm text-slate-500">The operating system for EverTide Infusion</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
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
