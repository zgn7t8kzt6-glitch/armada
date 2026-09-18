# EverTide OS — Testing

## Commands

```bash
npm run lint          # ESLint (next/core-web-vitals)
npm run typecheck     # tsc --noEmit, strict mode
npm test              # Vitest: unit suite (+ RLS suite, which self-skips
                      # unless a live database is configured)
npm run test:rls      # Vitest RLS/database suite against a real Supabase
npm run test:e2e      # Playwright end-to-end (desktop + mobile projects)
npm run db:verify     # seed verification — exits 1 on any mismatch
npm run build         # production build; must be zero TS/lint errors
```

## Unit tests — `tests/unit/` (no external services)

35 tests across 6 files, all pure logic shared with the app:

| File | Covers |
|---|---|
| `dates.test.ts` | Site-timezone "today", Monday week starts (incl. Sunday-night NY vs UTC boundary), prior week/month report ranges, countdown math |
| `kpi.test.ts` | RAG computation for all three directions, band + target-only fallback, MISSING semantics (never fake zeros; missing rolls up as red) |
| `tasks.test.ts` | Overdue (tz-aware, done/archived excluded), stale = 7+ days without a *meaningful* update, days-past-due, blocked/critical detection |
| `risk.test.ts` | Score matrix (probability 1–3 × impact 1–4) mirroring the DB function, high/severe threshold = 6 |
| `opening.test.ts` | Every opening-risk cause: blocked/overdue critical tasks, at-risk/missed milestones, go/no-go forecast, manual declaration, multi-cause ordering |
| `csv.test.ts` | RFC 4180 escaping for exports |

## Database / RLS tests — `tests/rls/rls.test.ts`

14 integration tests that create their own throwaway users (admin, member,
viewer, outsider) and prove, against the real database:

- Outsiders see zero organizations/sites/tasks (membership isolation)
- Members can update status/percent but owner/due-date/archive changes raise
  `Only admins…` (trigger) — and admins succeed, with old+new values audited
- Viewers' writes affect zero rows
- `audit_events` rejects UPDATE/DELETE **even for the service role**
- Blocked requires a nonblank reason; resolved issues require a summary;
  closing a risk requires a disposition
- High-priority issues auto-flag for the huddle; risk scores are computed by
  trigger; risk→issue conversion links both records
- `carry_commitment` increments `carry_count`, preserves lineage, marks the
  original `carried_over`
- Approved decisions are immutable, sanctioned fields still editable,
  `admin_correct_decision` works and audits
- Restricted documents hidden from members until granted
- Finalized reports reject all further updates

Run them with a migrated + seeded project:

```bash
RLS_TESTS=1 \
NEXT_PUBLIC_SUPABASE_URL=... \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run test:rls
```

Without those variables the whole suite reports as skipped — `npm test`
stays green in environments without a database.

## End-to-end tests — `tests/e2e/` (Playwright)

Covers the 12 required flows across two projects (Desktop Chrome + iPhone 13):

1. Login page + seeded-user authentication reaching Jacksonville Site 1 (`auth.spec.ts`)
2. Member updates task status and comments (`tasks.spec.ts`)
3. Blocked transition rejected without a reason, succeeds with one (`tasks.spec.ts`)
4. Admin changes owner/due date; audit history shows it (`tasks.spec.ts`)
5. KPI owner enters weekly value; MISSING disappears (`scoreboard-huddle.spec.ts`)
6. Start huddle → agenda → carry a commitment → new commitment → end huddle (`scoreboard-huddle.spec.ts`)
7. High-priority issue appears in the huddle agenda (`scoreboard-huddle.spec.ts`)
8. Create risk; convert occurred risk to linked issue (`risks-decisions.spec.ts`)
9. Approve decision; protected fields become immutable (`risks-decisions.spec.ts`)
10. Upload document, upload new version, signed download round-trip (`documents-reports.spec.ts`)
11. Generate and finalize weekly report (`documents-reports.spec.ts`)
12. 375px mobile navigation + core actions, no horizontal scroll (`mobile.spec.ts`)

Prerequisites: a migrated **and seeded** Supabase project in `.env.local`.
The Playwright config starts `npm run dev` itself with `ALLOW_TEST_AUTH=1`,
which enables `/api/test-auth` — a password-less sign-in that generates and
immediately verifies a magic link server-side. It is refused outright in
production builds (`testAuthEnabled()` requires non-production NODE_ENV).

```bash
npx playwright install chromium   # once
npm run test:e2e
```

## Current coverage summary

- Unit: **35/35 passing** in this repository (no services needed).
- RLS: 14 tests, environment-gated; verified skip-clean without a database.
- E2E: 12 flows scripted; require a live Supabase + seed to execute.
- Build: `next build` passes with zero TypeScript or ESLint errors.
- Seed: `npm run db:verify` checks all §12 counts and relationships
  (60 tasks with exact owners/dates/criticality, 12 milestones, 11 KPIs
  across 4 categories, 12 folders, projects per phase/workstream combo,
  annual goal, RACI rows, active memberships).
