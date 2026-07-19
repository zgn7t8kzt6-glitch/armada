"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHuddle } from "@/app/actions/huddles";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Profile } from "@/lib/types";

export function NewHuddleButton({ siteId, profiles, defaultDate }: { siteId: string; profiles: Profile[]; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ New huddle</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule a huddle">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("siteId", siteId);
            startTransition(async () => {
              const res = await createHuddle(fd);
              if (!res.ok) push(res.error, "error");
              else {
                setOpen(false);
                if (res.huddleId) router.push(`/huddles/${res.huddleId}`);
                router.refresh();
              }
            });
          }}
        >
          <label className="label" htmlFor="nh-date">Huddle date</label>
          <input id="nh-date" name="huddleDate" type="date" required className="input" defaultValue={defaultDate} />
          <label className="label mt-3" htmlFor="nh-fac">Facilitator</label>
          <select id="nh-fac" name="facilitatorId" className="input">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
