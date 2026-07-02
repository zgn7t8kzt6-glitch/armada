# ARMADA DESIGN SYSTEM — "QUIET LUXURY, OPERATIONAL DEPTH"
*The complete UI/UX system for the Armada Behavioral Health Operating System. Grounded in the code that exists today (styles.css tokens, the .mhub mobile system, ret-card tiles, the sidebar shell) — this codifies what's right, corrects what isn't, and specifies everything new. Companion to ARMADA-PLATFORM-ARCHITECTURE.md.*

---

# 1 · DESIGN PHILOSOPHY

**One sentence:** the interface of a five-star hotel's back office — calm on the surface, ruthlessly operational underneath.

Six commitments, in priority order (when they conflict, the higher one wins):

1. **Trust before beauty.** Healthcare-grade: nothing ambiguous, nothing cute where a life-safety signal lives. Status colors mean one thing each, everywhere, forever.
2. **The urgent thing finds you.** No screen may hide overdue/critical work below the fold. The Operations Center is the systemwide expression of this; every page repeats it locally (critical → active → upcoming → historical, always in that order).
3. **Context is always visible.** Facility, role, and date are ambient — in the header, on every screen, without being asked.
4. **Three clicks.** Any workflow a person does daily: ≤3 interactions from their homepage. If it takes more, the homepage is wrong, not the user.
5. **Calm surfaces.** Cream ground, white cards, hairline borders, one accent. Motion ≤200ms, ease-out, and only to confirm what happened. Nothing pulses, nothing bounces, nothing gradients-for-fun. (The current login screen and card language already live here — keep.)
6. **Density with hierarchy.** Epic-level depth is welcome *inside* a card or drawer — never on first paint. First paint shows counts and states; detail is one tap deeper.

**What we are NOT:** a startup dashboard (no confetti, no mascot emptystates), a BI tool (no wall-of-charts), a consumer app (no infinite feeds). We are an operating system: queues, records, and decisions.

---

# 2 · DESIGN TOKENS

*The existing `:root` palette is correct and stays — it's sampled from the brand mark and already reads premium. Below is the full token sheet: ✓ = exists today, ★ = new/changed.*

## 2.1 Color — foundation
```css
:root{
  /* Ground & surfaces */
  --cream:#f5f3ed;        /* ✓ app ground */
  --paper:#ffffff;        /* ✓ elevated card */
  --paper-2:#faf7f1;      /* ✓ sidebar / secondary surface */
  --ink:#1b2825;          /* ✓ primary text */
  --muted:#6f7a75;        /* ✓ secondary text */
  --line:#eae5da;         /* ✓ hairline borders */
  --line-2:#f2eee5;       /* ★ sub-hairline (row dividers inside cards) */

  /* Brand */
  --navy:#235056;         /* ✓ deep brand teal — headers, numbers, active */
  --navy-2:#2d6168;       /* ✓ */
  --aqua:#5fb0c2;         /* ✓ focus rings, links-on-dark */
  --sage:#a7ba86;         /* ✓ decorative only */
  --gold:#d29a5e;         /* ✓ THE accent: active tab, primary highlights */
  --gold-soft:#ecd9b6;    /* ✓ */
}
```

## 2.2 Color — meaning (used ONLY for meaning)
```css
:root{
  /* Status (state of a thing) */
  --ok:#2f7a4f;      --ok-bg:#e7f0ea;      /* ✓ good/complete/active */
  --warn:#9a6a1f;    --warn-bg:#fdf6ec;    /* ✓ needs attention soon */
  --crit:#c06a52;    --crit-bg:#fbecea;    /* ✓ overdue/critical/failed */
  --info:#3d6f8e;    --info-bg:#eef3f7;    /* ★ neutral-informational */
  --idle:#6f7a75;    --idle-bg:#f0f1f4;    /* ✓ inactive/na/historical */

  /* Risk (clinical risk of a PERSON — deliberately same hues as status,
     different key names so code reads correctly) */
  --risk-high:var(--crit); --risk-elev:var(--warn); --risk-low:var(--ok);

  /* Priority (urgency of WORK) */
  --p-urgent:var(--crit); --p-high:var(--warn); --p-normal:var(--idle); --p-low:var(--idle);
}
```
**Hard rule:** these five hues never decorate. A green button that isn't "this is done/safe" is a bug. Brand gold ≠ warning amber — gold is identity, amber is meaning.

