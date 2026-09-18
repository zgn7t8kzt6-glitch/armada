import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Signed download (§6.10, §11.6): the user's own session must be able to see
// the version row (RLS covers folder access, confidentiality, and grants);
// only then does the service role mint a short-lived signed URL.
export async function GET(_request: NextRequest, { params }: { params: { versionId: string } }) {
  const supabase = supabaseServer();
  const { data: version } = await supabase
    .from("document_versions")
    .select("id, storage_path, original_filename")
    .eq("id", params.versionId)
    .maybeSingle();
  if (!version) {
    return NextResponse.json({ error: "Not found or not accessible" }, { status: 404 });
  }

  const admin = supabaseAdmin();
  const { data: signed, error } = await admin.storage
    .from("evertide-documents")
    .createSignedUrl(version.storage_path, 60, { download: version.original_filename });
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? "Could not sign URL" }, { status: 500 });
  }
  return NextResponse.redirect(signed.signedUrl);
}
