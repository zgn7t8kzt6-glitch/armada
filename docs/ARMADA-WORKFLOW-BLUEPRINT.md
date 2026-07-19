# ARMADA — WORKFLOW BLUEPRINT (The A-to-Z Simplification Plan)

*Version 1.0 · 2026-07-19 · Owner directive: "The app was built on too many thoughts. It's too
complicated, not user-friendly, too chaotic. Audit everything, make sure it has the right
workflow, make sure everybody's in it, so the whole app from A to Z is built correctly —
the way we built Evertide: the entire plan from scratch, so it makes sense and it's clear."*

This document is that plan. It sits on top of the five governing docs (Constitution, Audit,
Master App Map, Rebuild Blueprint, Domain Architecture) — those solved the **data**
architecture; this one solves the **experience**: who sees what, and why. Method: design the
whole thing first, then build to the design. Constitution Principles 7 (work comes to
people), 8 (every screen answers three questions), and Gate 2 (≤3 interactions from the
homepage) are the law being applied.

---

## PART 1 — THE DIAGNOSIS (from the 2026-07-19 full audit)

### 1.1 The headline numbers
- **~104 navigable views** in one sidebar. An admin or Executive Director sees essentially
  all of them. This is the chaos in the owner's screenshots.
- **Only 10 of 17 job roles have a curated menu** (`ROLE_MENU`). The other 7 —
  **Executive Director, Director of Operations, Clinical Director, Therapist,
  Catering/Dietary, Housekeeping, HR** — fall through to the full grouped sidebar,
  trimmed only by per-view gates. A therapist sees ~40–55 items; housekeeping ~30–45.
  This fall-through is the single biggest source of perceived chaos and was almost
  certainly never a deliberate decision.
- The best experiences in the app today are the **walled, curated lanes**: Executive
  Assistant (7 items), Recovery Coach (12), House Manager (14). They prove the model —
  people in a lane love the app; people in the firehose drown.

### 1.2 Duplicate systems (same job, built twice+)
| Capability | Parallel implementations | Verdict |
|---|---|---|
| "Start my day" home | `dashboard` (My Shift) · `today` · `opscenter` · `command` · `mydesk` (+ housing `housing`/`staffhub`) | 2 survive: **My Shift** (frontline) + **Operations Center** (leadership). `command` folds into opscenter; `today` merges into the two; `mydesk` stays owner-personal |
| Tasks | 8 stores: `tasks`, `assigned_tasks`, `shift_tasks`, `case_tasks`, `corp_tasks`, `hr_onboard_tasks`, `followups`, housing chores | One **My Work inbox** reading all stores via adapters (Master App Map A5). No table merges |
| Daily ritual | Lineup (+raffle) · Wave 1 flash huddle · housing lineup | One **Huddle** page per world; Wave 1's 8:30 script becomes Akron's configuration of it |
| Culture programs | 90-day plan · Excellence · Playbook scorecard · Leadership · Onboarding · Handbook · Standard · Wave 1 — 7+ pages, same Schulze framework | One **Armada Way** hub with tabs; progress models unified later |
| Client profile | `journey` (360) · `records` · `editor` · `clients` grid | **Client 360** is canonical; records/editor become its tabs |
| Insight | `outcomes` · `analytics` · `scorecard` · `accountability` · `report-view` · `askai` — already one tab bar pretending to be six pages | Formally **one Insights page** with tabs |
| Incidents / inventory / surveys | detox vs housing forks ×3; voice spread over 4 capture stacks | Keep the walls (deliberate), but one *pattern* per capability going forward |

### 1.3 People reality (the "everybody's in it" gap)
- `hr_employees` holds **154 real people** across 8 entities — but only `entity + name`.
  No titles, no emails, no link to login accounts.
- Only **~38 login users** exist (1 admin, Chava, 2 demo, up to 34 seeded Akron detox staff
  on a shared temp password). **The two populations are not linked** — no `user_id` on
  `hr_employees`, no `hr_employee_id` on `users`.
- Wave 1's leader gate references **"Director of Nursing" and "House Supervisor" — roles
  that don't exist** in the canonical 17-role list, so that gate only passes for admins
  today (bug).