## 2.3 Typography
```css
:root{
  --serif:"Fraunces","Iowan Old Style",Georgia,serif;   /* ✓ display & big numbers */
  --sans:"DM Sans",-apple-system,system-ui,sans-serif;  /* ✓ everything else */

  /* ★ Type scale (rem, 1rem=16px) — replaces today's ad-hoc px sizes */
  --t-hero:2.375rem;   /* 38 — stat numbers, page hero (serif) */
  --t-h1:1.5rem;       /* 24 — page title (serif) */
  --t-h2:1.125rem;     /* 18 — card title (serif) */
  --t-body:0.875rem;   /* 14 — default */
  --t-sm:0.8125rem;    /* 13 — table body, nav */
  --t-caption:0.6875rem;/* 11 — uppercase labels, letter-spacing .8px */
}
```
Serif = identity moments only (titles, the big number on a stat card). Sans = all working text. Never serif in a table.

## 2.4 Space, radius, elevation
```css
:root{
  /* ★ 4px spacing scale — the only gaps allowed */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px;

  --r:20px;      /* ✓ cards */
  --r-sm:13px;   /* ✓ tiles, inputs */
  --r-xs:8px;    /* ★ pills, badges, small buttons */

  /* ✓ Two shadows only. Nothing else. */
  --shadow:0 1px 2px rgba(28,42,38,.04),0 4px 14px rgba(28,42,38,.05);      /* resting */
  --shadow-lg:0 8px 20px rgba(28,42,38,.07),0 24px 50px rgba(28,42,38,.10); /* hover/modal */

  --ease:cubic-bezier(.2,.7,.3,1); --dur:160ms;  /* ★ one motion curve */
}
```

## 2.5 Card, table, form styles (canonical recipes)
- **Card:** `--paper`, 1px `--line`, `--r`, `--shadow`, padding `--s5`. Title = `--t-h2` serif + optional `.hint` subtitle. Hover lift only if the whole card is clickable.
- **Table:** header row `--t-caption` uppercase `--muted`; body `--t-sm`; row divider `--line-2`; row hover `rgba(35,80,86,.03)`; no zebra, no vertical rules. ≤760px → `.m-cards` stacking (already built).
- **Form:** label `--t-caption` above field; field 40px tall, `--r-sm`, border `--line`, focus ring 2px `--aqua`; one column ≤640px. Destructive buttons get `--crit` only at the confirm step, not on first paint.

---

# 3 · LAYOUT SYSTEM

Every screen is one of **eight layout patterns**. New pages must pick one — a page that fits none is a product-design escalation, not a CSS exception.

**The frame (all patterns):** left sidebar 258px (collapsible to 64px icon-rail ★) · top context bar 56px · content column max-width 1200px, padding `--s5`. The top bar always shows: **facility chip · global search · Today inbox · alerts badge · user + role badge**.

| # | Pattern | Structure | Used by |
|---|---|---|---|
| L1 | **Command center** | Alert strip (only if alerts) → tile groups (critical first) → activity feed | Operations Center, Corporate Command Center |
| L2 | **Dashboard** | Hero stat row → 2-col card grid (work-cards left, insight-cards right) | Role homepages, Corp Hub dashboard, HCOS dashboard |
| L3 | **Work queue** | Filter/scope bar → queue rows (grouped: overdue → today → upcoming) → done (collapsed) | Orders, maintenance, concierge, reviews, leave, auth renewals |
| L4 | **Record: patient chart** | Identity header (name, program, LOS, risk badge) → tab strip (Overview · Timeline · Notes · Docs · Care) → panel | journey/Client 360, resident 360 |
| L5 | **Record: employee profile** | Identity header (name, title, facility, tenure) → tab strip (Overview · Timeline · Reviews · Certs · Docs · Comp) → panel | openHcosPerson (already close to this) |
| L6 | **Record: facility/entity** | Identity header → stat row → sectioned cards | Facility page, entity vault record, lease record |
| L7 | **Board** | Column kanban with swipe on mobile (exists: corp-kanban) | Projects, hiring pipeline |
| L8 | **Document/reader** | Left: doc list · right: viewer + AI panel | Leases, insurance policies, policy acks |

