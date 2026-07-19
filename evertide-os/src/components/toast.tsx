"use client";

// Minimal toast/notification system (§ Step 1). Client-side context; any
// client component can call useToast().push("Saved", "success").
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast { id: number; message: string; kind: ToastKind }

const ToastContext = createContext<{ push: (message: string, kind?: ToastKind) => void }>({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ring-1 ring-inset ${
              t.kind === "success"
                ? "bg-green-50 text-green-800 ring-green-200"
                : t.kind === "error"
                  ? "bg-red-50 text-red-800 ring-red-200"
                  : "bg-navy-50 text-navy-700 ring-navy-100"
            }`}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
