import type { BaselineRole } from '@armada/auth';
import type { ExcellenceContentService } from './service.js';
import type { ContentBody, ContentVersion } from './types.js';

/**
 * Starter Excellence content for development environments.
 *
 * These are working drafts of AES material aligned with blueprint Phase A
 * (Gold Standards, role cards, weekend AMA prevention, service recovery).
 * They are placeholders authored for development — the real cultural
 * constitution is owned by leadership and replaces this via the authoring
 * workflow. No PHI; no real people.
 */

export interface SeedActors {
  readonly authorId: string;
  readonly approverId: string;
  readonly approverRole: BaselineRole;
}

interface SeedEntry {
  readonly title: string;
  readonly body: ContentBody;
}

const GOLD_STANDARDS: readonly SeedEntry[] = [
  {
    title: 'Warm Welcome',
    body: {
      kind: 'gold_standard',
      statement:
        'Every patient and guest is greeted warmly by name where known, with eye contact and an introduction of who we are and how we will help.',
      whyItMatters:
        'Admission to withdrawal management or residential care is often the hardest day of a person’s life. The first minutes set the tone for trust, safety, and staying in treatment.',
      observableBehaviors: [
        'Stand and greet within 30 seconds of a patient or guest arriving.',
        'Introduce yourself by name and role.',
        'Explain the next step and how long it will take.',
        'Escort rather than point when giving directions.',
      ],
      unacceptableBehaviors: [
        'Continuing a personal conversation while someone waits.',
        'Referring to a patient by room number or diagnosis.',
      ],
      roleExamples: [
        {
          role: 'bht_recovery_support',
          example: 'Meet arrivals at the door, offer water and a seat, and stay until admissions takes over.',
        },
        {
          role: 'nurse',
          example: 'Open every assessment by explaining what will happen and asking what the patient needs right now.',
        },
      ],
      patientExperienceConnection:
        'First impressions drive patients’ sense of safety and their willingness to engage in care.',
      complianceConnection:
        'Supports patient-rights and dignity requirements in state certification and accreditation standards.',
      huddlePrompt: 'Tell about a time a first impression changed how someone engaged with care.',
      recognitionExamples: ['Recognize a teammate who turned a tense arrival into a calm admission.'],
    },
  },
  {
    title: 'Own the Concern',
    body: {
      kind: 'gold_standard',
      statement:
        'Whoever hears a concern owns it until it is resolved or has been handed off to a named person who accepted it.',
      whyItMatters:
        'Concerns that bounce between departments erode trust and become grievances. Ownership is the difference between service recovery and service failure.',
      observableBehaviors: [
        'Acknowledge the concern immediately and without defensiveness.',
        'Resolve within your authority, or walk the concern to the person who can.',
        'Close the loop with the person who raised it, every time.',
        'Document service recovery in the designated system, never in the chart as a clinical note.',
      ],
      unacceptableBehaviors: [
        '“That’s not my department.”',
        'Promising follow-up that is not tracked anywhere.',
      ],
      roleExamples: [
        {
          role: 'facility_administrator',
          example: 'Round daily on open service-recovery cases and remove barriers to closure.',
        },
      ],
      patientExperienceConnection: 'Owned concerns become loyalty; dropped concerns become AMA risk and grievances.',
      complianceConnection:
        'Feeds the grievance process required by certification rules without replacing it.',
      huddlePrompt: 'What concern did you own this week, and what did closing the loop look like?',
      recognitionExamples: ['Recognize cross-department ownership, especially off-shift.'],
    },
  },
  {
    title: 'Safe and Ready Weekend',
    body: {
      kind: 'gold_standard',
      statement:
        'Weekends run with the same structure, engagement, and vigilance as weekdays: full activity schedule, proactive rounding, and early identification of AMA risk.',
      whyItMatters:
        'Unstructured weekends are when discouragement peaks and against-medical-advice departures cluster. Structure and connection are clinical interventions.',
      observableBehaviors: [
        'Publish and run the full weekend activity schedule.',
        'Complete scheduled patient rounding with engagement questions, not just presence checks.',
        'Flag AMA risk signals (packing, phone conflict, visitor distress) to the charge nurse immediately.',
        'Huddle at shift start on who needs extra connection today.',
      ],
      unacceptableBehaviors: [
        'Substituting screen time for scheduled programming.',
        'Waiting for a patient to announce they are leaving before acting.',
      ],
      roleExamples: [
        {
          role: 'bht_recovery_support',
          example: 'Use rounding to start conversations; report mood shifts before they become departures.',
        },
        {
          role: 'nurse',
          example: 'Treat an AMA mention as an urgent clinical event: engage, notify the provider, offer comfort measures.',
        },
      ],
      patientExperienceConnection: 'Patients who feel seen on the hardest days stay for the breakthrough days.',
      complianceConnection: 'Supports required supervision levels and programming commitments.',
      huddlePrompt: 'Which patient needs extra connection this weekend, and who owns it?',
      recognitionExamples: ['Recognize saves: moments where engagement turned an AMA around.'],
    },
  },
];

