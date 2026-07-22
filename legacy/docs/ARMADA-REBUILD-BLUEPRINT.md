# Armada OS — Corporate Multi-Facility Rebuild Blueprint

**Version 1.0 · 2026-07-03 · Status: governing plan for the rebuild**
Produced from an eight-agent audit of the full codebase (db schema, live-data copy, all
12,664 server lines, all 8,664 frontend lines, the 51-table housing module, integrations,
governing docs, plus an adversarial completeness pass). Evidence citations live in the
audit working files; the verified numbers below come from ground-truth queries.

This document is the answer to: *"analyze the current app and data structure first, then
design a better architecture before changing code."* It is governed by the Constitution —
in particular Principle 14: **additive evolution, no big-bang rewrite**. The rebuild is
executed as staged, idempotent, boot-run migrations that leave both an empty database and
yesterday's database bootable at every step.

---

## 1. Current structure — summary

One Node/Express server (`server.js`, 12.6k lines) + one SQLite database + a plain-JS SPA.
**216 tables** total. Three parallel worlds coexist:

1. **The detox spine** — `clients` + ~150 operational tables (rounds, meds, meals, beds,
   arrivals, billing readiness, scheduling, incidents, inventory…). Built for one building
   (Armada Detox of Akron) and still behaves that way.
2. **The outpatient silo** — `outpatient_clients`, read-only Kipu analytics keyed to a
   single configurable location name; no facility column; changing the location setting
   destroys the previous roster's history (gone-sweep).
3. **The housing universe** — 51 `housing_*` tables mounted by `mountHousing()`, scoped by
   `house_id` to 10 hardcoded Akron houses. Zero references to the facility registry.
   Duplicates incidents, maintenance, inventory/ordering, staffing, surveys, recognition,
   lineup — each maintained twice.

A **BHOS foundation** was started and is well-shaped but thin: `org_facilities` (the
canonical registry, 9 rows), `org_departments`, `user_facility_access`, `role_permissions`,
`org_events`, a topbar facility chip (`FAC_SCOPE`/`facQ()`), and `facility_id` columns on
14 tables. Adoption is the gap, not the design.

## 2. Current data model — verified facts

- **14 tables have a `facility_id` column**; 12 mean `org_facilities`, **2 mean the referral-
  partner table also named `facilities`** (a live naming collision). Only 5 have declared
  FKs; **zero facility_id indexes exist**.
- **Exactly 3 endpoints** honor a `?facility=` param (ops center, admit reconcile, corp
  overview) — and none validates the caller's access to that facility (IDOR).
- **Frontend: `facQ()` is applied to 2 of 659 API calls.** Switching the facility chip
  re-scopes two screens; the other ~90 keep showing unscoped (detox) data under the new label.
- **Every ingestion path stamps detox**: Kipu roster sync, Salesforce arrivals, warehouse
  sync (stamps nothing → boot backfill re-owns to detox), manual admits. A standing
  boot-time repair re-assigns ANY NULL-facility row to detox forever.
- **Location identity is fragmented across four vocabularies**: `org_facilities.id` FKs,
  free-text `facility` columns (orders, maintenance-adjacent, corp), free-text `entity`
  legal names (HR, leases, insurance, vault), and the `FACILITY_SEED` Kipu-connection blob.
  `org_facilities.kipu_location_name` exists but **nothing reads it**.
- **~17 schedulers are org singletons** (billing sweep, digest, lineup email, weekly report,
  escalations, syncs) latched by single `app_state` keys — none iterates facilities.
- **Single-facility physical constraints**: `shifts UNIQUE(date,name)`,
  `daily_metrics PK(date)`, `meal_checks/environment_checks/ops_handoffs/lineup_log/
  shift_reports/shift_staffing/command_checklist UNIQUE(date,…)` — a second facility cannot
  record the same day even where `facility_id` exists.
- **Org-wide singletons**: one geofence (105 E Market St, Akron — hardcoded in the error
  string), one on-call phone, one kiosk code exposing the full census to any kiosk device,
  one SMTP config + hardcoded CC list, one APP_TZ (no per-facility timezone column).
- **No facility CREATE endpoint** — the registry is one-shot seeded; adding facility #10
  requires SQL surgery, which violates the Constitution's "a seventh facility goes live
  with configuration alone."
- **User lifecycle is facility-blind**: invites/signup carry no facility; nothing ever
  writes `user_facility_access` except the one-time seed; `/api/me` walls everyone else to
  detox via `LIMIT 1`.
