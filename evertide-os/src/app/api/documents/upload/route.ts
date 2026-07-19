import { NextRequest, NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { dbMsg } from "@/app/actions/helpers";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv", "text/markdown",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);

// Upload a new immutable version of a document (§6.10). Never overwrites:
// each upload gets a fresh storage key. Size/type validated server-side; the
// version row is registered through the add_document_version RPC under the
// caller's own session so RLS authorizes it.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAppContext();
    if (!ctx.canWrite) return NextResponse.json({ error: "Write access required" }, { status: 403 });
    checkRateLimit(ctx.userId, "doc-upload", 20);

    const form = await request.formData();
    const file = form.get("file");
    const documentId = form.get("documentId");
    const changeSummary = form.get("changeSummary");
    if (!(file instanceof File) || typeof documentId !== "string") {
      return NextResponse.json({ error: "file and documentId are required" }, { status: 400 });
    }

    const maxBytes = (ctx.site.max_upload_mb || 25) * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json({ error: `File exceeds the ${ctx.site.max_upload_mb} MB limit` }, { status: 413 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: `File type ${file.type || "unknown"} is not allowed` }, { status: 415 });
    }

    // RLS check: can this user see (and therefore version) the document?
    const supabase = supabaseServer();
    const { data: doc } = await supabase
      .from("documents").select("id, site_id, organization_id").eq("id", documentId).maybeSingle();
    if (!doc) return NextResponse.json({ error: "Document not found or not accessible" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const storagePath = `${doc.organization_id}/${doc.site_id ?? "org"}/${doc.id}/${crypto.randomUUID()}-${safeName}`;

    const admin = supabaseAdmin();
    const { error: upErr } = await admin.storage
      .from("evertide-documents")
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: versionId, error: rpcErr } = await supabase.rpc("add_document_version", {
      p_document: doc.id,
      p_storage_path: storagePath,
      p_original_filename: file.name.slice(0, 255),
      p_mime_type: file.type,
      p_size_bytes: file.size,
      p_checksum: checksum,
      p_change_summary: typeof changeSummary === "string" ? changeSummary.slice(0, 1000) : null,
    });
    if (rpcErr) {
      // Roll the orphaned object back so storage stays consistent.
      await admin.storage.from("evertide-documents").remove([storagePath]);
      return NextResponse.json({ error: dbMsg(rpcErr) }, { status: 400 });
    }

    return NextResponse.json({ ok: true, versionId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
