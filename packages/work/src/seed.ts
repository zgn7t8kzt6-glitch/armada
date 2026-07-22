import type { WorkItemService } from './service.js';
import type { WorkItem } from './types.js';

/**
 * Synthetic development work items. Subjects are internal references only
 * (episode/claim/room IDs) — no names, no clinical content.
 */

export interface WorkSeedInput {
  readonly organizationId: string;
  readonly akronFacilityId: string;
  readonly columbusFacilityId: string;
  readonly createdBy: string;
  readonly now?: () => Date;
}

export function seedWorkItems(service: WorkItemService, input: WorkSeedInput): readonly WorkItem[] {
  const now = (input.now ?? (() => new Date()))();
  const hours = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();
  const sourceStamp = new Date(now.getTime() - 30 * 60_000).toISOString();

  return [
    service.create({
      type: 'ur.authorization_expiring',
      title: 'Authorization for episode ep-akron-1042 expires within 48 hours',
      explanation:
        'The active payer authorization ends soon; without a concurrent review the stay after the last covered day is at denial risk.',
      organizationId: input.organizationId,
      facilityId: input.akronFacilityId,
      subjectType: 'treatment_episode',
      subjectId: 'ep-akron-1042',
      priority: 'high',
      dueAt: hours(8),
      ownerRole: 'utilization_review',
      backupRole: 'clinical_director',
      sourceFacts: [
        {
          label: 'Authorization end date',
          value: hours(48),
          sourceSystem: 'synthetic-fixture',
          sourceTimestamp: sourceStamp,
        },
        {
          label: 'Last covered day',
          value: hours(48),
          sourceSystem: 'synthetic-fixture',
          sourceTimestamp: sourceStamp,
        },
      ],
      sourceLinks: [{ label: 'Open episode in clinical system', href: '/deep-link/kipu/ep-akron-1042' }],
      standardRef: 'rule:ur.authorization.expires_72h',
      requiredAction: 'Complete the concurrent review and submit for continued-stay authorization.',
      createdBy: input.createdBy,
    }),
    service.create({
      type: 'facilities.room_turn',
      title: 'Room rm-akron-12 needs turnover before 15:00 arrival',
      explanation: 'A scheduled admission arrives today; the assigned room is not yet marked ready.',
      organizationId: input.organizationId,
      facilityId: input.akronFacilityId,
      subjectType: 'room',
      subjectId: 'rm-akron-12',
      priority: 'medium',
      dueAt: hours(3),
      ownerRole: 'facilities_environmental_services',
      backupRole: 'facility_administrator',
      sourceFacts: [
        {
          label: 'Scheduled arrival',
          value: hours(5),
          sourceSystem: 'synthetic-fixture',
          sourceTimestamp: sourceStamp,
        },
      ],
      requiredAction: 'Turn the room and mark it ready in the housekeeping log.',
      createdBy: input.createdBy,
    }),
    service.create({
      type: 'revenue.claim_rejected',
      title: 'Claim clm-cbus-88 rejected by clearinghouse',
      explanation:
        'The claim was rejected before payer adjudication; unresolved rejections risk timely-filing limits.',
      organizationId: input.organizationId,
      facilityId: input.columbusFacilityId,
      subjectType: 'claim',
      subjectId: 'clm-cbus-88',
      priority: 'high',
      dueAt: hours(-6),
      ownerRole: 'revenue_cycle',
      sourceFacts: [
        {
          label: 'Rejection received',
          value: 'clearinghouse rejection code A7 (synthetic)',
          sourceSystem: 'synthetic-fixture',
          sourceTimestamp: sourceStamp,
        },
      ],
      requiredAction: 'Correct the claim and resubmit, or route to the biller of record.',
      createdBy: input.createdBy,
    }),
  ];
}
