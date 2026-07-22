# ADR-0016: Initial web UI is dependency-free server-rendered HTML (Epic 10)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Product Owner

## Context

Blueprint §5.1 recommends Next.js/React/Tailwind; ADR-0003 and the
leadership directive keep the dependency tree empty pending explicit
review. Epic 10 needs role-based pages now: executive, clinical/UR/
revenue-style work queues, quality/compliance, and administration.

## Decision

`apps/web` is a thin server-rendered application on `node:http`: no
framework, no client JavaScript, inline CSS, strict CSP
(`default-src 'none'`). It holds no business logic and no data — every
page renders from the policy-gated API using the user's own bearer token,
stored in an HttpOnly SameSite cookie. Pages: sign-in (dev IdP), role-aware
home ("my work" first), work queue, executive scorecard (definitions +
provenance + text-and-symbol status badges, never color alone), daily
lineup with printable view, Excellence library, identity review,
compliance readiness, and connector administration. Navigation is built
from the user's roles (§2.2); API 403s render honest "not available for
your role" pages; an unreachable API renders a downtime notice pointing to
manual procedures (§26). Accessibility: semantic HTML, skip links, labeled
navigation, table captions/scopes, high contrast (§20 targets; formal WCAG
audit pre-production).

Adopting React/Next.js remains open as a future ADR when interactivity
demands it; the API contract — the real interface — is unchanged by that
choice.

## Consequences

- Zero new dependencies; the whole UI is reviewable in one sitting.
- No client-side interactivity (forms and links only) — acceptable for
  phase-one read-heavy workspaces; the lineup editor and reconciliation
  actions currently exercise the API directly.

## Security / privacy notes

Strict CSP and full output escaping (tested with injection fixtures);
tokens never reachable by script; the web tier adds no data storage, so it
adds no PHI surface beyond the API's own controls.
