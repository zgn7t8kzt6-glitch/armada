import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader } from "@/components/ui";
import { InviteUserForm, MembershipRow, SetPasswordButton } from "@/components/admin/admin-forms";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Members" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("organization_memberships")
    .select("role, active, user_id, profile:profiles!organization_memberships_user_id_fkey(id,name,email,title,avatar_color)")
    .eq("organization_id", ctx.organization.id)
    .order("created_at");

  return (
    <div className="space-y-4">
      <PageHeader title="Admin — Members" subtitle="Membership and roles. Roles gate what RLS lets each person do." />

      <Card title="Add a user">
        <p className="mb-3 text-xs text-slate-500">
          Creates the account instantly with the password you choose — nothing is emailed. Share the password with them directly; they can change it from their account menu.
        </p>
        <InviteUserForm />
      </Card>

      <Card title={`Organization members (${(data ?? []).length})`}>
        <ul className="divide-y divide-slate-100">
          {(data ?? []).map((m) => {
            const profile = m.profile as unknown as Profile;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1 basis-52">
                  <OwnerChip profile={profile} size="md" />
                  <p className="ml-9 text-2xs text-slate-400">{profile.email}{profile.title ? ` · ${profile.title}` : ""}</p>
                </div>
                <SetPasswordButton profile={profile} />
                <MembershipRow profile={profile} role={m.role} active={m.active} isSelf={m.user_id === ctx.userId} />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
