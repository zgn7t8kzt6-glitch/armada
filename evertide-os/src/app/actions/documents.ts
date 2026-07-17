"use server";

// Document metadata mutations (§6.10, §7.10). File upload/download flow
// through dedicated route handlers (multipart + signed URLs); these actions
// cover metadata, grants, and links.
import { revalidatePath } from "next/cache";
import { getAppContext, requireAdmin, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { documentCreateSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";

function revalidate(id?: string) {
  revalidatePath("/documents");
  if (id) revalidatePath(`/documents/${id}`);
}

export async function createDocument(formData: FormData): Promise<ActionResult & { documentId?: string }> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "document");
    const data = parseForm(documentCreateSchema, formData);

    const supabase = supabaseServer();
    const { data: row, error: dbErr } = await supabase
      .from("documents")
      .insert({
        organization_id: ctx.organization.id,
        site_id: data.siteId ?? null,
        folder_id: data.folderId,
        title: data.title,
        description: data.description ?? null,
        owner_id: data.ownerId,
        document_type: data.documentType ?? null,
        confidentiality: data.confidentiality,
        review_date: data.reviewDate ?? null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select("id")
      .single();
    if (dbErr || !row) return err(dbErr?.message ?? "Failed to create document");
    revalidate(row.id);
    return { ok: true, documentId: row.id };
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function updateDocumentMeta(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    const documentId = formData.get("documentId");
    if (typeof documentId !== "string") return err("documentId required");
    uuid.parse(documentId);

    const patch: Record<string, unknown> = { updated_by: ctx.userId };
    for (const [formKey, col] of [
      ["title", "title"], ["description", "description"], ["documentType", "document_type"],
      ["reviewDate", "review_date"], ["status", "status"], ["confidentiality", "confidentiality"],
      ["folderId", "folder_id"], ["ownerId", "owner_id"],
    ] as const) {
      const v = formData.get(formKey);
      if (typeof v === "string" && v !== "") patch[col] = v;
    }

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("documents").update(patch).eq("id", documentId);
    if (dbErr) return err(dbErr.message);
    revalidate(documentId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Restricted-document access grants — admin only (§7.10).
export async function toggleDocumentGrant(documentId: string, userId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    uuid.parse(documentId);
    uuid.parse(userId);

    const supabase = supabaseServer();
    const { data: existing } = await supabase
      .from("document_access_grants").select("document_id").eq("document_id", documentId).eq("user_id", userId).maybeSingle();
    if (existing) {
      const { error: dbErr } = await supabase
        .from("document_access_grants").delete().eq("document_id", documentId).eq("user_id", userId);
      if (dbErr) return err(dbErr.message);
    } else {
      const { error: dbErr } = await supabase
        .from("document_access_grants")
        .insert({ document_id: documentId, user_id: userId, granted_by: ctx.userId });
      if (dbErr) return err(dbErr.message);
    }
    revalidate(documentId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function linkDocument(documentId: string, linkedType: string, linkedId: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    uuid.parse(documentId);
    uuid.parse(linkedId);
    if (!["goal", "project", "task", "issue", "risk", "decision", "vendor", "person", "milestone"].includes(linkedType)) {
      return err("Invalid link type");
    }
    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("document_links")
      .insert({ document_id: documentId, linked_type: linkedType, linked_id: linkedId });
    if (dbErr) return err(dbErr.message);
    revalidate(documentId);
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
