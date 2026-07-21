import type { UserStore } from '@armada/auth';

/**
 * Synthetic development directory (CLAUDE.md #6: synthetic data only).
 * Every identity is fictional; the census numbers are invented operational
 * counts, not patient records. Never seeded in production.
 */

export interface Facility {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
}

export interface SyntheticDirectory {
  readonly organizationId: string;
  readonly facilities: readonly Facility[];
  readonly censusByFacility: ReadonlyMap<string, number>;
}

export const SYNTHETIC_ORG = 'org-armada';
export const FAC_AKRON = 'fac-akron';
export const FAC_COLUMBUS = 'fac-columbus';

export function seedSyntheticDirectory(users: UserStore): SyntheticDirectory {
  const facilities: readonly Facility[] = [
    { id: FAC_AKRON, name: 'Akron Residential (synthetic)', organizationId: SYNTHETIC_ORG },
    {
      id: FAC_COLUMBUS,
      name: 'Columbus Withdrawal Management (synthetic)',
      organizationId: SYNTHETIC_ORG,
    },
  ];

  const seedUsers = [
    { email: 'sysadmin@dev.armada.example', name: 'Synthetic Sysadmin', role: 'system_administrator', scope: 'all' },
    { email: 'privacy@dev.armada.example', name: 'Synthetic Privacy Admin', role: 'privacy_administrator', scope: 'all' },
    { email: 'executive@dev.armada.example', name: 'Synthetic Executive', role: 'executive', scope: 'all' },
    { email: 'auditor@dev.armada.example', name: 'Synthetic Auditor', role: 'read_only_auditor', scope: 'all' },
    { email: 'nurse.akron@dev.armada.example', name: 'Synthetic Akron Nurse', role: 'nurse', scope: [FAC_AKRON] },
    { email: 'nurse.columbus@dev.armada.example', name: 'Synthetic Columbus Nurse', role: 'nurse', scope: [FAC_COLUMBUS] },
    { email: 'admissions.akron@dev.armada.example', name: 'Synthetic Akron Admissions', role: 'admissions', scope: [FAC_AKRON] },
    { email: 'quality@dev.armada.example', name: 'Synthetic Quality Lead', role: 'quality_risk', scope: 'all' },
    { email: 'bht.akron@dev.armada.example', name: 'Synthetic Akron BHT', role: 'bht_recovery_support', scope: [FAC_AKRON] },
  ] as const;

  for (const seed of seedUsers) {
    users.create({
      email: seed.email,
      displayName: seed.name,
      assignments: [
        {
          role: seed.role,
          organizationId: SYNTHETIC_ORG,
          facilityScope: seed.scope === 'all' ? 'all' : [...seed.scope],
        },
      ],
    });
  }

  return {
    organizationId: SYNTHETIC_ORG,
    facilities,
    censusByFacility: new Map([
      [FAC_AKRON, 24],
      [FAC_COLUMBUS, 11],
    ]),
  };
}
