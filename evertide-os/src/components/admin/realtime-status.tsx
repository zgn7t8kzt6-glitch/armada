"use client";

// Live Realtime connectivity probe for the diagnostics page (§15).
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function RealtimeStatus() {
  const [status, setStatus] = useState<"connecting" | "connected" | "failed">("connecting");

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel("diagnostics-probe")
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("connected");
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("failed");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-bold ring-1 ring-inset ${
        status === "connected"
          ? "bg-green-100 text-green-800 ring-green-200"
          : status === "failed"
            ? "bg-red-100 text-red-800 ring-red-200"
            : "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      ● Realtime: {status}
    </span>
  );
}
