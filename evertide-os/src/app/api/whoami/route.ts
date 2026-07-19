import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAppContext } from "@/lib/context";
import { publicSupabaseUrl } from "@/lib/public-env";

export const dynamic = "force-dynamic";

// Session diagnostics: shows who the app thinks you are, what your
// memberships look like, and runs the exact document-insert the UI performs —
// as your session — reporting the precise database answer. The probe row is
// removed immediately. Requires being signed in (middleware enforces).
export async function GET() {
  const out: Record<string, unknown> = { supabase_host: (() => { try { return new URL(publicSupabaseUrl()).host; } catch { return "unparseable"; } })() };
  const supabase = supabaseServer();
  const admin = supabaseAdmin();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  out.session_user = userData?.user
    ? { id: userData.user.id, email: userData.user.email }
    : { error: userErr?.message ?? "no session" };
  const uid = userData?.user?.id;
  if (!uid) return NextResponse.json(out, { status: 401 });

  const { data: profile } = await admin.from("profiles").select("id,name,email,title").eq("id", uid).maybeSingle();
  out.profile_for_session_user = profile ?? "MISSING — session user has no profile row";

  const { data: oms } = await admin.from("organization_memberships")
    .select("organization_id,role,active").eq("user_id", uid);
  const { data: sms } = await admin.from("site_memberships")
    .select("site_id,active").eq("user_id", uid);
  out.memberships = { organization: oms ?? [], site: sms ?? [] };

  try {
    const ctx = await getAppContext();
    out.app_context = {
      userId: ctx.userId,
      organization: { id: ctx.organization.id, name: ctx.organization.name },
      site: { id: ctx.site.id, name: ctx.site.name },
      role: ctx.role,
      canWrite: ctx.canWrite,
      isAdmin: ctx.isAdmin,
    };

    const { data: folder } = await admin.from("document_folders")
      .select("id,name").eq("organization_id", ctx.organization.id).limit(1).maybeSingle();
    if (!folder) {
      out.insert_probe = "SKIPPED — no document folder exists";
    } else {
      const { data: probe, error: probeErr } = await supabase
        .from("documents")
        .insert({
          organization_id: ctx.organization.id,
          site_id: ctx.site.id,
          folder_id: folder.id,
          title: "DIAGNOSTIC PROBE — safe to ignore",
          owner_id: uid,
          confidentiality: "internal",
          created_by: uid,
          updated_by: uid,
        })
        .select("id")
        .single();
      if (probeErr) {
        out.insert_probe = {
          result: "FAILED",
          code: probeErr.code,
          message: probeErr.message,
          details: probeErr.details,
          hint: probeErr.hint,
          attempted: { organization_id: ctx.organization.id, site_id: ctx.site.id, folder_id: folder.id, created_by: uid },
        };
      } else {
        await admin.from("documents").delete().eq("id", probe.id);
        out.insert_probe = { result: "SUCCESS — document insert works for this session", cleaned_up: true };
      }
    }
  } catch (e) {
    out.app_context = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(out);
}
