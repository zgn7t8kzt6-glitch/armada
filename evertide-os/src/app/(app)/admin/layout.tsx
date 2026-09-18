import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAppContext } from "@/lib/context";

const SECTIONS = [
  { href: "/admin", label: "Settings" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/kpis", label: "KPI definitions" },
  { href: "/admin/folders", label: "Folders" },
  { href: "/admin/archive", label: "Archive" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/diagnostics", label: "Diagnostics" },
];

// Admin section gate (§7.14) — UI-level; RLS enforces the same server-side.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getAppContext();
  if (!ctx.isAdmin) redirect("/");

  return (
    <div>
      <nav className="no-print mb-4 flex flex-wrap gap-1.5" aria-label="Admin sections">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="inline-flex min-h-touch items-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
