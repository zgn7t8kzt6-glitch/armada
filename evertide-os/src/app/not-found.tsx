import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <p className="text-4xl font-black text-navy-200">404</p>
        <h1 className="mt-2 text-base font-bold text-navy-700">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500">The page you&apos;re looking for doesn&apos;t exist or was moved.</p>
        <Link href="/" className="btn-primary mt-4 inline-flex">Back to Home</Link>
      </div>
    </main>
  );
}
