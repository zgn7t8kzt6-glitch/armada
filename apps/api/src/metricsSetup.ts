import type { AuditLog } from '@armada/audit';
import type { InMemoryIngestedRecordStore } from '@armada/integrations-core';
import { MetricsService, seedMetricDefinitions } from '@armada/metrics';
import type { WorkItemService } from '@armada/work';
import type { Facility } from './seed.js';

/**
 * Wires the metric registry to the platform's live (synthetic) sources:
 * ingested canonical records for census/growth/revenue metrics and the
 * work-item service for operational discipline. A missing source yields
 * no_data — never a stale or invented number (CLAUDE.md #15).
 */

export interface MetricsWiring {
  readonly audit: AuditLog;
  readonly work: WorkItemService;
  readonly ingestStore?: InMemoryIngestedRecordStore;
  readonly facilities: readonly Facility[];
  readonly seedActors: { readonly definedBy: string; readonly approvedBy: string };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function wireMetrics(wiring: MetricsWiring): MetricsService {
  const metrics = new MetricsService({ audit: wiring.audit });
  seedMetricDefinitions(metrics, wiring.seedActors);
  const store = wiring.ingestStore;

  metrics.registerCalculator('census.occupancy_rate', (scope) => {
    if (store === undefined) return undefined;
    const snapshots = store.list({ sourceSystem: 'KIPU', entityType: 'census_snapshot' });
    const relevant =
      scope.facilityId !== undefined
        ? snapshots.filter((r) => r.payload['facilityId'] === scope.facilityId)
        : snapshots;
    // Latest snapshot per facility.
    const latestByFacility = new Map<string, (typeof relevant)[number]>();
    for (const record of relevant) {
      const facilityId = String(record.payload['facilityId'] ?? '');
      const sequence = Number(record.payload['sequence'] ?? 0);
      const current = latestByFacility.get(facilityId);
      if (current === undefined || Number(current.payload['sequence'] ?? 0) < sequence) {
        latestByFacility.set(facilityId, record);
      }
    }
    if (latestByFacility.size === 0) return undefined;
    let census = 0;
    let beds = 0;
    let newestRetrievedAt = '';
    for (const record of latestByFacility.values()) {
      census += Number(record.payload['censusCount'] ?? 0);
      beds += Number(record.payload['censusCount'] ?? 0) + Number(record.payload['bedsAvailable'] ?? 0);
      if (record.retrievedAt > newestRetrievedAt) newestRetrievedAt = record.retrievedAt;
    }
    if (beds === 0) return undefined;
    return {
      value: round1((census / beds) * 100),
      numerator: census,
      denominator: beds,
      asOf: newestRetrievedAt,
      provenance: [
        {
          sourceSystem: 'mock-kipu',
          detail: `latest census snapshots for ${latestByFacility.size} facility(ies)`,
          asOf: newestRetrievedAt,
          recordCount: latestByFacility.size,
        },
      ],
    };
  });

  metrics.registerCalculator('work.overdue_items', (scope) => {
    const facilityIds =
      scope.facilityId !== undefined ? [scope.facilityId] : wiring.facilities.map((f) => f.id);
    const overdue = facilityIds.flatMap((facilityId) =>
      wiring.work.listQueue({ facilityId, overdueOnly: true }),
    );
    const asOf = new Date().toISOString();
    return {
      value: overdue.length,
      asOf,
      provenance: [
        {
          sourceSystem: 'aip-work-service',
          detail: `overdue scan across ${facilityIds.length} facility(ies)`,
          asOf,
          recordCount: overdue.length,
        },
      ],
    };
  });

  metrics.registerCalculator('admissions.conversion_rate', () => {
    if (store === undefined) return undefined;
    const opportunities = store.list({
      sourceSystem: 'SALESFORCE',
      entityType: 'admission_opportunity',
    });
    const terminal = opportunities.filter((r) => {
      const stage = String(r.payload['stage'] ?? '');
      return stage === 'admitted' || stage === 'lost';
    });
    if (terminal.length === 0) return undefined;
    const admitted = terminal.filter((r) => r.payload['stage'] === 'admitted').length;
    const newest = [...terminal].sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt)).at(-1);
    return {
      value: round1((admitted / terminal.length) * 100),
      numerator: admitted,
      denominator: terminal.length,
      asOf: newest?.retrievedAt ?? new Date().toISOString(),
      provenance: [
        {
          sourceSystem: 'mock-salesforce',
          detail: 'terminal-stage admission opportunities',
          asOf: newest?.retrievedAt ?? new Date().toISOString(),
          recordCount: terminal.length,
        },
      ],
    };
  });

  metrics.registerCalculator('revenue.denial_rate', () => {
    if (store === undefined) return undefined;
    const claims = store.list({ sourceSystem: 'COLLABORATEMD', entityType: 'claim_summary' });
    if (claims.length === 0) return undefined;
    const deniedClaimIds = new Set(
      store
        .list({ sourceSystem: 'COLLABORATEMD', entityType: 'denial_summary' })
        .map((r) => String(r.payload['claimId'] ?? '')),
    );
    const denied = claims.filter((r) => deniedClaimIds.has(String(r.payload['claimId'] ?? ''))).length;
    const newest = [...claims].sort((a, b) => a.retrievedAt.localeCompare(b.retrievedAt)).at(-1);
    return {
      value: round1((denied / claims.length) * 100),
      numerator: denied,
      denominator: claims.length,
      asOf: newest?.retrievedAt ?? new Date().toISOString(),
      provenance: [
        {
          sourceSystem: 'mock-collaboratemd',
          detail: 'claims with at least one denial record',
          asOf: newest?.retrievedAt ?? new Date().toISOString(),
          recordCount: claims.length,
        },
      ],
    };
  });

  // ama.weekend_rate has no calculator on purpose: its source requires
  // signed Kipu discovery. The scorecard shows no_data, not a guess.

  return metrics;
}
