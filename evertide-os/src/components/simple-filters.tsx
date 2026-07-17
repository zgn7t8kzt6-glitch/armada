"use client";

// Lightweight URL-param filter bar used by Issues, Risks, Decisions, etc.
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface FilterSelect {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export function SimpleFilters({ selects, searchKey }: { selects: FilterSelect[]; searchKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
      {searchKey && (
        <input
          type="search"
          aria-label="Search"
          placeholder="Search…"
          defaultValue={params.get(searchKey) ?? ""}
          className="input !min-h-0 w-full py-1.5 text-xs sm:!w-52"
          onKeyDown={(e) => {
            if (e.key === "Enter") setParam(searchKey, (e.target as HTMLInputElement).value || null);
          }}
          onBlur={(e) => setParam(searchKey, e.target.value || null)}
        />
      )}
      {selects.map((s) => (
        <select
          key={s.key}
          aria-label={s.label}
          className="input !min-h-0 !w-auto py-1.5 text-xs"
          value={params.get(s.key) ?? ""}
          onChange={(e) => setParam(s.key, e.target.value || null)}
        >
          <option value="">{s.label}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  );
}
