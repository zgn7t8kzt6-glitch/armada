export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-3xl" aria-hidden>🔒</p>
        <h1 className="mt-2 text-lg font-bold text-navy-700">No workspace access</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your account is signed in but isn&apos;t a member of an EverTide organization yet.
          Ask an administrator to invite you from Admin → Members.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button type="submit" className="btn-secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
