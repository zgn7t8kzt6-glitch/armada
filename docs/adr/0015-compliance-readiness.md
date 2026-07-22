# ADR-0015: Compliance readiness registry (Epic 14)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Compliance Officer, Quality/Risk

## Context

Blueprint §16 requires compliance content as versioned structured
requirements — citations, mappings, evidence — never unlicensed copies of
copyrighted standards, and CLAUDE.md #16 forbids claiming compliance.

## Decision

`@armada/compliance` provides: a validated requirement registry (§16
fields: authority, citation, applicability, summary, responsible
department/role, policy/procedure mappings, evidence examples, audit
method, review frequency, risk rating, version); evidence items linking
operational artifacts (audit events, work items, documents, attestations)
to requirements; corrective actions with owner roles, due dates, and
note-required closure; an audit calendar; and a readiness rollup that
surfaces evidence coverage, overdue reviews, and high-risk requirements
without evidence — honestly, including gaps. Access uses a new
`compliance_registry` capability (compliance/quality write; executive and
auditor read). Seeded requirements are citation-only starters (OAC
5122-29-09, HIPAA audit controls, Part 2 §2.13, JC care coordination).

## Consequences

Evidence collection can begin on day one of operations; the survey tracer
workspace UI builds on `readinessSummary`. Requirement content ownership
sits with the Compliance Officer; the register in
`docs/compliance/sources.md` remains the authority list.

## Security / privacy notes

No licensed standards text is stored; references point at licensed
locations. Evidence references are internal identifiers only.
