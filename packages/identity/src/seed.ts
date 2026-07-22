import type { IdentityService } from './service.js';
import type { ResolutionResult } from './types.js';

/**
 * Synthetic development scenarios exercising every §9.2 path:
 * an MRN+DOB auto-link, a multiple-candidate review, and a DOB-conflict
 * review. All identities are fictional (".example" contact points).
 */

export interface IdentitySeedSummary {
  readonly autoLinked: ResolutionResult;
  readonly multiCandidateIssue: ResolutionResult;
  readonly conflictIssue: ResolutionResult;
}

export function seedIdentityScenarios(
  service: IdentityService,
  facilityIds: { akron: string; columbus: string },
): IdentitySeedSummary {
  service.registerPerson(
    {
      mrn: 'A-1001',
      mrnFacilityId: facilityIds.akron,
      legalName: 'Jordan Rivers (synthetic)',
      dateOfBirth: '1990-04-12',
      phone: '330-555-0101',
      email: 'jordan.rivers@synthetic.example',
    },
    'seed',
  );
  service.registerPerson(
    {
      legalName: 'Jordan Rivers (synthetic)',
      dateOfBirth: '1990-04-12',
      phone: '330-555-0999',
    },
    'seed',
  );
  service.registerPerson(
    {
      mrn: 'C-2002',
      mrnFacilityId: facilityIds.columbus,
      legalName: 'Casey Morgan (synthetic)',
      dateOfBirth: '1985-09-30',
      payerMemberId: 'PM-556677',
    },
    'seed',
  );

  // Kipu record with matching MRN + DOB → deterministic auto-link (R1).
  const autoLinked = service.resolve({
    sourceSystem: 'KIPU',
    sourceRecordId: 'patient-akron-1',
    signals: {
      mrn: 'a-1001',
      mrnFacilityId: facilityIds.akron,
      legalName: 'JORDAN RIVERS (SYNTHETIC)',
      dateOfBirth: '1990-04-12',
    },
  });

  // Salesforce lead matching two people on name+DOB → human review.
  const multiCandidateIssue = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-3001',
    signals: {
      legalName: 'Jordan  Rivers (synthetic)',
      dateOfBirth: '1990-04-12',
    },
  });

  // CollaborateMD account with matching MRN but conflicting DOB → review,
  // never auto-link (§9.2, §24 negative).
  const conflictIssue = service.resolve({
    sourceSystem: 'COLLABORATEMD',
    sourceRecordId: 'acct-77',
    signals: {
      mrn: 'C-2002',
      mrnFacilityId: facilityIds.columbus,
      legalName: 'Casey Morgan (synthetic)',
      dateOfBirth: '1985-10-01',
    },
  });

  return { autoLinked, multiCandidateIssue, conflictIssue };
}
