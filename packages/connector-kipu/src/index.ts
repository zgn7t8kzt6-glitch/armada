import {
  MockConnector,
  type MappingRegistration,
  type MockEntitySpec,
} from '@armada/integrations-core';

/**
 * Kipu connector package — MOCK ONLY.
 *
 * Kipu is the clinical system of record. No real adapter code may be added
 * here until the signed capability matrix exists at
 * docs/vendor-discovery/kipu-capability-matrix.md (CLAUDE.md #1–2), and no
 * write workflow may ever be implemented from assumptions (blueprint §13.1).
 * The mock emits synthetic operational summaries only — no clinical notes,
 * consistent with phase-one scope (§7.2).
 */

export const KIPU_SCHEMA_VERSION = 'mock-kipu-1';
export const KIPU_MAPPING_VERSION = 'kipu-map-0.1';
export const KIPU_DOCS_REF = 'docs/vendor-discovery/kipu-capability-matrix.md';

export interface MockKipuConfig {
  readonly facilityIds: readonly string[];
  readonly recordsPerEntity?: number;
  readonly includeMalformed?: boolean;
  readonly simulateUnhealthy?: boolean;
  readonly now?: () => Date;
}

function entities(facilityIds: readonly string[]): readonly MockEntitySpec[] {
  const facility = (n: number): string => facilityIds[(n - 1) % facilityIds.length] ?? 'fac-unknown';
  return [
    {
      entityType: 'census_snapshot',
      classification: [],
      payloadFor: (n) => ({
        facilityId: facility(n),
        censusCount: 20 + (n % 7),
        bedsAvailable: 4 + (n % 3),
      }),
    },
    {
      entityType: 'admission_event',
      classification: ['PHI'],
      payloadFor: (n) => ({
        episodeId: `ep-${facility(n)}-${1000 + n}`,
        facilityId: facility(n),
        levelOfCare: n % 2 === 0 ? '3.7-WM' : '3.5',
        admittedAt: `2026-07-${String(1 + (n % 20)).padStart(2, '0')}T09:00:00.000Z`,
      }),
    },
    {
      entityType: 'authorization_summary',
      classification: ['PHI'],
      payloadFor: (n) => ({
        authorizationId: `auth-${2000 + n}`,
        episodeId: `ep-${facility(n)}-${1000 + n}`,
        status: 'active',
        endAt: `2026-07-${String(22 + (n % 7)).padStart(2, '0')}T00:00:00.000Z`,
      }),
    },
  ];
}

export function kipuMappingRegistrations(): readonly MappingRegistration[] {
  return entities(['x']).map((entity) => ({
    sourceSystem: 'KIPU',
    entityType: entity.entityType,
    schemaVersion: KIPU_SCHEMA_VERSION,
    mappingVersion: KIPU_MAPPING_VERSION,
  }));
}

export function createMockKipuConnector(config: MockKipuConfig): MockConnector {
  if (config.facilityIds.length === 0) {
    throw new Error('MockKipuConnector requires at least one facilityId');
  }
  return new MockConnector({
    name: 'mock-kipu',
    sourceSystem: 'KIPU',
    schemaVersion: KIPU_SCHEMA_VERSION,
    mappingVersion: KIPU_MAPPING_VERSION,
    docsRef: KIPU_DOCS_REF,
    entities: entities(config.facilityIds),
    recordsPerEntity: config.recordsPerEntity ?? 6,
    ...(config.includeMalformed !== undefined ? { includeMalformed: config.includeMalformed } : {}),
    ...(config.simulateUnhealthy !== undefined
      ? { simulateUnhealthy: config.simulateUnhealthy }
      : {}),
    ...(config.now !== undefined ? { now: config.now } : {}),
  });
}
