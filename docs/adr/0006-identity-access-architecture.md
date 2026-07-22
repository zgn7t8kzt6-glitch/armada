# ADR-0006: Identity and access architecture (Epic 2)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Security Lead, Privacy Officer

## Context

Epic 2 requires SSO, user provisioning, facility assignments, a role/policy
engine, break-glass, and access review (blueprint §27), with the §11 rule that
a role alone is never sufficient. ADR-0003 forbids new dependencies without
review, and a real OIDC client (Entra ID) needs a vetted library plus tenant
configuration that does not exist yet.

## Decision

1. **Authentication is an interface.** Apps depend on `IdentityProvider`
   (OIDC-shaped: issuer + subject claims). The only implementation today is
   `DevIdentityProvider` — passwordless against a synthetic directory, and it
   throws at construction when `NODE_ENV=production`, so a misdeployment
   fails closed. The production implementation (real OIDC authorization-code
   flow with MFA at the IdP) is a named future ADR and will introduce a
   vetted library at that point.
2. **Sessions are server-side records with signed bearer tokens**
   (HMAC-SHA256 via `node:crypto`). Verification requires both a valid
   signature and a live record, so revocation is immediate; TTLs are short
   and there is no refresh in Epic 2. Secrets must be ≥32 chars; the API
   refuses to boot in production with the dev default secret.
3. **Authorization is a pure policy engine** (`evaluateAccess`): default
   deny; ALLOW requires active user → organization match → facility coverage
   → role capability → classification ceiling. Decisions carry reason codes,
   obligations, and a policy version. Part 2 data is unconditionally denied
   until the Epic 13 consent service exists — no role, purpose, or
   break-glass overrides it.
4. **Break-glass** is a time-limited (≤60 min), reason-required, immediately
   audited facility-coverage grant for PHI **reads** only; it never unlocks
   writes or Part 2. Grants land in a privacy review queue and every use is
   audited with the reason.
5. **Provisioning** is a `UserStore` interface with an in-memory
   implementation; the database epic replaces the storage, not the contract.
   Access review is a pure report over users + break-glass history.

## Consequences

- All authorization logic is centrally testable; endpoints cannot invent
  their own rules.
- In-memory stores mean sessions and users reset on restart — acceptable in
  development, and production logins are impossible anyway until real SSO
  lands (production boots serve health checks only).
- The capability matrix is deliberately coarse; refining it per-workspace is
  Epic 10 work, and Part 2 handling is Epic 13 work.

## Security / privacy notes

Threats addressed from §23: revoked user retaining session (server-side
revocation), overbroad cross-facility access (facility scope + isolation
tests), insider misuse (all sensitive reads audited with policy decision),
dev auth leaking to production (fails closed at boot). MFA is deferred to the
real IdP by design and must be enforced there.
