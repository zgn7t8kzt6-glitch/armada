"use server";

// People & vendors mutations (§6.11, §7.11).
import { revalidatePath } from "next/cache";
import { getAppContext, requireWrite } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { personSchema, vendorSchema } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";

export async function savePerson(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "people");
    const data = parseForm(personSchema, formData);

    const row = {
      organization_id: ctx.organization.id,
      site_id: data.siteId ?? ctx.site.id,
      person_type: data.personType,
      first_name: data.firstName,
      last_name: data.lastName,
      organization_name: data.organizationName ?? null,
      title: data.title ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      owner_id: data.ownerId,
      status: data.status,
      notes: data.notes ?? null,
      updated_by: ctx.userId,
    };

    const supabase = supabaseServer();
    const { error: dbErr } = data.personId
      ? await supabase.from("people").update(row).eq("id", data.personId)
      : await supabase.from("people").insert({ ...row, created_by: ctx.userId });
    if (dbErr) return err(dbErr.message);
    revalidatePath("/people");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function saveVendor(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireWrite(ctx);
    checkRateLimit(ctx.userId, "people");
    const data = parseForm(vendorSchema, formData);

    const row = {
      organization_id: ctx.organization.id,
      site_id: data.siteId ?? ctx.site.id,
      name: data.name,
      category: data.category ?? null,
      primary_contact_person_id: data.primaryContactPersonId ?? null,
      owner_id: data.ownerId,
      status: data.status,
      contract_start: data.contractStart ?? null,
      contract_end: data.contractEnd ?? null,
      renewal_notice_date: data.renewalNoticeDate ?? null,
      notes: data.notes ?? null,
      updated_by: ctx.userId,
    };

    const supabase = supabaseServer();
    const { error: dbErr } = data.vendorId
      ? await supabase.from("vendors").update(row).eq("id", data.vendorId)
      : await supabase.from("vendors").insert({ ...row, created_by: ctx.userId });
    if (dbErr) return err(dbErr.message);
    revalidatePath("/people");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
