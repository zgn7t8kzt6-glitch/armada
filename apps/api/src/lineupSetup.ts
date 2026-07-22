import type { ExcellenceContentService } from '@armada/excellence';
import type { InMemoryIngestedRecordStore } from '@armada/integrations-core';
import type { LineupFactsProvider } from '@armada/lineup';
import type { WorkItemService } from '@armada/work';

/**
 * Wires the daily-lineup generator to live sources. Every provider returns
 * undefined when its source is unavailable — the lineup still generates
 * with that section marked for the manual downtime process (§26).
 */
export function createLineupFacts(deps: {
  readonly excellence: ExcellenceContentService;
  readonly work: WorkItemService;
  readonly ingestStore?: InMemoryIngestedRecordStore;
}): LineupFactsProvider {
  return {
    goldStandard() {
      const published = deps.excellence.listPublished('gold_standard');
      if (published.length === 0) return undefined;
      // Rotate by day so huddles cycle through the standards.
      const pick = published[new Date().getUTCDate() % published.length];
      if (pick === undefined || pick.body.kind !== 'gold_standard') return undefined;
      return {
        title: pick.title,
        statement: pick.body.statement,
        huddlePrompt: pick.body.huddlePrompt,
      };
    },
    census(facilityId) {
      const store = deps.ingestStore;
      if (store === undefined) return undefined;
      const snapshots = store
        .list({ sourceSystem: 'KIPU', entityType: 'census_snapshot' })
        .filter((r) => r.payload['facilityId'] === facilityId)
        .sort((a, b) => Number(a.payload['sequence'] ?? 0) - Number(b.payload['sequence'] ?? 0));
      const latest = snapshots.at(-1);
      if (latest === undefined) return undefined;
      const census = Number(latest.payload['censusCount'] ?? 0);
      const available = Number(latest.payload['bedsAvailable'] ?? 0);
      return {
        body: `Census ${census} with ${available} bed(s) available.`,
        sourceSystem: 'mock-kipu',
        asOf: latest.retrievedAt,
      };
    },
    arrivalsDischarges(facilityId) {
      const store = deps.ingestStore;
      if (store === undefined) return undefined;
      const admissions = store
        .list({ sourceSystem: 'KIPU', entityType: 'admission_event' })
        .filter((r) => r.payload['facilityId'] === facilityId);
      if (admissions.length === 0) return undefined;
      const newest = admissions.map((r) => r.retrievedAt).sort().at(-1) ?? '';
      return {
        body: `${admissions.length} admission event(s) on record; confirm today's arrivals and discharges at huddle.`,
        sourceSystem: 'mock-kipu',
        asOf: newest,
      };
    },
    authorizationRisks(facilityId) {
      const urItems = deps.work.listQueue({ facilityId }).filter(
        (i) => i.type.startsWith('ur.') && (i.status === 'open' || i.status === 'acknowledged'),
      );
      const asOf = new Date().toISOString();
      return {
        body:
          urItems.length === 0
            ? 'No open authorization risks in the work queue.'
            : `${urItems.length} open authorization risk(s): ${urItems
                .slice(0, 3)
                .map((i) => `${i.subjectId} (due ${i.dueAt.slice(0, 16)})`)
                .join('; ')}.`,
        sourceSystem: 'aip-work-service',
        asOf,
      };
    },
    operationalBarriers(facilityId) {
      const barriers = deps.work
        .listQueue({ facilityId })
        .filter(
          (i) =>
            (i.status === 'open' || i.status === 'acknowledged') &&
            (i.priority === 'critical' || i.priority === 'high'),
        );
      const asOf = new Date().toISOString();
      return {
        body:
          barriers.length === 0
            ? 'No high-priority operational barriers.'
            : barriers
                .slice(0, 3)
                .map((i) => `${i.title} (owner: ${i.ownerRole})`)
                .join(' · '),
        sourceSystem: 'aip-work-service',
        asOf,
      };
    },
  };
}