const ROLE_CARDS: readonly SeedEntry[] = [
  {
    title: 'Role Card — Nurse',
    body: {
      kind: 'role_card',
      role: 'nurse',
      rolePurpose:
        'Deliver safe, dignified withdrawal-management and residential nursing care that keeps patients medically stable and emotionally supported.',
      patientPromise: 'You will be safe, comfortable as possible, and informed at every step.',
      topResponsibilities: [
        'Complete assessments and vital monitoring on schedule.',
        'Administer medications per orders in the clinical system of record.',
        'Escalate withdrawal-severity changes immediately.',
        'Lead calm, complete shift handoffs.',
      ],
      shiftStart: [
        'Receive handoff using the standard format; verify high-acuity patients first.',
        'Review assessments and medications due this shift.',
        'Check crash cart / emergency equipment sign-off where assigned.',
      ],
      duringShift: [
        'Round hourly with engagement, comfort, and safety checks.',
        'Document in the clinical system as care is delivered, not at shift end.',
        'Flag AMA risk and service concerns to the charge nurse in real time.',
      ],
      shiftEnd: [
        'Complete documentation before handoff.',
        'Hand off using the standard format, worst-first.',
        'Log any unresolved concerns with a named owner.',
      ],
      momentsOfTruth: [
        'First assessment after admission.',
        'A patient in acute withdrawal distress at 3 a.m.',
        'Telling a family member what happens next.',
      ],
      escalationTriggers: [
        'Withdrawal scores above protocol thresholds.',
        'Any patient statement about leaving against medical advice.',
        'Medication discrepancy of any kind.',
      ],
      documentationResponsibilities: [
        'All clinical documentation lives in the clinical system of record (Kipu) — never in AIP.',
      ],
      kpis: ['Assessment on-time rate', 'Documentation completion', 'Patient experience', 'AMA saves'],
      competencies: ['Withdrawal assessment protocols', 'De-escalation', 'Handoff standard work'],
      requiredPolicies: ['Service Recovery', 'Emergency response', 'Medication management'],
      goldStandardExamples: ['Warm Welcome', 'Safe and Ready Weekend'],
      careerPath: ['Nurse → Charge nurse → Nursing director track with competency milestones.'],
    },
  },
  {
    title: 'Role Card — BHT / Recovery Support',
    body: {
      kind: 'role_card',
      role: 'bht_recovery_support',
      rolePurpose:
        'Be the steady, present, encouraging backbone of the milieu: safety checks, structure, and genuine connection.',
      patientPromise: 'Someone who cares is always nearby and always checking on you.',
      topResponsibilities: [
        'Complete observation and safety checks on schedule, every time.',
        'Run scheduled groups, activities, and transports.',
        'Keep the milieu calm, clean, and structured.',
        'Report changes in mood, behavior, and AMA signals immediately.',
      ],
      shiftStart: [
        'Attend huddle; learn who needs extra connection today.',
        'Verify observation-check assignments and equipment.',
        'Walk the unit: rooms ready, hazards cleared.',
      ],
      duringShift: [
        'Observation checks with engagement, not just sight-lines.',
        'Escort arrivals and discharges warmly (Warm Welcome standard).',
        'Log observations in the designated system as they happen.',
      ],
      shiftEnd: [
        'Hand off open concerns to a named person.',
        'Reset shared spaces for the next shift.',
      ],
      momentsOfTruth: [
        'An anxious new arrival’s first hour.',
        'A patient pacing at the exit door.',
        'The 2 a.m. conversation nobody sees.',
      ],
      escalationTriggers: [
        'Missed or refused observation check.',
        'Any safety hazard or contraband concern.',
        'AMA statements or packing behavior.',
      ],
      documentationResponsibilities: [
        'Observation logs and shift notes in the designated system; clinical documentation stays in the clinical system of record.',
      ],
      kpis: ['Observation-check on-time rate', 'Activity schedule adherence', 'Patient experience'],
      competencies: ['Observation levels', 'De-escalation', 'Milieu management'],
      requiredPolicies: ['Service Recovery', 'Observation and rounding', 'Transport safety'],
      goldStandardExamples: ['Warm Welcome', 'Own the Concern', 'Safe and Ready Weekend'],
      careerPath: ['BHT → Lead BHT → clinical or nursing pathway with tuition support milestones.'],
    },
  },
];

