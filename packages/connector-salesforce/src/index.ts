import {
  MockConnector,
  type MappingRegistration,
  type MockEntitySpec,
} from '@armada/integrations-core';

/**
 * Salesforce connector package — MOCK ONLY.
 *
 * Salesforce is the growth/relationship system of record. No real adapter
 * code (OAuth connected app, CDC/polling) may be added until the org
 * assessment exists at docs/vendor-discovery/salesforce-org-assessment.md
 * (CLAUDE.md #1–2). Lead data may contain PII/PHI in the real org, so mock
 * leads are classified PHI to exercise the same handling paths.
 */

export const SALESFORCE_SCHEMA_VERSION = 'mock-salesforce-1';
export const SALESFORCE_MAPPING_VERSION = 'salesforce-map-0.1';
export const SALESFORCE_DOCS_REF = 'docs/vendor-discovery/salesforce-org-assessment.md';

export interface MockSalesforceConfig {
  readonly recordsPerEntity?: number;
  readonly includeMalformed?: boolean;
  readonly simulateUnhealthy?: boolean;
  readonly now?: () => Date;
}

const STAGES = ['inquiry', 'qualified', 'scheduled', 'admitted', 'lost'] as const;

const ENTITIES: readonly MockEntitySpec[] = [
  {
    entityType: 'lead',
    classification: ['PHI'],
    payloadFor: (n) => ({
      leadId: `lead-${3000 + n}`,
      channel: n % 2 === 0 ? 'phone' : 'web_form',
      status: STAGES[n % STAGES.length],
      receivedAt: `2026-07-${String(1 + (n % 20)).padStart(2, '0')}T14:00:00.000Z`,
    }),
  },
  {
    entityType: 'referral_organization',
    classification: [],
    payloadFor: (n) => ({
      referralOrgId: `ref-org-${100 + n}`,
      name: `Synthetic Referral Organization ${100 + n}`,
      type: n % 2 === 0 ? 'hospital' : 'outpatient_provider',
    }),
  },
  {
    entityType: 'admission_opportunity',
    classification: ['PHI'],
    payloadFor: (n) => ({
      opportunityId: `opp-${4000 + n}`,
      leadId: `lead-${3000 + n}`,
      stage: STAGES[n % STAGES.length],
      targetFacilityId: n % 2 === 0 ? 'fac-akron' : 'fac-columbus',
    }),
  },
];

export function salesforceMappingRegistrations(): readonly MappingRegistration[] {
  return ENTITIES.map((entity) => ({
    sourceSystem: 'SALESFORCE',
    entityType: entity.entityType,
    schemaVersion: SALESFORCE_SCHEMA_VERSION,
    mappingVersion: SALESFORCE_MAPPING_VERSION,
  }));
}

export function createMockSalesforceConnector(config: MockSalesforceConfig = {}): MockConnector {
  return new MockConnector({
    name: 'mock-salesforce',
    sourceSystem: 'SALESFORCE',
    schemaVersion: SALESFORCE_SCHEMA_VERSION,
    mappingVersion: SALESFORCE_MAPPING_VERSION,
    docsRef: SALESFORCE_DOCS_REF,
    entities: ENTITIES,
    recordsPerEntity: config.recordsPerEntity ?? 6,
    ...(config.includeMalformed !== undefined ? { includeMalformed: config.includeMalformed } : {}),
    ...(config.simulateUnhealthy !== undefined
      ? { simulateUnhealthy: config.simulateUnhealthy }
      : {}),
    ...(config.now !== undefined ? { now: config.now } : {}),
  });
}
