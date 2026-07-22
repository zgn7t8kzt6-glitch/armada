# ADR-0007: Append-only audit log with hash chaining

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Security Lead, Compliance Officer

## Context

Blueprint §22 requires immutable audit events with integrity controls:
actor, action, subject, facility, purpose, timestamp, request ID, policy
decision, and break-glass reason — with no raw PHI. Break-glass and policy
enforcement (ADR-0006) cannot ship without it.

## Decision

`@armada/audit` provides an `AuditLog` contract exposing exactly `append`,
`query`, and `verifyIntegrity` — no update or delete exists on the interface.
Each event is frozen and carries a SHA-256 hash over its canonical fields
plus the previous event's hash, so content changes, reordering, or deletion
break `verifyIntegrity()`. Event contents are internal references only
(IDs, codes, request IDs); the deny-list logger remains a second layer, but
the primary control is that callers never put PHI in events.

The in-memory implementation serves development and tests. The database epic
must implement the same contract on PostgreSQL with append-only privileges
(no UPDATE/DELETE grants), periodic anchor hashes, and a retention schedule
approved by legal/compliance before production.

## Consequences

Tamper-evidence, not tamper-proofness: an attacker who can rewrite the whole
chain in memory defeats it. Durability, anchoring, and privilege separation
are database-epic obligations recorded here so they are not forgotten.

## Security / privacy notes

Audit events are themselves access-controlled (classification PHI for
event streams that reveal care relationships); reading them requires
privacy/compliance/auditor capability through the policy engine.
