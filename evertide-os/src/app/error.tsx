"use client";

import { AlertIcon } from "@/components/icons";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertIcon className="mx-auto h-8 w-8 text-red-600" />
        <h1 className="mt-2 text-base font-bold text-red-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-red-800">{error.message || "An unexpected error occurred."}</p>
        <button type="button" onClick={reset} className="btn-danger mt-4">
          Try again
        </button>
      </div>
    </main>
  );
}
