import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import type { MembershipRole, Organization, Profile, Site } from "@/lib/types";

export interface AppContext {
  userId: string;
  profile: Profile;
  organization: Organization;
  site: Site;
  sites: Site[];
  role: MembershipRole;
  isAdmin: boolean;
  canWrite: boolean;
}

const SITE_COOKIE = "et_site";

// Resolves the signed-in user, their organization, the active site (cookie-
// selected, defaulting to the first accessible site), and their effective
// role. Cached per request. Redirects to /login or /no-access as needed.
export const getAppContext = cache(async (): Promise<AppContext> => {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/no-access");

  const { data: orgMembership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role, organizations(*)")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!orgMembership?.organizations) redirect("/no-access");
  const organization = orgMembership.organizations as unknown as Organization;
  const orgRole = orgMembership.role as MembershipRole;

  // Sites the user can access: all org sites for org_admins, otherwise their
  // active site memberships (RLS enforces the same rule server-side).
  const { data: sites } = await supabase
    .from("sites")
    .select("*")
    .eq("organization_id", organization.id)
    .is("archived_at", null)
    .order("name");
  if (!sites || sites.length === 0) redirect("/no-access");

  const requested = cookies().get(SITE_COOKIE)?.value;
  const site = (sites as Site[]).find((s) => s.id === requested) ?? (sites as Site[])[0];

  let role: MembershipRole = orgRole;
  if (orgRole !== "org_admin") {
    const { data: sm } = await supabase
      .from("site_memberships")
      .select("role_override")
      .eq("site_id", site.id)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    role = (sm?.role_override as MembershipRole | null) ?? orgRole;
  }

  const isAdmin = role === "org_admin" || role === "site_admin";
  return {
    userId: user.id,
    profile: profile as Profile,
    organization,
    site,
    sites: sites as Site[],
    role,
    isAdmin,
    canWrite: isAdmin || role === "member",
  };
});

export function requireAdmin(ctx: AppContext): void {
  if (!ctx.isAdmin) throw new Error("Admin access required");
}

export function requireWrite(ctx: AppContext): void {
  if (!ctx.canWrite) throw new Error("Write access required");
}