- **Dev DB ≠ production.** The repo copy is nearly empty (the one `clients` row is the
  seeded demo "Sample Client 12A"); production on Render holds the real payload. Therefore:
  **all migrations must be idempotent boot migrations** — no offline data surgery, no
  assumptions about production contents, verification endpoints after each phase.
  Cutover snapshots must `wal_checkpoint(TRUNCATE)` first (live WAL sidecars exist).

### Live bugs found by the audit (fix in Phase 1)
| Bug | Effect |
|---|---|
| `growth_checkins` CREATE'd twice with incompatible shapes | Two endpoint families query different column sets; one family throws on any given DB |
| Kipu discharged-episode import passes 21 args to a 23-placeholder INSERT | Import silently broken (error swallowed); insurance lands in the allergies slot; no facility/kipu id stamped |
| Kipu auto-merge groups by master patient id with **no facility guard** | The moment a second location syncs, a person's second-facility episode is silently merged away |
| Mixed clock sources (APP_TZ vs UTC `toISOString` vs kiosk device) | Evening writes already stamp tomorrow's date on some records |
| Demo client "Sample Client 12A" seeded active into production census | Census +1 forever |

## 3. Problems with the detox-first architecture

1. **Detox is the default world.** `defaultFacilityId()` = detox; NULL backfill = detox;
   sync stamps = detox; `/api/me` fallback = detox; FAC_SCOPE default = detox. Every
   forgotten stamp silently grows Akron.
2. **The chip lies.** A facility-B user selects their building and still sees Akron's
   census, contracts, and crew on ~95% of screens.
3. **Parallel worlds instead of service lines.** Outpatient and housing are code forks,
   not configurations — precisely what Constitution Principle 2 forbids.
4. **A person is three unlinked rows** (clients / outpatient_clients / housing_residents);
   `clients` conflates person and episode.
5. **Corporate is served through string-matching** (`entity` names vs `entity_aliases`),
   not FKs.
6. **Operational machinery is single-tenant** (schedulers, escalation, geofence, kiosk,
   email) even where data is multi-tenant.

## 4. Target architecture

```
Armada Recovery (Corporate)
└── Facilities (org_facilities — THE canonical registry, MDM-owned)
     • identity: fkey · name · brand (Armada/Spark/Hilltop/Reverie) · region/state · timezone
     • service line (type): detox-residential | outpatient | sober-living | corporate | future
     • configuration: services[] · modules[] · beds · settings (kiosk code, geofence,
       on-call, report recipients, schedule hours)
     • integrations: per-facility connection rows (Kipu instance+location, Salesforce
       scope, warehouse) — connections BELONG to facilities, not env vars
     └── People: person (one identity) → episodes (facility + service line + dates)
     └── Operations: every operational row carries facility_id (or an explicit,
         documented corporate scope)
```

**The six load-bearing mechanisms:**

1. **Facility context is server-side.** One helper — `facCtx(req)` → `{ids, all}` —
   resolves the requested scope, **validates it against `user_facility_access`**, and every
   scoped query uses it. The frontend chip is a view of this, not the enforcement.
2. **Type → module matrix.** Each facility type enables a module set (detox-residential:
   rounds/beds/billing-readiness/…; outpatient: PHP-IOP census/group attendance;
   sober-living: the housing suite; corporate: hub/HR/finance). Stored on the facility row
   (`modules` JSON, defaulted by type, overridable). Navigation, dashboards, and
   schedulers read it.
3. **Ingestion stamps truth.** Each integration connection is bound to a facility; synced
   records inherit the connection's facility_id. Merge/dedupe jobs never cross facilities.
4. **Schedulers fan out.** Every daily job iterates active facilities with per-facility
   latches (`<job>_<fkey>_<date>`), honoring the facility's timezone and module set.
5. **Person/episode.** `clients` remains the episode table (facility-scoped); a light
   `people` identity layer links episodes across facilities/service lines (Kipu master id
   as primary match key). Housing residents and outpatient rows link to the same person.
6. **One vocabulary.** Everything resolves to `org_facilities.id`. Free-text `facility`/
   `entity` columns get sibling `facility_id` columns backfilled via `entity_aliases`
   (text preserved read-only for history). The referral-partner table gets renamed in the
   API surface (`partner_facilities` alias) to end the collision.

**Kept intentionally:** the clinical↔housing privacy wall (as a *service-line* access wall,
not a Hilltop code fork); housing's domain tables (ORH matrix, rent, recovery capital —
NARR logic is not duplication); the Exec-vs-Analytics screen split; the PHI rules.

