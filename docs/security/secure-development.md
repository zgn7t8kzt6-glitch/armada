# Secure Development Practices

Working rules for contributors; the platform-level policy is `SECURITY.md`
and the modeled threats are blueprint §23 (the full threat-model document
grows here as features land).

## Always

- Validate every external boundary: HTTP input, environment variables
  (`@armada/env`), file input, and — later — connector payloads
  (schema-validated envelopes).
- Log through `@armada/observability` only. Log internal references (UUIDs,
  request IDs), never names, DOBs, MRNs, payloads, or free-text from source
  systems.
- Default deny. New endpoints ship with explicit authorization checks and
  authorization tests (CLAUDE.md #7) — including facility-isolation negative
  tests once Epic 2 lands.
- Keep secrets in the environment/vault. `npm run secrets:check` runs in CI;
  a hit means rotate first, then clean history.
- Feature-flag incomplete or high-risk paths off (`@armada/feature-flags`).
- Synthetic data only, everywhere below production.

## Never

- `console.log` in app code.
- Direct `process.env` reads in app code.
- New dependencies without an ADR (ADR-0003).
- Guessed vendor API behavior (CLAUDE.md #1–2).
- Autonomous clinical, medication, billing, claims, or consent logic
  (CLAUDE.md #4).

## Review checklist for sensitive features

Add threat-model notes to the PR covering: data classification touched,
new access paths, failure modes, audit events emitted, and rollback.
