# ADR-0012: Metrics registry and scorecards (Epic 12)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Product Owner, Data Governance Council

## Context

Epic 12 requires the metric registry, calculation service, scorecards,
definitions/provenance, and export (blueprint §27), under §19's rule that a
metric may never be displayed without its definition and provenance, and
CLAUDE.md #15's requirement that the platform stays honest when a source is
unavailable.

## Decision

1. **Complete-or-rejected definitions** (`@armada/metrics`): every §19
   field is required or explicitly optional — business question, owner
   role, formula, numerator/denominator, inclusion/exclusion criteria,
   source systems, refresh schedule, expected latency, unit,
   directionality, target/warning, segmentation, version. Definitions are
   governance content: draft → active requires an approver role
   (executive, quality/risk, compliance) who is not the definer; audited.
2. **Observations carry provenance or don't exist:** each observation
   records value, numerator/denominator, as-of time, computed time, metric
   version, and at least one provenance source with a timestamp. A
   calculator that throws or has no source yields **no_data** — the
   scorecard never shows a stale or invented number.
3. **Scorecard entries are self-explanatory:** each entry embeds the
   definition tooltip (question, formula, owner, sources, refresh,
   latency, target, version), the status (on_target / warning /
   off_target / informational / no_data, computed from directionality and
   thresholds), and the previous value for trend.
4. **Calculators live at the edge** (`apps/api/metricsSetup.ts`), computing
   from the platform's live services: occupancy from ingested census
   snapshots, conversion from opportunity stages, denial rate from
   claim/denial records, overdue items from the work service. The weekend
   AMA metric is defined but has **no calculator on purpose** — its source
   requires signed Kipu discovery, so it reports no_data rather than a
   guess.
5. **Access and isolation:** metric surfaces are gated by the
   census_summary capability; an org-wide scorecard needs org-wide scope,
   and facility scorecards enforce facility isolation through the policy
   engine. CSV export (`?format=csv`) serves offline/downtime review.

## Consequences

- Epic 10 workspaces and Epic 11's lineup consume `scorecardView` /
  entries as-is; the §21 `GET /api/v1/scorecards/:id` endpoint is live.
- Observation history is in-memory pending the database epic; per-source
  freshness targets (§25) attach to definitions when real connectors
  land.
- Targets in the seed are synthetic placeholders; the Data Governance
  Council owns real ones.

## Security / privacy notes

Metrics are aggregates over operational data — no patient-level values,
no PHI in definitions, observations, or CSV output. Facility isolation is
enforced on every scorecard read.
