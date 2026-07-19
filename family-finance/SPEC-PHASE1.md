# FamilyOS — Phase 1 Build Specification ("The Cockpit")

**Status:** Draft 1 · governs the Phase 1 build
**Companion:** `BLUEPRINT.pdf` v3.0 (approved) — the vision document. This spec is
deliberately free of philosophy; where a "why" is needed, it cites a Blueprint
section. If this spec and the Blueprint conflict on *what to build*, the Blueprint
wins; on *how to build it*, this spec wins.

**Phase 1 scope (Blueprint §16):** two-user auth · manual accounts + CSV import ·
Goals with plan-vs-actual · net worth · family profiles · Rulebook & Constitution
pages · Decision Engine (manual lenses, no AI) · Library · weekly digest email.
**Not in Phase 1:** Plaid, push notifications, AI features, transfers, the Vault,
the Strength Score, real-estate desk. Standing policies for later phases (AI
boundaries, notification budget) are defined here anyway so Phase 2/3 inherit
them instead of inventing them.

---

## 1. Success metrics (KPIs)

Instrumented from day one. Reviewed at the monthly meeting; reported by the app
itself on a single "How are we doing with the app?" panel. Targets are drafts —
finalized with D1.

| # | Metric | Definition | Target |
|---|--------|-----------|--------|
| K1 | Weekly active use | Both owners complete the Sunday check-in (R10) | ≥ 45 of 52 weeks |
| K2 | Income assigned | % of each income event assigned to Goals within 48h of logging | ≥ 95% |
| K3 | Guardrail adherence | Two-key purchases (≥ R8) with a Decision Engine archive entry | 100% |
| K4 | Want-to-buy conversion | % of parked items still purchased after the 24h/7d wait | < 40% |
| K5 | Decision Engine usage | Engine runs per month (any size) | ≥ 1 |
| K6 | Retention | Consecutive monthly closes reviewed together | 12 = year-one success |
| K7 | Data freshness | Manual account values older than 90 days | 0 at each monthly close |

**Anti-metrics (things we deliberately do NOT optimize):** time-in-app, session
count, notification opens. The product is calm; engagement for its own sake is a
bug. A companion cap: average ≤ 1 proactive notification per day measured
monthly, Witness-level alerts exempt (see §3).

## 2. Users, auth, sessions

