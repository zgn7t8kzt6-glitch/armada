# EverTide OS

The operating system for **EverTide Infusion**. It runs the opening of
Jacksonville Site 1 (target: **January 4, 2027**) and the company after it:
daily execution, weekly and monthly management cadence, institutional memory,
and future multi-site expansion.

Built with Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase
(Postgres, Auth, Realtime, Storage), deployed on Vercel.

**Who this README is for:** a non-engineer setting the system up for the
first time, with each step spelled out. If you get stuck, see
[Troubleshooting](#troubleshooting).

---

## What's inside

| Module | What it does |
|---|---|
| Home | Morning Brief: countdown, opening-risk banner, "Waiting on You", scorecard summary, critical path, milestones, workload |
| My Work | Your overdue/blocked/due work, commitments, issues, risks, missing KPIs, decisions |
| Strategy | Annual/quarterly goal hierarchy linked to execution |
| Projects | Portfolio, Kanban, and Roadmap views of the 60-task opening plan |
| Scoreboard | 11 weekly KPIs with MISSING discipline, trends, phone-first entry |
| Huddles | Full-screen Tuesday Huddle Mode with frozen agendas and commitments |
| Issues | Defect log: root cause, corrective action, resolution, reopen |
| Risks | Register + heat map; occurred risks convert to linked issues |
| Decisions | Immutable decision log with supersession and outcome review |
| Documents | Versioned, access-controlled knowledge base (no PHI, ever) |
| People & Vendors | Relationship directory with renewal alerts |
| Reports | Immutable weekly/monthly snapshots, print-ready |
| RACI | Static onboarding reference |
| Admin | Settings, members, KPIs, folders, archive, audit log, diagnostics |

---

## Local setup

1. **Install prerequisites**
   - [Node.js 20+](https://nodejs.org) (22 recommended)
   - [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` or Homebrew)

2. **Install dependencies**

   ```bash
   cd evertide-os
   npm install
   ```

3. **Create your env file**

   ```bash
   cp .env.example .env.local
   ```

   Fill it in as you complete the Supabase setup below.

4. **Run the app**

   ```bash
   npm run dev        # http://localhost:3000
   ```

## Supabase project setup

1. Create a project at [supabase.com](https://supabase.com) (choose a strong
   database password and the region closest to Jacksonville, e.g. `us-east-1`).
2. In **Project Settings → API**, copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only — never share it)

### Migrations

Link the CLI to your project and push all migrations (they are ordered,
`supabase/migrations/0001…0007`):

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
```

For a fully local stack instead: `supabase start` then `supabase db reset`
(replays every migration).

### Seed

```bash
npm run db:seed      # idempotent — safe to run again anytime
npm run db:verify    # fails loudly unless all counts/relationships match
```

This creates: EverTide Infusion, Jacksonville Site 1
(7880 Gate Parkway, Suite 201 · America/New_York · opens 2027-01-04),
6 placeholder users, 10 projects, **60 tasks**, **12 milestones**,
**11 KPIs**, 12 document folders, the annual goal, and the RACI reference.

`npm run db:seed:reset` explains the development reset procedure — audit
events and update feeds are append-only *by design*, so the reset path is
`supabase db reset` + re-seed, never row deletes.

### Auth (magic links) and redirect URLs

1. **Authentication → Providers → Email**: keep Email enabled. No passwords
   are used anywhere in the app.
2. **Authentication → URL Configuration**:
   - Site URL: your production URL (e.g. `https://evertide-os.vercel.app`)
   - Redirect URLs: add `http://localhost:3000/auth/callback` and
     `https://YOUR-DOMAIN/auth/callback`
3. Emails come from Supabase's built-in sender by default; configure custom
   SMTP in **Authentication → Emails** when you're ready for production.

### Storage bucket

Migration `0006` creates the private `evertide-documents` bucket
automatically. Nothing to click. All uploads/downloads flow through the app's
server routes; browser clients have no direct storage access, and downloads
use 60-second signed URLs.

### Realtime

Migration `0006` adds the collaborative tables (tasks, task_updates, issues,
issue_updates, kpi_entries, huddles, huddle_commitments, decisions,
notifications) to the `supabase_realtime` publication. In the dashboard,
verify **Database → Replication → supabase_realtime** lists them (on new
projects this is enabled by default).

## Vercel deployment

1. Import the repository in Vercel; set **Root Directory** to `evertide-os`.
2. Add environment variables (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` (your production URL)
   - `CRON_SECRET` (long random string, e.g. `openssl rand -hex 32`)
3. Deploy. `vercel.json` registers the cron jobs automatically.

### Cron

Vercel invokes these with `Authorization: Bearer $CRON_SECRET` (schedules are
UTC; 11:00/12:00 UTC ≈ 7:00/8:00 AM Eastern during DST — adjust ±1h in
`vercel.json` if exact winter timing matters):

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/daily-reminders` | daily 11:00 | overdue tasks, due commitments, risk reviews, vendor renewals, missing KPIs |
| `/api/cron/weekly-scorecard-init` | Mon 11:00 | new scorecard week; notify KPI owners |
| `/api/cron/pre-huddle-kpi-check` | Tue 12:00 | escalate still-missing KPIs before the huddle |
| `/api/cron/post-huddle-check` | Tue 18:00 | notify admins if no huddle was recorded (never fabricates one) |
| `/api/cron/weekly-report` | Mon 02:30 | draft weekly report for prior Mon–Sun |
| `/api/cron/monthly-report` | 1st 06:00 | draft monthly report for prior month |

Admin → Diagnostics shows each job's last run.

## Replacing placeholder users

The seed creates six profiles with `@evertide.example` addresses. To switch
to real people:

1. Sign in as an org admin and go to **Admin → Members**.
2. Use **Invite a user** with each person's real email and role — they get a
   magic-link invite.
3. Set the old placeholder membership to **Inactive** (records they own stay
   intact and can be reassigned from each object's admin controls).

## First-admin bootstrap

The seed marks `shlomo@evertide.example` and `jared@evertide.example` as
`org_admin`. For the very first real sign-in:

1. Temporarily invite your real email from a seeded admin session
   (`npm run dev` locally + Admin → Members), **or**
2. Run in the Supabase SQL editor after signing up once:

   ```sql
   insert into organization_memberships (organization_id, user_id, role, active)
   select o.id, u.id, 'org_admin', true
   from organizations o, auth.users u
   where o.slug = 'evertide-infusion' and u.email = 'you@yourcompany.com';
   insert into site_memberships (site_id, user_id, active)
   select s.id, u.id, true from sites s, auth.users u
   where s.slug = 'jacksonville-1' and u.email = 'you@yourcompany.com';
   ```

## Backup / restore

- Supabase Pro takes daily automated backups (**Database → Backups**).
- Manual snapshot: `supabase db dump -f backup.sql` (schema + data).
- Storage files live in the `evertide-documents` bucket; export via the
  dashboard or the S3-compatible endpoint before major changes.
- Restore = new project → `supabase db push` (migrations) → restore dump →
  re-point env vars. Test the runbook before you need it.

## Security & the no-PHI rule

- **This system must never store patient records or PHI.** Every document
  upload surface shows the warning (editable in Admin → Settings). Train the
  team: patient data lives in the EMR, not here.
- RLS is enabled on every table; membership + role checked in the database
  on every query. Server actions re-validate with Zod and role checks.
- The service-role key is server-only (`server-only` import guard). Signed
  URLs expire in 60 seconds. Audit events are append-only and immutable.
- Security headers (CSP, nosniff, frame-deny, referrer policy) ship in
  `next.config.mjs`.

## Implementation Decisions

Recorded per the build charter (conservative choices, applied consistently):

1. **Repository layout** — EverTide OS lives in `evertide-os/` inside the
   existing Armada repository, fully self-contained, because the repo already
   hosts another production app at its root.
2. **Versions** — Next.js 14.2 + React 18 (spec: "14+"); zod 4, recharts 3,
   date-fns 4 (+date-fns-tz 3) as installed at build time.
3. **KPI RAG bands** — deterministic bands were added to the 11 seeded KPIs
   (e.g. Cash runway green ≥6 / yellow ≥4). Without bands, status is green
   at/beyond target, else red — no invented yellow zone, and completion-style
   KPIs (Roadmap/Construction/Clinical/Staffing) will read red/yellow early
   in the countdown by design: the narrative field is the place to explain
   trajectory.
4. **High/severe risk threshold** — score ≥ 6 (probability 1–3 × impact 1–4)
   drives dashboard + huddle surfacing.
5. **Storage lockdown** — client tokens get *no* storage policies at all;
   every upload/download passes through server routes that re-check
   membership and mint 60-second signed URLs. Strictly tighter than
   path-prefix policies.
6. **Rate limiting** — a conservative in-memory fixed-window limiter per
   (user, action) in each server runtime instance; the database's own
   constraints/RLS are the hard backstop. A Postgres-backed limiter can be
   swapped in at `src/lib/rate-limit.ts` if abuse ever becomes real.
7. **Dev reset** — because audit/update feeds are append-only even for the
   service role, "reset" is `supabase db reset` (migration replay) + re-seed
   rather than deletes. This is deliberate: nothing can silently erase
   history, even a script.
8. **Notification rules** — the §9 schedule is fixed in code and documented
   in Admin → Settings rather than user-editable, keeping the cadence
   non-negotiable (spec §2). Dedup prevents daily crons from stacking
   duplicates of unread notifications.
9. **Cron scheduling vs DST** — Vercel cron is UTC-only; jobs are pinned to
   the EDT mapping of 7/8 AM. The handlers themselves compute site-local
   dates, so a ±1h drift in winter affects delivery time only, never
   correctness.
10. **Recurring issues** — flagged via an explicit `related_issue_id` link
    chosen by a human (spec §7.7 rejects AI matching).
11. **Bulk changes** — bulk status change is not offered anywhere; bulk
    owner/due-date reassignment exists as an admin server action
    (`bulkReassign`) and is fully audited per row by the triggers.
12. **Huddle agenda snapshot** — generated into `huddle_agenda_items` at
    start (so it can be worked live) and frozen into `huddles.agenda_snapshot`
    JSON at end; completed huddles render only the frozen copy.
13. **Multi-site** — every query and policy is org/site-scoped; the site
    cookie + `getAppContext` picks the active site, so adding Site 2 is a
    data operation (insert site + memberships), not a code change.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Magic link lands on "link error" | Redirect URL not whitelisted (Auth → URL Configuration), or the link expired — request a new one |
| Signed in but "No workspace access" | The user has no active `organization_memberships` row — invite them from Admin → Members |
| Everything is read-only for a user | Their role is `viewer`; raise it in Admin → Members |
| "Only admins can change task owner or due date" | Working as designed (§5) — ask a site/org admin |
| Cannot end a huddle | Open prior commitments remain — mark each done, carried, or cancelled |
| Upload fails with 413/415 | File exceeds the site max (Admin → Settings) or the type isn't allowed |
| Cron routes return 401 | `CRON_SECRET` missing/mismatched between Vercel env and the project |
| Realtime not updating | Check Admin → Diagnostics probe; verify tables in the `supabase_realtime` publication |
| `npm run db:seed` fails on env | `.env.local` missing `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| RLS tests all skip | Expected without a live DB — see TESTING.md to point them at one |

## More documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — object model, permissions, workflows, diagrams
- [OPERATIONS.md](./OPERATIONS.md) — how EverTide actually runs on this daily/weekly/monthly
- [TESTING.md](./TESTING.md) — exact commands and coverage
