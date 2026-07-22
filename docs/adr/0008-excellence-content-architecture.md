# ADR-0008: Excellence content architecture (Epic 3)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Product Owner, Quality/Risk

## Context

Epic 3 requires a Gold Standards CMS, role cards, policies, search,
versioning/approval, and print/PDF export (blueprint §27), with the §15
content models and the §1.1 rule that AES content must also exist in
printable and offline formats. Content is cultural/operational — never PHI —
but it is governed material: approvals must be attributable and history
immutable.

## Decision

1. **Typed content models** in `@armada/excellence`: `gold_standard`
   (§15.2 fields), `role_card` (§15.4 fields), `policy`, and
   `constitution_document` (§15.1 doc types), discriminated by `kind` and
   validated on every write.
2. **Version lifecycle:** draft → in_review → approved → published →
   superseded. Drafts are the only mutable stage; everything after
   submission is frozen, and publishing a revision supersedes — never
   overwrites — the prior version, preserving approval history verbatim.
3. **Separation of duties:** only the author may submit; the approver must
   hold an approver role (executive, clinical/nursing director, compliance,
   quality/risk) and must not be the author. Enforced in the service, not
   the UI.
4. **Access:** a new `excellence_content` resource in the capability matrix.
   Every role reads the library (it is the whole workforce's material);
   authoring is limited to content-governance roles. Reads are
   policy-checked but audited only on denial; every mutation is audited.
5. **Exports:** self-contained printable HTML (inline CSS, no scripts, all
   content HTML-escaped, versioned footer with "printed copies are
   uncontrolled") and plain text for downtime binders (§26). PDF is the
   browser's print pipeline — no PDF library (ADR-0003).
6. **Search:** dependency-free term-frequency scoring with title boost over
   published content. PostgreSQL full-text replaces the implementation —
   not the result shape — in the database epic.
7. **Starter content** (three Gold Standards, nurse/BHT role cards, service
   recovery policy, credo/patient promise) seeds development environments
   only and is explicitly marked as placeholder — leadership owns the real
   cultural constitution and replaces it through the workflow.

## Consequences

- Governance semantics (immutability, separation of duties) live in one
  tested service; the admin UI epic gets them for free.
- In-memory storage means content resets on restart until the database
  epic; acceptable for development, and the storage contract is isolated.
- Print output is deliberately plain; branding waits for the design system.

## Security / privacy notes

Content is user-authored: all rendering escapes HTML and the print route
carries a restrictive CSP, preventing stored XSS via content fields. Content
must never contain PHI; review is procedural for now and becomes a lintable
rule when content moves to the database.
