# ADR-0011: Identity resolution (Epic 9)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Privacy Officer, Data Governance Council

## Context

Epic 9 requires the person crosswalk, matching rules, human review queue,
and merge/unmerge controls (blueprint §27), under §9's rule set and the
non-negotiable that ambiguous identities are never auto-merged (CLAUDE.md
#10). Wrong-patient linkage is the highest-consequence data error this
platform can make.

## Decision

1. **Deterministic-only auto-linking** (`@armada/identity`), rules in order:
   - R0: existing crosswalk for the (sourceSystem, sourceRecordId).
   - R1: exact facility-scoped MRN + DOB, unique candidate.
   - R2: exact normalized legal name + DOB + one corroborating attribute
     (phone, email, payer member ID, or address), unique candidate.
   - R3: no meaningful candidates → create a new person + crosswalk.
   Normalization is conservative (case/whitespace/punctuation only); there
   is no fuzzy or phonetic matching — anything short of exact normalized
   equality is a human decision. Probabilistic scoring, if ever added,
   feeds the review queue only (per §9.1), never auto-links.
2. **Hard-conflict veto:** any candidate conflicting on facility-scoped MRN
   or DOB blocks all auto-linking and queues a `conflicting_identifiers`
   review. Multiple qualifying candidates queue `multiple_candidates`;
   partial matches queue `low_confidence`.
3. **Review queue:** issues carry the incoming identity, every candidate
   with matched/conflicting/differing field names, and full action history.
   Actions: link (must target a listed candidate), create new, defer
   (reopenable), escalate. The console endpoint embeds candidate signals
   side by side (§9.3) and every read is policy-gated *and* audited —
   identity signals are PHI.
4. **Merge is dual-confirmed, always:** request + confirmation by a
   different reviewer (§9.2's "dual confirmation for high-risk records" —
   we treat every person merge as high-risk). Execution moves crosswalks
   to the primary and soft-marks the duplicate; **unmerge** restores the
   duplicate and its crosswalks exactly, and both directions are fully
   audited.
5. **Crosswalk invariants:** vendor IDs never serve as person IDs; merged
   persons resolve transitively to their canonical record; audit events
   carry internal IDs, rule IDs, and field *names* — never signal values
   (tested).
6. **Access:** new `identity_reconciliation` resource — read+write PHI for
   privacy/compliance administrators and quality/risk; read-only for the
   auditor role. Org-wide scope required.

## Consequences

- Ingestion (Epic 5) can call `resolve()` per person-bearing record once
  vendor payload shapes are known post-discovery; today the seed scenarios
  exercise every path with synthetic identities.
- In-memory storage as with all pre-database services; the store swaps
  behind the same contract, with crosswalk tables per §7.6.
- The approved-attribute list for R2 is code today; the Data Governance
  Council owns changes to it (§3.2 matching-rule ownership).

## Security / privacy notes

Signals live only in the identity store and the gated console response.
Part 2 minimization (§9.3: never show a reviewer more than authorized)
currently relies on the PHI capability gate; per-field Part 2 redaction
arrives with the consent service (Epic 13) and is noted as a dependency
there. Every read and mutation is audited.
