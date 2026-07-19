"use server";

// Admin configuration actions (§7.14). All admin-gated; membership writes are
// additionally RLS-protected.
import { revalidatePath } from "next/cache";
import { getAppContext, requireAdmin } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { inviteUserSchema, membershipSchema, setPasswordSchema, uuid } from "@/lib/schemas";
import { parseForm, err, OK, messageOf, type ActionResult } from "./helpers";
import { z } from "zod";

const siteSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  targetOpeningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxUploadMb: z.coerce.number().int().min(1).max(100).optional(),
  noPhiWarning: z.string().trim().min(1).max(500).optional(),
});

export async function updateSiteSettings(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    const data = parseForm(siteSettingsSchema, formData);

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.targetOpeningDate !== undefined) patch.target_opening_date = data.targetOpeningDate;
    if (data.maxUploadMb !== undefined) patch.max_upload_mb = data.maxUploadMb;
    if (data.noPhiWarning !== undefined) patch.no_phi_warning = data.noPhiWarning;

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase.from("sites").update(patch).eq("id", ctx.site.id);
    if (dbErr) return err(dbErr.message);
    revalidatePath("/admin");
    revalidatePath("/");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function setOpeningRisk(declared: boolean, reason: string): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    const supabase = supabaseServer();
    const { error: rpcErr } = await supabase.rpc("declare_opening_risk", {
      p_site: ctx.site.id,
      p_declared: declared,
      p_reason: reason || null,
    });
    if (rpcErr) return err(rpcErr.message);
    revalidatePath("/");
    revalidatePath("/admin");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Add a real user with a password set by the admin — no email delivery
// involved (the hosted email service rate-limits magic links hard).
export async function inviteUser(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    checkRateLimit(ctx.userId, "invite", 10);
    const data = parseForm(inviteUserSchema, formData);

    const admin = supabaseAdmin();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name },
    });
    let userId = created?.user?.id;
    if (createErr) {
      // Already registered → look the user up, reset their password, add memberships.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = list?.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase())?.id;
      if (!userId) return err(createErr.message);
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
        password: data.password,
        email_confirm: true,
      });
      if (pwErr) return err(pwErr.message);
    }

    await admin.from("profiles").upsert(
      { id: userId!, name: data.name, email: data.email, title: data.title ?? null },
      { onConflict: "id" }
    );
    const { error: omErr } = await admin.from("organization_memberships").upsert(
      { organization_id: ctx.organization.id, user_id: userId!, role: data.role, active: true },
      { onConflict: "organization_id,user_id" }
    );
    if (omErr) return err(omErr.message);
    const { error: smErr } = await admin.from("site_memberships").upsert(
      { site_id: ctx.site.id, user_id: userId!, active: true },
      { onConflict: "site_id,user_id" }
    );
    if (smErr) return err(smErr.message);

    revalidatePath("/admin/members");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Org admins set/reset sign-in passwords directly — the once-and-for-all
// replacement for rate-limited magic-link emails.
export async function setUserPassword(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    if (ctx.role !== "org_admin") return err("Only organization admins can set passwords.");
    checkRateLimit(ctx.userId, "set-password", 20);
    const data = parseForm(setPasswordSchema, formData);

    const admin = supabaseAdmin();
    const { data: membership } = await admin
      .from("organization_memberships")
      .select("user_id")
      .eq("organization_id", ctx.organization.id)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!membership) return err("That user is not a member of this organization.");

    const { error: pwErr } = await admin.auth.admin.updateUserById(data.userId, {
      password: data.password,
      email_confirm: true,
    });
    if (pwErr) return err(pwErr.message);

    await admin.from("audit_events").insert({
      organization_id: ctx.organization.id,
      actor_id: ctx.userId,
      entity_type: "auth_password",
      entity_id: data.userId,
      event_type: "update",
      metadata: { via: "admin set password" },
    });
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

