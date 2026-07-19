import { NextRequest, NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { toCsv } from "@/lib/logic/csv";

// CSV export for People & Vendors (§7.11).
export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const tab = request.nextUrl.searchParams.get("tab") === "vendors" ? "vendors" : "people";

  if (tab === "people") {
    const { data } = await supabase
      .from("people")
      .select("first_name,last_name,person_type,organization_name,title,email,phone,status,notes, owner:profiles!people_owner_id_fkey(name)")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("last_name");
    const csv = toCsv(
      ["First name", "Last name", "Type", "Organization", "Title", "Email", "Phone", "Status", "Owner", "Notes"],
      (data ?? []).map((p) => [
        p.first_name, p.last_name, p.person_type, p.organization_name, p.title, p.email, p.phone, p.status,
        (p.owner as unknown as { name: string } | null)?.name ?? "", p.notes,
      ])
    );
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="evertide-people.csv"' },
    });
  }

  const { data } = await supabase
    .from("vendors")
    .select("name,category,status,contract_start,contract_end,renewal_notice_date,notes, owner:profiles!vendors_owner_id_fkey(name)")
    .eq("organization_id", ctx.organization.id)
    .is("archived_at", null)
    .order("name");
  const csv = toCsv(
    ["Name", "Category", "Status", "Contract start", "Contract end", "Renewal notice", "Owner", "Notes"],
    (data ?? []).map((v) => [
      v.name, v.category, v.status, v.contract_start, v.contract_end, v.renewal_notice_date,
      (v.owner as unknown as { name: string } | null)?.name ?? "", v.notes,
    ])
  );
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="evertide-vendors.csv"' },
  });
}