**Hierarchy rule inside every pattern:** 🔴 critical → 🟠 active → upcoming → historical, top to bottom. Historical is always behind a collapsed `<details>` ("Show completed / history").

**View scopes** (what the facility switcher means per layout): Corporate view = all facilities, rollup tiles with per-facility drill; Facility view = one facility, full depth; Department view = L3 queue pattern pre-filtered to a department (not a separate world).

---

# 4 · NAVIGATION

## 4.1 The sidebar (target map)
Grouped, not flat; groups mirror the platform layers. `▸` = exists today, `○` = planned per master map (button appears when module ships; no dead links).

```
  ARMADA  [logo]
  ─ facility chip: 🏥 Armada Detox — Akron ▾   (persistent, top of sidebar)
  ─ 🔍 Search…  ⌘K                              (global: patients, employees,
                                                 orders, docs, vendors, pages)
  HOME
  ▸ 🎛 Operations Center          ← default landing for leadership
  ▸ My Shift                      ← default landing for frontline
  ▸ Today                         (task inbox: everything assigned to ME, due-dated)

  CARE                            (Layer 4 — facility-type aware)
  ▸ Admissions & Arrivals
  ▸ Census / Clients
  ▸ Clinical (rounds, care cards, records)
  ▸ Case Management
  ○ Peer Support                  (approved, to build)
  ▸ Discharge & Continuum

  REVENUE
  ○ Authorizations / UR           (register to build; probes already work)
  ○ Billing readiness             (doc-gap exists; claims later)

  FACILITY                        (Layer 3)
  ▸ Beds & Rooms
  ▸ Staffing & Scheduling
  ▸ Inventory & Ordering
  ▸ Maintenance · Incidents · Concierge

  ENTERPRISE                      (Layer 2 — corporate roles see this)
  ▸ Corporate Hub  ▸ HR — People OS  ▸ Finance
  ○ Business Development (referral partners after rename)
  ▸ Compliance & Documents

  INSIGHT
  ▸ Reports & Analytics  ▸ Outcomes  ▸ Ask AI

  ADMIN
  ▸ Facilities registry · Users · Settings · Audit
```