const POLICIES: readonly SeedEntry[] = [
  {
    title: 'Service Recovery',
    body: {
      kind: 'policy',
      purpose:
        'Ensure every patient or family concern is acknowledged, owned, resolved, and turned into system improvement.',
      scope: 'All employees, all facilities, all shifts.',
      policyText:
        'Any employee who hears a concern owns it until resolved or accepted by a named owner. Service recovery follows the ten-step model: recognize, own, stabilize the immediate need, apologize appropriately without unsupported admissions, resolve within authority, escalate where required, confirm resolution, document, identify system improvement, and recognize employee ownership. Service recovery never replaces incident reporting, grievance handling, mandatory reporting, or clinical escalation.',
      procedureSteps: [
        'Acknowledge the concern immediately and thank the person for raising it.',
        'Stabilize any immediate comfort or safety need before anything else.',
        'Resolve within your authority; otherwise escalate to a named owner who accepts it.',
        'Confirm resolution with the person who raised the concern.',
        'Document the case in the service-recovery log the same day.',
        'Route safety, clinical, or rights issues to the required formal processes in parallel.',
      ],
      references: ['Blueprint §15.5', 'Grievance policy (pending)', 'Incident reporting policy (pending)'],
      reviewFrequencyMonths: 12,
      responsibleRole: 'quality_risk',
    },
  },
];

const CONSTITUTION: readonly SeedEntry[] = [
  {
    title: 'Credo',
    body: {
      kind: 'constitution_document',
      docType: 'credo',
      text: 'We exist so that people in the hardest season of their lives are met with excellence: safe care, genuine warmth, and a team that owns every detail of their experience. Compliance is our floor, never our ceiling. (Development placeholder — leadership owns the final credo.)',
    },
  },
  {
    title: 'Patient Promise',
    body: {
      kind: 'constitution_document',
      docType: 'patient_promise',
      text: 'You will be treated with dignity by name, kept safe, kept informed, and never handed off without a person who owns your care. (Development placeholder — leadership owns the final promise.)',
    },
  },
];

export function seedExcellenceContent(
  service: ExcellenceContentService,
  actors: SeedActors,
): readonly ContentVersion[] {
  const published: ContentVersion[] = [];
  for (const entry of [...GOLD_STANDARDS, ...ROLE_CARDS, ...POLICIES, ...CONSTITUTION]) {
    const draft = service.createDraft({
      title: entry.title,
      body: entry.body,
      authorId: actors.authorId,
    });
    service.submitForReview(draft.contentId, actors.authorId);
    service.approve(draft.contentId, {
      approverId: actors.approverId,
      approverRole: actors.approverRole,
      note: 'Development starter content',
    });
    published.push(service.publish(draft.contentId));
  }
  return published;
}