## 5. Migration plan (all additive, idempotent, boot-run, state-latched)

**Phase 1 — Foundation integrity (now):**
registry corrections (Wheatfield = detox-residential; add Spark Greenwood + Reverie
Greenwood; Armada Clinical naming; timezone/services/modules columns) · facility CREATE
endpoint (+ UI) · fix the five live bugs above · facility_id indexes · convert the standing
detox backfill to a one-shot latch · validate `?facility=` against access (close the IDOR)
· user_facility_access management endpoint · invites carry facility.

**Phase 2 — Scope becomes real:** `facCtx(req)` helper; scope the core module reads
(census/clients, dashboard, arrivals, discharges, incidents, billing readiness, scheduling,
inventory, maintenance + add its facility_id, requests + add its facility_id); frontend:
central `api()` auto-appends the chip's scope for scoped endpoints and `facScopeChange`
reloads the active view; scope banners ("Viewing: Armada Clinical") on every board.
Acceptance: switching the chip re-scopes every number on screen (Design System's definition
of done).

**Phase 3 — Ingestion correctness + onboarding:** per-facility integration connections
(multi-Kipu-instance support — Spark's own instance; location ids read from the registry,
not env); auto-merge facility guard; Salesforce facility-value → registry mapping;
outpatient_clients gains facility_id; **facility onboarding wizard** (name/type/services →
modules default on, dropdowns/dashboards/reports work immediately). Acceptance test:
**onboard Armada Recovery of Wheatfield; the detox toolkit works there with zero code.**

**Phase 4 — Operational fan-out:** per-facility schedulers/latches, timezone-correct days
(single-clock-source fix), per-facility geofence/on-call/kiosk codes/report recipients;
UNIQUE constraints gain the facility dimension (additive shadow tables or rebuilt
constraints, one table at a time, each latched + verified).

**Phase 5 — Housing joins the platform:** `housing_houses.facility_id` → registry;
house→facility mapping screen (owner confirms which houses are Akron vs Dayton — never
guessed); requireHousing → facility access; per-facility kiosk/settings/movement reports;
Reverie/Hilltop-Dayton onboarding. Unify incidents/maintenance/inventory** only after**
the wall is re-anchored (privacy wall preserved throughout).

**Phase 6 — Person/episode + corporate lens:** people identity layer; corporate rollups
(all-facility, per-brand, per-state, per-service-line) on ownership/analytics; permission
scope column enforced (role × module × facility).

## 6. Risk register (data loss / corruption)

| Risk | Mitigation |
|---|---|
| Boot backfill re-owns other facilities' rows to detox | Phase 1 converts it to a one-shot latch; after that, unstamped rows surface on a fail-visible "unassigned" board instead |
| Kipu auto-merge collapses cross-facility episodes | Facility guard lands BEFORE any second location syncs (Phase 3 blocks on it) |
| Second Kipu/SF source stamped detox | Connection-bound stamping (Phase 3); until then, adding a second source is frozen |
| Housing house→facility mapping mis-assigned | Explicit owner-confirmed mapping UI; no name inference |
| UNIQUE(date,shift) constraint rebuilds | Per-table: create shadow, copy, verify counts, swap, latch — never in-place deletes |
| Prod snapshot loses WAL tail | Cutover runbook: `PRAGMA wal_checkpoint(TRUNCATE)` before copy |
| Dev DB assumed to be prod | Never; all verification runs as in-app endpoints against the live DB |
| Demo client in census | Phase 1 deactivates "Sample Client 12A" (state-latched, reversible) |

## 7. Owner decisions incorporated (2026-07-03)

- Estate: **11 operating facilities + corporate** — Armada Detox of Akron + Armada Recovery
  of Wheatfield (detox-residential); Armada Clinical (Akron) + Armada Dayton + Spark
  Indianapolis + Spark Greenwood (outpatient PHP/IOP/OP); Hilltop Akron + Hilltop Dayton +
  Reverie Indianapolis + Reverie Greenwood (sober living). Two states (OH, IN), four brands.
- "Akron Outpatient" is **Armada Clinical** — names come from the registry, not hardcoded labels.
- Wheatfield offers the **same services as Akron detox** (type, not clone).
- Still open (Master App Map Part D): which corp entities (CGSS/SZS/Propco) appear as
  facilities vs holdings; regional layer now or later. Default: holdings stay out of the
  operating dropdown; regions derive from `region` column until proven insufficient.