**Rules:** a user sees only groups containing ≥1 permitted view (groupVisible — exists). Frontline roles keep the flat top toolbar (exists) — the grouped sidebar is for multi-domain roles. Active view: gold left-rail marker (exists). Icons: one set, line-style, muted — replace the current mixed emoji in nav labels with a consistent icon column (emoji stay in content, they're part of the house voice, but nav is chrome).

## 4.2 Header elements
- **Facility switcher** — chip + dropdown fed by org_facilities & user_facility_access. Changing it re-scopes every count on screen. Corporate users get "All facilities" (rollup). *(CORP_FAC does this inside Corp Hub today — promote the pattern to the shell.)*
- **Role badge** — small pill by the avatar: job title + "Previewing as X — exit" state (PREVIEW_ROLE exists; give it a persistent banner).
- **Alerts badge** — count of `alert:true` tiles from /api/opscenter; tap = jump to Ops Center with critical group expanded. Not a notification tray — it's a pointer to the board.
- **Today inbox** — the user's own tasks (assigned to me, due today/overdue) across modules. v1 = my corp_tasks + hr tasks + reviews; grows with the org_tasks adapter work.

---

# 5 · COMPONENT INVENTORY

*Column 3 says what to do in code. "Promote" = exists somewhere, extract into a shared recipe + class.*

| Component | Spec | Status |
|---|---|---|
| **Stat card** | serif number + caption label; optional delta ("↑2 vs last wk") and sub; clickable = hover lift + drill | ✓ `ret-card` — add delta slot |
| **Alert card** | `--crit-bg` card, icon, one-line cause, ONE action button; stacks at top of any page | ★ new (`.alert-card`) |
| **Escalation banner** | full-width strip above content; only sysemwide states (Kipu down, census email failed) | ★ new (`.banner-crit/.banner-warn`) |
| **Status badge** | pill, `--t-caption`, meaning-colored bg | ✓ `.risk/.risk-*` — rename usage to `.badge-*`, keep risk aliases |
| **Risk indicator** | dot + word on patient rows; badge on chart header | ✓ promote from retention views |
| **Priority flag** | 🔴/🟠 dot before work-queue titles (exists in orders) | ✓ promote |
| **Work queue row** | checkbox/status · title+sub · meta (facility, owner, due) · actions right; overdue rows get 3px `--crit` left rail | ★ formalize (`.q-row`) from orders/maintenance markup |
| **Patient card** | name, program, LOS, risk badge, one next-action | ✓ promote from census/retention |
| **Employee card** | name, title, facility, tenure, cert/review flags | ✓ promote from HCOS people grid |
| **Facility card** | name, brand, census/beds, open queue counts | ★ new (Ops Center facility filter needs it) |
| **Timeline** | vertical, date-grouped, icon per event type, `--line` rail | ✓ exists in openHcosPerson + journey — extract ONE `.timeline` |
| **Approval panel** | request summary → context (balance, policy) → Approve / Deny+reason; renders as drawer on desktop, sheet on mobile | ★ new (leave approvals first consumer) |
| **Document panel** | file list + preview + meta + "ask this document" AI input | ✓ leases tab has it — extract |
| **Notes editor** | autosizing textarea, author+timestamp stamp, immutable after save (append-only) | ✓ scattered — standardize |
| **Empty state** | icon (line, not emoji) + one sentence + primary action ("No open orders — Add the first one") | ★ new (`.empty`) — replace bare "None." hints |
| **Loading state** | skeleton bars in card shape; no spinners on full pages | ★ new (`.skel`) — replace "Loading…" text |
| **Error state** | in-card: cause + Retry; never a blank card | ★ new (api() already surfaces messages — wrap in recipe) |
| **Audit trail** | table: when · who · what · detail; filterable; read-only | ✓ audit view — restyle to recipe |
| **AI assistant panel** | right-side drawer, context-scoped ("Ask about this lease/person/business"), streaming answer, sources line | ✓ three exist (lease/HR/askai) — ONE component, three scopes |
| **Chip row / filter bar** | horizontal scroll chips for scopes (exists: chip-row) | ✓ |
| **Kanban** | swipe columns (exists: corp-kanban) | ✓ |
| **Drawer/sheet** | desktop right drawer 420px; mobile bottom sheet; for detail-without-navigation | ★ new — the biggest UX upgrade for 3-click flows |

---

# 6 · OPERATIONS CENTER HOMEPAGE (spec vs shipped)

**Shipped v1 (this week):** `/api/opscenter` tile feed — Right now (census, beds, admissions today, expected arrivals, pending discharges, incidents) · Work queues (orders, maintenance, concierge, HR tasks, projects, doc-gap) · People & compliance (reviews, certs, leave, cases, pipeline, insurance). Every tile drills into the exact page+tab. Alert tiles tint amber/red. Failed tiles self-remove.

**v2 target (this design):**
```
┌ ESCALATION BANNER (only if something is on fire) ─────────────┐
├ TODAY'S PRIORITIES ── my items, due-ordered, ≤7 rows ─────────┤
│  🔴 overdue first — each row = one tap into the workflow      │
├ RIGHT NOW ──────── stat cards, live counts ───────────────────┤
├ WORK QUEUES ────── stat cards with owner avatars ─────────────┤
├ PEOPLE & COMPLIANCE ──────────────────────────────────────────┤
└ ACTIVITY FEED ──── last 20 events from org_events (collapsed) ┘
```
Additions in order: **facility filter** (chip row across the top; needs facility_id scoping in each tile query — spine exists) → **Today's priorities strip** (the Today inbox inlined) → **authorization-expirations tile** (blocked on UR register) → **staffing-gaps tile** (blocked on shift-vs-standard math) → **billing-blockers tile** (doc-gap is v1 of this; grows with RCM) → **activity feed** (blocked on org_events table).

---

# 7 · ROLE-BASED HOMEPAGES

*One layout engine (L1/L2 patterns), per-role tile sets and priorities. Roles map to today's job_role values; ○ = role not in the system yet.*

| Role | Lands on | Sees first (in order) | Never sees |
|---|---|---|---|
| **CEO / Owner** | Ops Center (all facilities) | escalations · census & beds by facility · money signals · compliance flags | individual task minutiae |
| **Corporate Admin / EA (Chava)** | Ops Center (queue-weighted) | orders to place · landlord items · insurance ≤60d · lease flags · projects | clinical anything |
| **Facility Director (ED)** | Ops Center (their facility) | incidents · staffing today · pending discharges · doc-gaps · overdue tasks | other facilities (unless granted) |
| **HR Director** | HCOS dashboard | cases · reviews overdue · certs ≤30d · leave queue · pipeline | clinical, finance |
| **Clinical Director** | Ops Center (clinical group first) | risk-flagged patients · rounds compliance · incidents · discharge queue · doc-gaps | corporate finance |
| **Nurse** | My Shift (exists, keep) | rounds due · new arrivals · med/vitals flags · handoff notes | corporate, HR, other facilities |
| **Case Manager** | My Shift | discharges in 72h · UR/auth dates · family follow-ups · aftercare gaps | corporate |
| ○ **Peer Support** | My Shift variant | my caseload check-ins · engagement flags · alumni outreach | clinical records beyond scope |
| **Admissions Rep (Front Desk)** | My Shift | expected arrivals · referrals waiting · bed availability · intake checklist | HR, finance |
| ○ **Billing / UR** | Auth work queue (L3) | auths expiring ≤7d · doc-gap discharges · pending reviews | clinical notes beyond UR scope |
| ○ **Business Development** | BD dashboard | referral volume by source · partner follow-ups · conversion | clinical, HR |
| ○ **Compliance Officer** | Compliance dashboard | expired certs · missing docs · incident review queue · audit prep | comp/salary data |

**Implementation:** one `HOME_OF[job_role]` map + per-role tile-set filter on /api/opscenter (`?role=` implicit from session). The Ops Center endpoint already returns group+key per tile — role filtering is a whitelist, not new queries.

---

# 8 · UX RULES (product law — PR-reviewable)

1. **One primary action per page**, visually singular (gold). Everything else is ghost/secondary.
2. **Every table**: search + filter + sort; export (CSV) only where the role's permission scope allows; ≤760px it becomes cards (m-cards — exists).
3. **Every record** (patient, employee, facility, entity) **has a timeline tab.** No timeline, not a record — it's a row.
4. **Critical actions confirm; destructive actions confirm + permission + audit row.** (Discharge, terminate, delete, payment method changes.)
5. **Every task carries owner · due date · priority · status · related record.** A task missing any of these can't be created.
6. **Every dashboard number drills.** A count you can't tap is decoration — remove it or wire it.
7. **Empty states instruct** ("No leases for Dayton yet — Upload the lease") — with the action inline.
8. **Notifications are actionable or absent.** Every alert/email deep-links to the exact queue (census email doc-gap nudge is the pattern).
9. **Never block on load.** Skeletons, per-tile independence (Ops Center pattern), last-good retention for external data (Kipu pattern — exists).
10. **PHI discipline in UI:** patient full names never on corporate-scope screens; initials + ID where corporate roles can see lists.

---

# 9 · MOBILE / TABLET

*The .mhub system (data-th card stacking, corp-tabs pills, chip rows, swipe kanban) is the foundation — extend it shell-wide, don't reinvent.*

| Context | Rules |
|---|---|
| **Desktop ≥1100px** | Full sidebar + drawers; command center is 3-4 tiles/row; tables are tables. |
| **Tablet 761–1099px** (rounding, med carts) | Sidebar collapses to icon rail; touch targets ≥44px; rounds/arrival checklists get big-tap rows; keyboard-free flows (taps + pickers). |
| **Mobile ≤760px** | Sidebar = hamburger sheet (exists); every table → m-cards (exists); tabs → horizontal pill scroll (exists); bottom-sheet for drawers; sticky primary action bottom-right. |
| **Mobile quick actions** | My Shift/Ops Center tiles are the launcher — no deep nav needed for: log round, mark ordered, approve leave, acknowledge incident. |
| **Mobile approvals** | Approval panel = bottom sheet: summary → context → Approve/Deny. One thumb. |
| **Mobile census** | Patient cards: name · bed · LOS · risk dot · next action. Swipe left = quick actions (note, flag). |
| **Mobile staff task list** | Today inbox as checklist; complete = one tap + undo toast (no confirm modals for reversible checks). |

---

# 10 · IMPLEMENTATION PLAN

**Phasing principle:** tokens → shell → recipes → screens. No screen redesign before its recipe exists; no big-bang rewrite — the app ships daily.

### Phase D1 — Token & recipe foundation (CSS only, zero behavior risk)
1. `styles.css`: add ★ tokens (spacing scale, type scale, `--line-2`, `--info`, motion vars); alias existing hardcoded hexes to tokens where they already match.
2. New recipe classes: `.alert-card`, `.banner-*`, `.q-row`, `.empty`, `.skel`, `.timeline`, `.drawer/.sheet`, `.badge-*`.
3. Sweep: replace "Loading…" hints with `.skel`, bare "None." with `.empty` (mechanical, high-visibility polish).

### Phase D2 — Shell upgrade (the "always know where I am" layer)
4. Top context bar: facility chip (org_facilities + user_facility_access), role badge + preview banner, alerts badge (from /api/opscenter), Today inbox button. `index.html` shell + `app.js` header render.
5. Global search ⌘K: one `/api/search?q=` across clients/employees/orders/vendors/docs/pages (name-indexed LIKE is fine at this scale) + overlay component.
6. Sidebar regroup to §4.1 (labels + GROUP_OF only — view IDs unchanged, zero logic risk); icon column.

### Phase D3 — Ops Center v2 + Today
7. Today inbox endpoint (my tasks across modules) + priorities strip on Ops Center.
8. Facility filter on /api/opscenter (facility_id scoping per tile).
9. Per-role tile whitelists + `HOME_OF` landing map.

### Phase D4 — Record layouts
10. Patient chart (journey) and employee profile (openHcosPerson) restyled to L4/L5: identity header + tab strip + shared `.timeline`.
11. Approval panel (leave first), drawer/sheet component.

### Phase D5 — Continuous
12. Each new module (Authorizations, Peer Support, BD, Billing) ships *on* the system: picks a layout pattern, uses recipes, adds its Ops Center tile and role homepage row. The design system is the gate.

### Files to create / refactor
| File | Action |
|---|---|
| `public/styles.css` | extend `:root` tokens; add recipe classes (D1); shell header styles (D2) |
| `public/index.html` | top context bar markup; sidebar regroup; ⌘K overlay host |
| `public/app.js` | header render (facility chip/role badge/alerts/Today); search overlay; GROUP_OF regroup; HOME_OF; skeleton/empty helpers (`skel()`, `empty()`) |
| `server.js` | `/api/search`; `/api/today` (my inbox); opscenter facility filter + role whitelists |
| `src/db.js` | org_events table (activity feed + audit spine, per architecture doc) |
| *(no new frameworks)* | the plain-JS + CSS approach stays — it's why the app is fast; the system is discipline, not tooling |

**Definition of done for the redesign:** a new employee, on their phone, finds their most urgent task within 5 seconds of logging in, at every role — and the owner switches from "all facilities" to any one facility and every number on screen re-scopes.
