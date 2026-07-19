# FamilyOS — Phase 1: The Cockpit

The private family finance operating system for Shlomo & Rachel. Built to
`../SPEC-PHASE1.md`; vision in `../BLUEPRINT.pdf` (v3.1, approved).

**Phase 1 = manual data, full discipline.** Two owners with mandatory 2FA,
manual accounts + CSV import, the income waterfall ("every dollar gets a job"),
the Decision Engine (five lenses, no AI yet), Rulebook with the 72-hour
loosening delay, Constitution with signatures, weekly/monthly check-ins,
K1–K7 KPI panel, append-only audit log, weekly digest, JSON/CSV export,
installable PWA with a read-only offline snapshot.

## Run locally

```bash
# PostgreSQL 16+, Node 22+
createuser familyos -P            # or any user; set DATABASE_URL
createdb familyos -O familyos
cd family-finance/app
npm install
DATABASE_URL=postgres://familyos:PASSWORD@127.0.0.1:5432/familyos npm start
# open http://localhost:3000 — first visit walks both owners through setup + 2FA
npm test                          # allocator / dedupe / rule-delay unit tests
```

Migrations and seed (Rulebook R1–R15, Constitution questions, Library, default
Goals + waterfall, Judah & Baby #2 profiles) run automatically on boot and are
idempotent.

## Deploy to Render (separate account from the business — spec §7)

1. Create a **personal** Render account (not Armada's).
2. New → PostgreSQL (starter). Copy its **Internal Database URL**.
3. New → Web Service → this repo, root directory `family-finance/app`.
   - Build: `npm install` · Start: `npm start`
   - Environment: `DATABASE_URL` = the internal URL · `NODE_ENV=production`
   - Optional email: `SMTP_URL=smtps://user:pass@smtp.example.com:465`,
     `SMTP_FROM="FamilyOS <familyos@yourdomain>"`
4. Open the URL → both owners run setup → scan 2FA → **print the recovery
   codes** into the D14 envelope.
5. Render Postgres includes daily backups; do the quarterly restore drill
   (runbook 5) against a scratch database.

Environment variables are the only secrets; nothing sensitive is in the repo.

## Recovery runbooks (spec §7 — written, boring, tested)

1. **Lost password** — the other owner cannot reset it for you silently; use
   the recovery-code login (enter a recovery code where the 6-digit code
   goes), then set a new password in Settings (re-auth required).
2. **Lost authenticator** — same: log in with a recovery code, then Settings →
   Regenerate recovery codes and re-enroll 2FA. Every recovery action lands in
   the audit log both owners can read.
3. **Both factors lost by both owners** — restore last backup into a fresh
   database, `DELETE FROM sessions;`, then
   `UPDATE users SET totp_enabled = FALSE;` from `psql` (server access is the
   root of trust), restart, re-enroll. This is deliberate: there is no support
   backdoor.
4. **Suspected compromise** — Render dashboard → suspend service; rotate
   `DATABASE_URL` password; `DELETE FROM sessions;`; review `audit_log`;
   restart; both owners re-login. (Phase 2 adds the one-tap kill switch that
   also revokes Plaid tokens.)
5. **Quarterly restore drill** — restore the latest backup to a scratch DB,
   run `SELECT count(*) FROM transactions;` and compare with production, drop
   the scratch DB. Put it on the calendar; it only counts if it happens.

## What's deliberately NOT here (Phase 2–5)

Plaid sync · push notifications & the guardrail alert ladder · urge journal &
want-to-buy list · AI CFO & the Engine's AI lens · app-initiated transfers ·
real-estate desk · Legacy Vault · Strength Score · Summit report pack. The
standing policies for those (AI boundaries, notification budget, quiet hours)
are already written in `../SPEC-PHASE1.md` §3.

## Definition of done — Phase 1 (spec §9)

Code-side items are implemented and e2e-verified (owners + 2FA + recovery
codes, income → 100% assigned, CSV import + duplicate review, rule tighten /
72h loosen, Constitution signatures, Decision Engine run with five lenses,
KPI panel, audit log, exports, digest). The remaining items are yours by
design: finalize D-list values, run the first real monthly meeting in the app,
and complete restore drill #1 after deploy.
