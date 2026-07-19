"use client";

import { PrinterIcon } from "@/components/icons";

export function PrintButton() {
  return (
    <button type="button" className="btn-secondary no-print !min-h-9 !py-1 text-xs" onClick={() => window.print()}>
      <PrinterIcon className="h-4 w-4" /> Print
    </button>
  );
}
