import {
  MockConnector,
  type MappingRegistration,
  type MockEntitySpec,
} from '@armada/integrations-core';

/**
 * CollaborateMD connector package — MOCK ONLY.
 *
 * CollaborateMD is the revenue-cycle system of record. Whether the real
 * integration is REST, SOAP, or a secure-file (SFTP) adapter is unknown
 * until discovery lands at
 * docs/vendor-discovery/collaboratemd-capability-matrix.md; until then only
 * this synthetic mock exists (blueprint §13.3). Claim summaries only —
 * never full claim payloads (§7.4).
 */

export const COLLABORATEMD_SCHEMA_VERSION = 'mock-collaboratemd-1';
export const COLLABORATEMD_MAPPING_VERSION = 'collaboratemd-map-0.1';
export const COLLABORATEMD_DOCS_REF = 'docs/vendor-discovery/collaboratemd-capability-matrix.md';

export interface MockCollaborateMdConfig {
  readonly recordsPerEntity?: number;
  readonly includeMalformed?: boolean;
  readonly simulateUnhealthy?: boolean;
  readonly now?: () => Date;
}

const CLAIM_STATUSES = ['submitted', 'accepted', 'rejected', 'paid', 'denied'] as const;

const ENTITIES: readonly MockEntitySpec[] = [
  {
    entityType: 'claim_summary',
    classification: ['PHI'],
    payloadFor: (n) => ({
      claimId: `clm-${5000 + n}`,
      episodeId: `ep-fac-akron-${1000 + n}`,
      status: CLAIM_STATUSES[n % CLAIM_STATUSES.length],
      balanceCents: 125_000 + n * 1_000,
      agedDays: (n * 7) % 120,
    }),
  },
  {
    entityType: 'denial_summary',
    classification: ['PHI'],
    payloadFor: (n) => ({
      denialId: `den-${6000 + n}`,
      claimId: `clm-${5000 + n}`,
      reasonCode: n % 2 === 0 ? 'CO-197' : 'CO-50',
      receivedAt: `2026-07-${String(1 + (n % 20)).padStart(2, '0')}T10:00:00.000Z`,
    }),
  },
  {
    entityType: 'payment_summary',
    classification: ['PHI'],
    payloadFor: (n) => ({
      paymentId: `pay-${7000 + n}`,
      claimId: `clm-${5000 + n}`,
      amountCents: 90_000 + n * 500,
      postedAt: `2026-07-${String(1 + (n % 20)).padStart(2, '0')}T16:00:00.000Z`,
    }),
  },
];

export function collaborateMdMappingRegistrations(): readonly MappingRegistration[] {
  return ENTITIES.map((entity) => ({
    sourceSystem: 'COLLABORATEMD',
    entityType: entity.entityType,
    schemaVersion: COLLABORATEMD_SCHEMA_VERSION,
    mappingVersion: COLLABORATEMD_MAPPING_VERSION,
  }));
}

export function createMockCollaborateMdConnector(
  config: MockCollaborateMdConfig = {},
): MockConnector {
  return new MockConnector({
    name: 'mock-collaboratemd',
    sourceSystem: 'COLLABORATEMD',
    schemaVersion: COLLABORATEMD_SCHEMA_VERSION,
    mappingVersion: COLLABORATEMD_MAPPING_VERSION,
    docsRef: COLLABORATEMD_DOCS_REF,
    entities: ENTITIES,
    recordsPerEntity: config.recordsPerEntity ?? 6,
    ...(config.includeMalformed !== undefined ? { includeMalformed: config.includeMalformed } : {}),
    ...(config.simulateUnhealthy !== undefined
      ? { simulateUnhealthy: config.simulateUnhealthy }
      : {}),
    ...(config.now !== undefined ? { now: config.now } : {}),
  });
}
