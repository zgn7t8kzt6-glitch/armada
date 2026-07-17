import type { ReactNode } from "react";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchOpeningRisk, daysToOpening } from "@/lib/data";
import { Sidebar, BottomNav } from "@/components/shell/nav";
import { TopBar } from "@/components/shell/topbar";
import { ExceptionBanner } from "@/components/ui";

// Protected application shell: sidebar (desktop), bottom nav (mobile), and
// the global opening-risk banner shown on every page when triggered (§7.1).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const risk = await fetchOpeningRisk(supabase, ctx.site);
  const days = daysToOpening(ctx.site);

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={ctx.isAdmin} siteName={ctx.site.name} daysToOpen={days} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar profile={ctx.profile} siteName={ctx.site.name} />
        <main className="flex-1 px-4 pb-24 pt-4 lg:px-6 lg:pb-8">
          {risk.atRisk && (
            <div className="mb-4">
              <ExceptionBanner
                tone="red"
                title={`OPENING DATE AT RISK — ${risk.primaryCause ?? ""}`}
                href="/risks?filter=opening"
              >
                {risk.causes.length > 1 && (
                  <ul className="list-disc pl-5 text-xs">
                    {risk.causes.slice(1, 4).map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                    {risk.causes.length > 4 && <li>…and {risk.causes.length - 4} more</li>}
                  </ul>
                )}
              </ExceptionBanner>
            </div>
          )}
          {children}
        </main>
      </div>
      <BottomNav isAdmin={ctx.isAdmin} />
    </div>
  );
}