export async function updateMembership(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    if (ctx.role !== "org_admin") return err("Only organization admins manage membership.");
    const data = parseForm(membershipSchema, formData);
    if (data.userId === ctx.userId && (!data.active || data.role !== "org_admin")) {
      return err("You cannot demote or deactivate your own admin membership.");
    }

    const supabase = supabaseServer();
    const { error: dbErr } = await supabase
      .from("organization_memberships")
      .update({ role: data.role, active: data.active })
      .eq("organization_id", ctx.organization.id)
      .eq("user_id", data.userId);
    if (dbErr) return err(dbErr.message);
    revalidatePath("/admin/members");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}

// Every object has exactly one DRI, so a user who still owns records cannot be
// hard-deleted — their work must be reassigned first. Until then we deactivate
// the account (they can no longer sign in or appear as assignable).
const OWNER_TABLES = [
  "tasks", "projects", "milestones", "kpis", "goals", "issues", "risks",
  "decisions", "huddle_commitments", "documents", "people", "vendors",
] as const;

export type RemoveUserResult = { ok: true; message: string } | { ok: false; error: string };

export async function removeUser(formData: FormData): Promise<RemoveUserResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    if (ctx.role !== "org_admin") return { ok: false, error: "Only organization admins can remove users." };
    const userId = uuid.parse(formData.get("userId"));
    if (userId === ctx.userId) return { ok: false, error: "You cannot remove your own account." };

    const admin = supabaseAdmin();
    const counts = await Promise.all(
      OWNER_TABLES.map(async (table) => {
        const { count, error: cErr } = await admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId);
        if (cErr) throw new Error(cErr.message);
        return { table, count: count ?? 0 };
      })
    );
    const owned = counts.filter((c) => c.count > 0);

    if (owned.length > 0) {
      await admin.from("organization_memberships").update({ active: false })
        .eq("organization_id", ctx.organization.id).eq("user_id", userId);
      await admin.from("site_memberships").update({ active: false }).eq("user_id", userId);
      revalidatePath("/admin/members");
      const detail = owned.map((c) => `${c.count} ${c.table.replace(/_/g, " ")}`).join(", ");
      return {
        ok: true,
        message: `Account deactivated. They still own ${detail} — reassign that work, then remove again to delete the account fully.`,
      };
    }

    // Nothing owned: clear junction rows, memberships, then the auth account
    // (which cascades the profile).
    await admin.from("task_helpers").delete().eq("user_id", userId);
    await admin.from("huddle_attendees").delete().eq("user_id", userId);
    await admin.from("document_access_grants").delete().eq("user_id", userId);
    await admin.from("notifications").delete().eq("user_id", userId);
    await admin.from("site_memberships").delete().eq("user_id", userId);
    await admin.from("organization_memberships").delete().eq("user_id", userId);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      // Referenced by history (e.g. authored updates) — leave the account but
      // make sure it cannot sign in or act.
      await admin.from("organization_memberships").upsert(
        { organization_id: ctx.organization.id, user_id: userId, role: "viewer", active: false },
        { onConflict: "organization_id,user_id" }
      );
      revalidatePath("/admin/members");
      return {
        ok: true,
        message: "This user is referenced by historical records, so the account was deactivated instead of deleted.",
      };
    }

    revalidatePath("/admin/members");
    return { ok: true, message: "User removed." };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function saveFolder(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getAppContext();
    requireAdmin(ctx);
    const name = formData.get("name");
    const folderId = formData.get("folderId");
    const parentId = formData.get("parentFolderId");
    if (typeof name !== "string" || !name.trim()) return err("Folder name required");

    const supabase = supabaseServer();
    if (typeof folderId === "string" && folderId) {
      uuid.parse(folderId);
      const { error: dbErr } = await supabase.from("document_folders").update({ name: name.trim() }).eq("id", folderId);
      if (dbErr) return err(dbErr.message);
    } else {
      const { error: dbErr } = await supabase.from("document_folders").insert({
        organization_id: ctx.organization.id,
        name: name.trim(),
        parent_folder_id: typeof parentId === "string" && parentId ? parentId : null,
        sort_order: 99,
      });
      if (dbErr) return err(dbErr.message);
    }
    revalidatePath("/admin/folders");
    revalidatePath("/documents");
    return OK;
  } catch (e) {
    return err(messageOf(e));
  }
}