- Demo residue in production: Maria Reyes / David Okafor demo staff logins recreated on
  every boot.

### 1.4 Backend reality (credit where due)
Facility scoping has genuinely progressed: `facCtx` now guards ~60–90 endpoints (was 3 in
the July 3 audit). The data layer is heading the right way. **The experience layer never
got the same treatment — that is this blueprint's job.**

### 1.5 Confirmed dead code (delete on sight, zero risk)
- `/api/playbook` defined twice (second unreachable) · `/api/facilities` GET+POST duplicated
  (shadowed) · `/api/voice` second handler shadowed · `WAVE1_LEADER_ROLES` naming
  nonexistent job roles.

---

## PART 2 — THE DESIGN (role-first: nobody sees "the app," everyone sees their day)

**The rule: every person logs into ONE home that answers "what needs me right now," plus at
most 7 named destinations. Everything else is reachable through search ("Find a page…") and
drill-through links — never through sidebar browsing.**

### 2.1 The lanes (all 17 roles + 2 new)

| Role | Home | Their ≤7 destinations |
|---|---|---|
| **BHT / Tech** | My Shift | Rounds · Clients · Belongings · Requests · Meals · Team |
| **Nurse** | My Shift | Rounds · Clients · Records · Documentation · Supplies · Team |
| **Therapist** *(new lane — currently firehosed)* | My Shift | My Caseload (casemgmt) · Clients · Program & Engagement · Documentation · Team |
| **Case Manager** | My Shift | My Caseload · Discharge & Continuum · Family · Authorizations · Scheduling · Team |
| **Front Desk** | Arrivals | Intake Checklist · Admissions · Referrals · Clients · Concierge · Team |
| **Catering / Dietary** *(new lane)* | Meals | Supplies · Team |
| **Housekeeping** *(new lane)* | Bed Turnover | Maintenance · Laundry · Supplies · Team |
| **Director of Nursing** *(new role)* | Ops Center (clinical cut) | Rounds · Documentation · Med room (records) · LSW (Wave 1) · Insights · Team |
| **House Supervisor** *(new role)* | Ops Center (shift cut) | Rounds · Bed Board · Escalations (My Work) · LSW (Wave 1) · Team |
| **Clinical Director** *(new lane)* | Ops Center | Clients · Retention · Documentation · Staffing · Insights · The Armada Way |
| **Director of Operations** *(new lane)* | Ops Center | Staffing & Schedule · Supplies & Maintenance · Bed Board · Insights · The Armada Way |
| **Executive Director** *(new lane)* | Ops Center | Huddle · Wave 1 · Clients · Insights · The Armada Way · (search for the rest) |
| **Director of Revenue Cycle Mgmt** | Revenue home (authreg) | Billing Readiness · LOS · Outpatient · Records · Team |
| **Director of Billing Compliance** | Billing Readiness | Documentation · Records · Authorizations · Team |
| **HR** *(new lane)* | People OS (hcos) | Hiring · Training · Leadership Mirror · Employees · Team |
| **Executive Assistant** | Corporate Hub | *(already correct — 7 items; the model)* |
| **Housing Director / House Manager / Recovery Coach** | Housing HQ / Staff Hub | *(already correct — keep)* |
| **Owner / admin** | Ops Center (exec cut) | My Desk · Corporate Hub · Pro Formas · Insights · Wave 1 · **Everything else via search** |

Leadership keeps power without chaos: the full catalog stays reachable through the existing
"Find a page…" search and through drill-through links on every tile (Principle 9: every
number is a doorway). The sidebar stops being the map of the codebase.

### 2.2 The canonical destinations (~104 views → 25 named places)

**Six products (Constitution Art. VII) → 25 destinations:**

