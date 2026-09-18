"use client";

// Desktop sidebar + mobile bottom navigation (§7 navigation, §10 mobile).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandWordmark } from "@/components/brand";
import {
  AlertIcon, BoardIcon, ChartIcon, ChecklistIcon, ContactsIcon, FileTextIcon,
  FolderIcon, HomeIcon, MenuIcon, ScaleIcon, SettingsIcon, ShieldIcon,
  TableIcon, TargetIcon, UsersIcon, type IconProps,
} from "@/components/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: (p: IconProps) => JSX.Element;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/my-work", label: "My Work", icon: ChecklistIcon },
  { href: "/strategy", label: "Strategy", icon: TargetIcon },
  { href: "/projects", label: "Projects", icon: BoardIcon },
  { href: "/scoreboard", label: "Scoreboard", icon: ChartIcon },
  { href: "/huddles", label: "Huddles", icon: UsersIcon },
  { href: "/issues", label: "Issues", icon: AlertIcon },
  { href: "/risks", label: "Risks", icon: ShieldIcon },
  { href: "/decisions", label: "Decisions", icon: ScaleIcon },
  { href: "/documents", label: "Documents", icon: FolderIcon },
  { href: "/people", label: "People & Vendors", icon: ContactsIcon },
  { href: "/reports", label: "Reports", icon: FileTextIcon },
  { href: "/raci", label: "RACI Reference", icon: TableIcon },
  { href: "/admin", label: "Admin", icon: SettingsIcon, adminOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ isAdmin, siteName, daysToOpen }: { isAdmin: boolean; siteName: string; daysToOpen: number | null }) {
  const pathname = usePathname();
  return (
    <nav className="no-print hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex" aria-label="Primary">
      <div className="border-b border-slate-100 px-4 py-4">
        <BrandWordmark markClass="h-8 w-auto" textClass="h-4 w-auto" />
        <p className="mt-1.5 truncate text-2xs text-slate-500">{siteName}</p>
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
              <item.icon className="h-[18px] w-[18px] shrink-0 opacity-80" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const MOBILE_PRIMARY: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/my-work", label: "My Work", icon: ChecklistIcon },
  { href: "/huddles", label: "Huddle", icon: UsersIcon },
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
                    <item.icon className="h-[18px] w-[18px] shrink-0 opacity-80" />
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
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs font-semibold ${moreOpen ? "text-navy-700" : "text-slate-500"}`}
          aria-expanded={moreOpen}
        >
          <MenuIcon className="h-5 w-5" />
          More
        </button>
      </nav>
    </>
  );
}