- Exactly two owner accounts (Shlomo, Rachel). Family profiles (Judah, Baby #2)
  are records, not logins, in Phase 1.
- **Auth:** email + password (argon2id) + mandatory second factor. Passkeys
  (WebAuthn) preferred; TOTP fallback. Ten single-use recovery codes generated at
  enrollment, shown once, stored by the owners outside the app (Vault when it
  exists — D14).
- **Sessions:** httpOnly secure cookies, 30-day refresh, absolute 90-day cap;
  re-auth required for: rule changes, data export, audit-log view of the other
  owner's recovery actions.
- **Audit log:** append-only table; every login, failed login, rule change,
  export, recovery action, and Decision Engine run. Readable by both owners,
  deletable by neither (no delete path in code; DB role for the app user has no
  DELETE grant on `audit_log`).

## 3. Standing policies (defined now, enforced in every phase)

### 3.1 AI boundaries (applies when AI ships in Phase 2/3)

The AI (CFO) has exactly three modes, and every AI feature must declare which
mode it operates in:

1. **Recommends** — only in: (a) scheduled jobs (daily/weekly/monthly/quarterly/
   annual/January), (b) Decision Engine lens 5, (c) a direct question from an
   owner. A recommendation always shows its reasoning and never repeats itself
   unprompted.
2. **Asks** — when data is ambiguous (e.g., categorization confidence below
   threshold). Questions are **batched into the weekly digest**, never sent
   real-time. Exception: the guardrail ladder (Blueprint §5), which is rules
   logic, not AI.
3. **Silent** — everything else. No unsolicited commentary on individual
   transactions, no engagement prompts, no feature tips after onboarding.

Hard lines: the AI never initiates or schedules money movement; never modifies a
rule (it may *draft* an amendment for the January job); never messages anyone
outside the two owners; never sends anything during quiet hours.

### 3.2 Notification policy

- **Channels:** in-app (unlimited, passive) · email digest (weekly + monthly) ·
  push/SMS (Phase 2+).
- **Budget:** ≤ 1 proactive push/day on average, measured monthly. Nudge-level
  events are in-app only. Alert-level may push. Witness-level always pushes and
  is exempt from the budget.
- **Quiet hours (D3):** a weekly recurring window (Shabbos + nightly window).
  Delivery is **queued, never dropped**; queued Witness alerts deliver first
  when the window ends. Quiet hours are enforced in the delivery layer, not in
  each feature.

## 4. Data model (PostgreSQL)

Naming note: user-facing "Goal" is `mission` internally (Blueprint §3, pillar 2).

```sql
users(id, email, name, pw_hash, totp_secret, created_at, ...)
webauthn_credentials(id, user_id, ...)
recovery_codes(id, user_id, code_hash, used_at)
sessions(id, user_id, expires_at, ...)

people(id, name, kind, born_on, notes_json)          -- family profiles
accounts(id, name, type, owner_person_id,            -- type: checking|savings|credit|loan|
         is_manual, valuation, valued_at,            --   brokerage|retirement|realestate|business|cash
         liquidity_flag, created_at)
account_snapshots(id, account_id, value, as_of)      -- monthly history for net-worth trend

income_events(id, source_id, amount, received_on, logged_by, assigned_at)
income_sources(id, name, kind, waterfall_profile_id) -- kind: salary|distribution|rent|irregular
transactions(id, account_id, amount, occurred_on, merchant, memo,
             bucket, mission_id, import_batch_id, dedupe_hash, status)
import_batches(id, account_id, filename, row_count, imported_by, created_at)

missions(id, name, person_id, target_amount, target_date,
         balance, glide_path_json, sort_order, opened_at, closed_at)
mission_deposits(id, mission_id, amount, on_date, income_event_id)
waterfall_profiles(id, name)                          -- per income source (§6.1)
waterfall_steps(id, profile_id, mission_id, rule_kind, amount_or_pct, sort_order)

rules(id, code, title, value_text, kind)              -- R1..R15
rule_changes(id, rule_id, old_value, new_value, proposed_by,
             direction, effective_at, acknowledged_by)  -- loosening: +72h delay
constitution(id, question, answer, signed_at_summit)

decisions(id, title, amount, asked_by, status, decided_at, outcome_notes)
decision_lenses(id, decision_id, lens, content_json)  -- 5 rows per decision
checkins(id, week_of, completed_by_1, completed_by_2, notes)
audit_log(id, user_id, action, entity, entity_id, detail_json, at)  -- append-only
```

## 5. Screens (Phase 1)

1. **Today** — net worth, this month's plan vs. actual by bucket, unassigned-
   income inbox count, next check-in date, weakest KPI.
2. **Goals** — the waterfall order, every Goal's funded %, glide path, and
   deposits. "Every dollar has been assigned" banner state.
3. **Accounts & Net worth** — manual accounts, CSV import, snapshot history,
   staleness flags.
4. **Decision Engine** — new run (five lenses as a guided form; lens 5 is a
   free-text "our own recommendation" box until AI ships) + the archive.
5. **Rulebook** — R1–R15 with values, change history, and the 72-hour pending-
   change banner. **Constitution** — the six answers, signatures, revision log.
6. **Family** — person cards (Rachel, Shlomo, Judah, Baby #2) with their Goals
   and timeline placeholders.
7. **Library** — reading bench with progress, notes.
8. **Settings** — auth devices, recovery codes, export, audit log.

## 6. Edge cases (explicit decisions)

### 6.1 Multiple income sources
Every income source gets its own **waterfall profile** (salary → the standard
order; rent → may route to the real-estate Goal first; distributions → may
route to tax reserve first). Deposits that match no known source land in the
**unassigned inbox** and count against K2 until routed.

### 6.2 Irregular / contractor income
Waterfall steps support **percentage rules**, not just fixed amounts. Standard
pattern for irregular income: an **Income Stabilizer** Goal is funded first
until it holds N months of baseline expenses; the household then "pays itself"
a fixed monthly amount from it, and the rest of the waterfall runs on that
fixed amount. N is a D-list decision.

### 6.3 Manual assets
Every manual valuation carries `valued_at`. Values older than 90 days are
flagged on Today and at the monthly close (K7). Illiquid assets (home,
business) carry `liquidity_flag` and are excluded from "months of runway" math.

### 6.4 Failed bank syncs (Phase 2, policy set now)
Retry with exponential backoff. A connection stale > 48h shows a banner and
sends one email — **never silent staleness**. All balances display "as of
<time>". A revoked/expired token gets a re-link card, not an error page.

### 6.5 Duplicate transactions
`dedupe_hash = f(account, amount, date ± 3 days, normalized merchant)`. CSV
imports are idempotent by batch + hash; suspected duplicates go to a review
list, never silently dropped or silently merged. Pending → posted transitions
(Phase 2) reconcile by provider ID first, hash second. A manual "merge/not a
dupe" action exists and is audited.

### 6.6 Offline behavior (PWA)
Offline = **read-only snapshot** (last-synced Today, Goals, Rulebook,
Constitution) plus a queue for two write types: check-in notes and urge-journal
entries. Queued writes sync on reconnect with last-write-wins per field.
Nothing involving money movement, rule changes, or the Decision Engine can be
done offline. The offline banner always shows the snapshot age.

## 7. Threat model & recovery

**Assets to protect:** financial account data, family PII (including children),
the decision archive, (later) Plaid tokens and Vault contents.

| Threat | Mitigations |
|---|---|
| Stolen/lost phone or laptop | Second factor required; sessions revocable from the other device; no bank credentials exist in the app at all |
| Phishing / credential stuffing | Passkeys preferred (unphishable); rate-limited logins; login alerts to both owners for new devices |
| Server / database breach | Encryption at rest; no bank passwords stored (Plaid tokens only, Phase 2, revocable); Vault files client-side encrypted (Phase 5) so a server breach never exposes them; secrets in env, never in repo |
| Backup theft | Backups encrypted with a separate key; quarterly restore drill is a calendar event owned by Shlomo |
| Account-recovery abuse (the real attack) | Recovery = recovery code, or spouse-assisted reset with **72-hour delay + email/SMS to both owners**; no support-agent backdoor exists |
| Insider risk | There are no insiders: personal hosting account, no employee access, no third-party admin |
| Coercion / domestic edge | Either owner's kill switch revokes tokens & freezes transfers instantly and cannot be disabled by the other; audit log is mutually visible and immutable |
| Death / incapacity | Break-glass procedure (Vault, Phase 5): sealed instructions; access logged and alerts the other owner. Until the Vault ships, a printed envelope covers this — tracked as a D14 task, not software |

**Recovery procedures (written, tested, boring):**
1. **Lost password** — email reset + second factor still required.
2. **Lost second factor** — recovery code; else spouse-assisted reset with the
   72-hour delay above.
3. **Both factors lost by both owners** — restore from backup into a fresh
   deployment with new credentials; documented step-by-step runbook in the repo.
4. **Suspected compromise** — kill switch → rotate secrets → revoke all
   sessions → review audit log → re-link. One page, in order, in the repo.
5. **Backup restore drill** — quarterly, into a scratch database, verified by
   a checksum report the app can print.

## 8. Engineering constraints

- Node.js 22 + Express, server-rendered EJS/HTML + light vanilla JS; PWA
  manifest + service worker (offline per §6.6). No SPA framework.
- PostgreSQL 16; migrations checked into the repo; `audit_log` role-protected
  (§2). Nightly `pg_dump` encrypted to off-site storage.
- Hosting: Render, personal account, separate from Armada. Env-only secrets.
- Money is stored as integer cents. Dates are dates, not timestamps, for
  financial events. Timezone: America/New_York fixed.
- Currency: USD only. No i18n. Two users. Boring on purpose.
- Tests: the waterfall allocator, dedupe hash, and rule-change delay logic get
  unit tests before UI polish. The allocator is a pure function.

## 9. Definition of done — Phase 1

Matches Blueprint §16 plus the approval revisions:

1. Both owners signed in with passkeys; audit log capturing §2's event list.
2. All accounts entered; one CSV month imported; net worth correct vs. a
   hand-check.
3. The waterfall configured; one real income event routed to 100% assigned
   (K2 measurable).
4. Rulebook R1–R15 populated with final D1 values; one tightening and one
   (72h-delayed) loosening exercised end-to-end.
5. Constitution signed in-app (D10).
6. One real decision through the Engine with all five lenses and an archived
   outcome (K3/K5 measurable).
7. One full monthly money meeting run entirely from the Today + Goals screens.
8. KPI panel live with K1–K7.
9. Recovery runbook §7 items 1–4 written; restore drill #1 completed.

## 10. Open build questions (need answers during Phase 1, not before)

- Income Stabilizer target N (months) for irregular income — §6.2.
- CSV formats of the actual banks in D2 (affects import mapping only).
- Email provider for digests (Resend vs. existing nodemailer/SMTP).
- Passkey library choice (SimpleWebAuthn is the default candidate).
- Domain + name confirmation (D9) — needed before PWA install metadata is final.
