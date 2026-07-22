# ADR-0013: Daily lineup generator (Epic 11)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Product Owner, Facility leadership roles

## Context

The daily lineup (blueprint §15.3) is AES's cultural heartbeat and must
never be blocked by software (§0). Epic 11 requires the template, automated
operational facts, manual editing, approval/publish, and a printable view.

## Decision

`@armada/lineup` generates one lineup per facility per day: AIP fills the
Gold Standard (rotating daily through the published library), census,
arrivals, authorization risks, and operational barriers from live services;
recognition, safety focus, and improvement focus are human prompts. Every
generated fact carries source + freshness. A failing provider degrades one
section to "source unavailable — manual process applies"; the lineup always
generates (§24's morning-downtime negative test). Drafts are editable;
approval requires a lineup-approver role; published lineups are immutable;
every step is audited. The printable view is self-contained and offline-
capable, and states that the lineup must never be the only copy of
information required to run a shift. Access uses a new `daily_lineup`
capability: facility staff read; leadership roles write.

## Consequences

Attendance/acknowledgment (optional per the epic) is deferred. Clinical
content stays minimal — internal references and counts only.

## Security / privacy notes

Lineup bodies must use internal references; generated facts already comply.
Printable output is escaped; facility isolation enforced on every route.
