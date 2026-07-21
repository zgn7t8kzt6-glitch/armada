# ADR-0009: Work management architecture (Epic 4)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Product Owner, Nursing/Clinical Design Authorities

## Context

Epic 4 requires work queues, ownership, due dates, escalation, resolution
codes, and notifications (blueprint §27), with the §18 work-item model and
escalation principles, and CLAUDE.md #9's rule that every alert carries an
explanation, source timestamp, owner, and resolution method. This engine is
what later feeds role workspaces (Epic 10) and the rules engine's outcomes
(§17: rules put items into work queues).

## Decision

1. **Work items are self-explanatory records** (`@armada/work`): creation
   refuses items missing an explanation, a required action, an owner role,
   or at least one source fact with a valid source timestamp and source
   system. Deep links point into the authoritative system, which enforces
   its own authentication.
2. **PHI rule by convention + structure:** items carry stable internal
   references (episode/claim/room IDs) — never names or clinical content.
   Notifications are PHI-free *by construction*: the notifier payload is
   limited to type/priority/due/link, so no channel — including future
   email/SMS — can leak item content (§18).
3. **Ownership targets roles first, people second.** Every item has an
   owner role; acknowledging claims personal ownership. Escalation ladder
   for overdue items: level 1 at due time (owner role), level 2 after 4h
   (backup role, defaulting to facility administrator), level 3 after 12h
   (executive), capped at 3. The sweep is idempotent and runs on a
   one-minute interval in the API process until the database epic moves it
   to `apps/worker`. Manual escalation records who and why. Critical safety
   issues must use existing emergency channels; this is a work tracker.
4. **Resolution is a closed vocabulary** (completed, completed_with_exception,
   not_applicable, duplicate, transferred_to_source_system,
   unable_to_complete); exception codes demand an explanatory note.
   Resolved/cancelled items are terminal and immutable.
5. **Optimistic locking:** every mutation increments a version; callers may
   send `expectedVersion` and receive 409 on staleness (§8's version
   columns, ahead of the database).
6. **Authorization:** queue reads are policy-checked per facility
   (single-facility requests audited on denial; aggregate listings quietly
   filter to covered facilities); all mutations require `work_item` write
   capability at the item's facility and are audited.

## Consequences

- The rules engine (Epic 5+) gets a ready outcome target: `create()` with
  provenance-bearing facts.
- In-memory storage: items reset on restart until the database epic —
  matching every other Epic-2+ service, swapped behind the same contracts.
- The escalation policy is global (4h/12h); per-rule policies (§17
  `escalation_after_hours`) arrive with the rules engine.

## Security / privacy notes

Notification payload minimization is the load-bearing control — tested by
asserting serialized notifications never contain titles or explanations.
Queue reads honor facility isolation; mutations are audited with the policy
decision. Work-item content hygiene (internal refs only) is procedural until
a lintable rule can inspect fields at the database boundary.
