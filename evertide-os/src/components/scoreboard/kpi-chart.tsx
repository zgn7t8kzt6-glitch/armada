"use client";

// Historical chart per KPI (§7.5) — recharts line with target reference.
import {
  Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export function KpiHistoryChart({
  points, target, unit,
}: { points: Array<{ period: string; value: number | null }>; target: number | null; unit: string | null }) {
  const data = points.map((p) => ({ ...p, label: p.period.slice(5) }));
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
          <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" width={48} />
          <Tooltip
            formatter={(v: unknown) => [`${v}${unit === "percent" ? "%" : unit ? ` ${unit}` : ""}`, "Value"]}
            labelFormatter={(l: unknown) => `Week of ${l}`}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
          {target !== null && <ReferenceLine y={target} stroke="#2E7D6B" strokeDasharray="4 4" />}
          <Line type="monotone" dataKey="value" stroke="#1F3864" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
