"use client";

// Desktop sidebar + mobile bottom navigation (§7 navigation, §10 mobile).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/my-work", label: "My Work", icon: "✅" },
  { href: "/strategy", label: "Strategy", icon: "🎯" },
  { href: "/projects", label: "Projects", icon: "📋" },
  { href: "/scoreboard", label: "Scoreboard", icon: "📊" },
  { href: "/huddles", label: "Huddles", icon: "👥" },
  { href: "/issues", label: "Issues", icon: "⚠️" },
  { href: "/risks", label: "Risks", icon: "🛡️" },
  { href: "/decisions", label: "Decisions", icon: "⚖️" },
  { href: "/documents", label: "Documents", icon: "📁" },
  { href: "/people", label: "People & Vendors", icon: "🤝" },
  { href: "/reports", label: "Reports", icon: "📄" },
  { href: "/raci", label: "RACI Reference", icon: "🗂️" },
  { href: "/admin", label: "Admin", icon: "⚙️", adminOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ isAdmin, siteName, daysToOpen }: { isAdmin: boolean; siteName: string; daysToOpen: number | null }) {
  const pathname = usePathname();
  return (
    <nav className="no-print hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex" aria-label="Primary">
      <div className="border-b border-slate-100 px-4 py-4">
        <p className="text-base font-black tracking-tight text-navy-600">EverTide OS</p>
        <p className="mt-0.5 truncate text-2xs text-slate-500">{siteName}</p>
        {daysToOpen !== null && (
          <p className={`mt-1 text-2xs font-bold ${daysToOpen < 0 ? "text-red-700" : "text-teal-600"}`}>
            {daysToOpen >= 0 ? `${daysToOpen} days to opening` : `${-daysToOpen} days past target`}
          </p>
        )}
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin).map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`mx-2 my-0.5 flex min-h-touch items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                isActive(pathname, item.href)
                  ? "bg-navy-50 text-navy-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-navy-600"
              }`}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
              <span aria-hidden className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const MOBILE_PRIMARY: NavItem[] = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/my-work", label: "My Work", icon: "✅" },
  { href: "/huddles", label: "Huddle", icon: "👥" },
];

export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = NAV_ITEMS.filter(
    (i) => !MOBILE_PRIMARY.some((p) => p.href === i.href) && (!i.adminOnly || isAdmin)
  );

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="More navigation">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-navy-900/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-16 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-white p-3 shadow-2xl">
            <ul className="grid grid-cols-2 gap-1">
              {moreItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex min-h-touch items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      isActive(pathname, item.href) ? "bg-navy-50 text-navy-700" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span aria-hidden>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white lg:hidden"
        aria-label="Mobile"
      >
        {MOBILE_PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs font-semibold ${
              isActive(pathname, item.href) ? "text-navy-700" : "text-slate-500"
            }`}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
          >
            <span aria-hidden className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs font-semibold ${moreOpen ? "text-navy-700" : "text-slate-500"}`}
          aria-expanded={moreOpen}
        >
          <span aria-hidden className="text-lg leading-none">☰</span>
          More
        </button>
      </nav>
    </>
  );
}
