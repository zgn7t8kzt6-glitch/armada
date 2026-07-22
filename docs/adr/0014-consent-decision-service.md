# ADR-0014: Consent decision service — fail-closed stub (Epic 13)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Privacy Officer (structure only — decision
  matrix approval remains open)

## Context

Blueprint §10 defines a consent/disclosure decision service with strict
safety rules; §10.3 forbids production implementation before legal/privacy
approval of the decision matrix and test cases. Epic 13 calls for the
directive model, a decision-service stub, tests, and access integration.

## Decision

`@armada/consent` implements the §10.1 inputs and §10.2 output shape
verbatim. Directives record categories, purposes, recipients, effective/
expiry dates, revocation, and policy basis. The decision logic is
deliberately incapable of approving Part 2 disclosures: without a
`legalApprovedMatrixVersion` (which only a Privacy-Officer/Counsel-approved
release may set), a covering valid directive yields REQUIRE_REVIEW with a
privacy-review obligation; everything else — no directive, wrong
purpose/recipient, expired (tested to the second), revoked — yields DENY.
Unclassified categories default-deny; non-Part-2 categories defer to the
RBAC engine. Every decision is audited without payload data.

The auth engine integrates: a PART2 resource passes its gate only with an
explicit consent ALLOW, then evaluates at the PHI ceiling — facility
isolation and role capability still apply, and break-glass still never
unlocks raw Part 2.

## Consequences

The platform can model consent workflows end to end today while remaining
provably unable to disclose Part 2 data autonomously. Turning on ALLOW is a
single, attributable release gated on counsel's matrix — with the §24
decision-table tests already in place.

## Security / privacy notes

This is the fail-closed control the privacy review will audit: the tests
assert no input combination reaches ALLOW without the approved matrix.
