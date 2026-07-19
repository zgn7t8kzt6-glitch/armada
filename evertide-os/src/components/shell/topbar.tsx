"use client";

// Top bar: site name (mobile), notifications bell, user menu / sign out.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandWordmark } from "@/components/brand";
import { BellIcon } from "@/components/icons";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import type { Notification, Profile } from "@/lib/types";

export function TopBar({ profile, siteName }: { profile: Profile; siteName: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (active && data) setNotifications(data as Notification[]);
    };
    void load();
    const channel = supabase
      .channel("notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => void load())
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function markAllRead() {
    const supabase = supabaseBrowser();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    setNotifications([]);
  }

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="lg:hidden">
        <BrandWordmark className="text-navy-600" markClass="h-5 w-5 text-teal-400" textClass="text-base font-semibold" />
        <p className="text-2xs text-slate-500">{siteName}</p>
      </div>
      <div className="hidden lg:block" />
      <div ref={panelRef} className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setMenuOpen(false); }}
          className="relative inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-lg hover:bg-slate-50"
          aria-label={`Notifications (${notifications.length} unread)`}
          aria-expanded={open}
        >
          <BellIcon className="h-5 w-5 text-slate-500" />
          {notifications.length > 0 && (
            <span className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-2xs font-bold text-white">
              {notifications.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setMenuOpen((v) => !v); setOpen(false); }}
          className="inline-flex min-h-touch items-center gap-2 rounded-lg px-1.5 hover:bg-slate-50"
          aria-expanded={menuOpen}
          aria-label="Account menu"
        >
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: profile.avatar_color || "#1F3864" }}
          >
            {initials(profile.name)}
          </span>
        </button>

        {open && (
          <div className="absolute right-0 top-12 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-bold text-navy-700">Notifications</p>
              {notifications.length > 0 && (
                <button type="button" onClick={() => void markAllRead()} className="text-2xs font-semibold text-teal-600 hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {notifications.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-slate-500">You&apos;re all caught up.</li>
              )}
              {notifications.map((n) => (
                <li key={n.id} className="border-b border-slate-50 px-3 py-2.5">
                  <p className="text-xs font-semibold text-slate-800">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-2xs text-slate-500">{n.body}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {menuOpen && (
          <div className="absolute right-0 top-12 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="truncate text-xs font-bold text-slate-800">{profile.name}</p>
              <p className="truncate text-2xs text-slate-500">{profile.email}</p>
              {profile.title && <p className="truncate text-2xs text-slate-400">{profile.title}</p>}
            </div>
            <Link href="/admin" className="block px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" onClick={() => setMenuOpen(false)}>
              Settings
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50">
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
