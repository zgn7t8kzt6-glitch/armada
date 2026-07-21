# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Product Owner

## Context

The blueprint (§27 Epic 1, CLAUDE.md rule #12) requires an ADR process before
any other architectural work. The system will handle sensitive
behavioral-health operations; decisions must be attributable, reviewable, and
reversible-by-record rather than by memory.

## Decision

We will keep Architecture Decision Records in `docs/adr/`, numbered
sequentially, using the template in `0000-template.md`. ADRs are immutable
after acceptance; changes happen by superseding. Decision rights follow
blueprint §3.2.

## Consequences

Small overhead per material decision; in exchange, survey readiness and
onboarding get a written trail, and "why is it like this?" has an answer that
is not a chat log.

## Security / privacy notes

ADRs must never contain PHI, credentials, or vendor-confidential material —
they are plain repository documents.