1. **My Shift** (dashboard; absorbs `today`'s tiles for frontline)
2. **Ops Center** (absorbs `command`; the leadership desktop)
3. **My Work** (unified task inbox over the 8 stores; absorbs `mytasks`)
4. **Huddle** (lineup + Wave 1 flash huddle merged; per-world variant)
5. **Arrivals** (arrivals + arrivalcheck + admissions + referrals + partners as tabs)
6. **Clients** (grid)
7. **Client 360** (journey; records + editor become tabs)
8. **Rounds** (rounds + roundscan)
9. **Care Ops** (meals · laundry · belongings · dignity · concierge · engagement · program as tabs — the "patient services" desk)
10. **Bed Board** (bedmap + bedboard turnover)
11. **Retention** (+ clientvoice, surveys as tabs)
12. **Documentation** (compliance)
13. **Discharge & Continuum** (dischargepage + continuum + alumni)
14. **Revenue** (authreg · billingready · los · finance · expenses as tabs)
15. **Staffing** (schedule · coverage · weekgrid · assign · staffmodel · roster as tabs)
16. **Supplies & Maintenance** (inventory + maintenance + operations, mirroring housing's `hmaint` consolidation)
17. **Team** (team · messages · recognition · mystats · mygrowth · myrole as today)
18. **Training & Library** (training + library + handbook + standard reading views)
19. **People OS** (hcos + employees + hiring + leadmirror + workplace + onboarding)
20. **The Armada Way** (plan · excellence · playbook · leadership · Wave 1 as tabs — one program hub)
21. **Insights** (outcomes · analytics · scorecard · accountability · report-view · askai · admitcheck — formalize the existing tab bar)
22. **Corporate Hub** (as-is)
23. **Ownership & Pro Formas** (ownership + proformas + outpatient)
24. **Housing suite** (as-is — already correct)
25. **Admin** (settings · facreg · users · audit · dupes · guide)

Nothing is deleted. Views become tabs of a destination or stay reachable by search — per
Constitution Principle 14 (evolve without breaking) and 15 (measure before retiring).

### 2.3 "Everybody's in it"
- Link `users ↔ hr_employees` (add `hr_employee_id` to users; match by name/entity with a
  review screen — never silent).
- Owner fills titles per entity in People OS (or imports the payroll sheet); title → job
  role mapping gives every one of the 154 people a lane on day one.
- Add **Director of Nursing** and **House Supervisor** to the canonical role list (fixes
  the Wave 1 gate bug and matches the real Akron org).
- Retire the demo logins (Maria Reyes / David Okafor) behind a state latch.
- Every new invite carries entity + job role → lands in the right lane with zero setup.

---

## PART 3 — EXECUTION PHASES

**Phase 1 — Stop the chaos (nav only; no data, no deletions; days).**
ROLE_MENU lanes for the 7 fall-through roles + leadership lanes per 2.1; leaders get the
curated sidebar with "All pages" search access; add DON/House Supervisor roles; fix the four
dead-code items; retire demo logins. *Everything still reachable; nothing moves yet.*

**Phase 2 — Merge the homes and hubs (weeks).**
`command` panels → Ops Center; `today` tiles → My Shift/Ops Center; Insights formalized as
one page; The Armada Way hub; Arrivals tabs; Revenue tabs; Staffing tabs; Supplies &
Maintenance merge; Client 360 absorbs records/editor as tabs.

**Phase 3 — My Work + people linkage (weeks).**
Unified task inbox (adapters over the 8 stores, Master App Map A5); users↔hr_employees
linkage + title fill + invite flow; Huddle merge (lineup × Wave 1).

**Phase 4 — Continue the platform rebuild.**
Hands back to the existing Rebuild Blueprint phases (facility onboarding wizard, per-facility
schedulers, person/episode) — unchanged, still governing.

**Definition of done (Gate test):** hand a phone to any employee. They log in, and within 10
seconds they can say where they are, what's happening, and what to do next — and their
sidebar fits on one screen without scrolling.

---

## PART 4 — OWNER DECISIONS
1. **Approve Phase 1 now?** It is additive and reversible (nav curation only).
2. **The names.** The directive named three people (transcribed as "hers, shulksy, stuter")
   to make sure they're in it — confirm spellings so their accounts and lanes are built
   first, alongside Chava's existing lane.
3. **Titles source.** Fill the 154 job titles by hand in People OS, or import from the
   payroll workbook?
4. **Lane depth for ED.** Full catalog via search only (recommended), or keep a longer
   grouped sidebar for owner/ED?
