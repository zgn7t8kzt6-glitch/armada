"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn-secondary no-print !min-h-9 !py-1 text-xs" onClick={() => window.print()}>
      🖨 Print
    </button>
  );
}
