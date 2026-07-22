import type { AuditLog } from '@armada/audit';
import { isBaselineRole, type BaselineRole } from '@armada/auth';

/**
 * Compliance readiness (blueprint §16, Epic 14).
 *
 * Requirements are versioned structured records — citations, mappings, and
 * interpretations, never copies of copyrighted standards text beyond the
 * organization's license. Evidence links operational artifacts (audit
 * events, work items, documents) to requirements so daily work naturally
 * produces survey evidence (§2.10). Nothing here claims compliance
 * (CLAUDE.md #16): it produces controls and evidence for qualified review.
 */

export const AUTHORITIES = [
  'OhioMHAS',
  'JointCommission',
  'HIPAA',
  'Part2',
  'OSHA',
  'CMS',
  'DEA',
  'OhioBoards',
] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const RISK_RATINGS = ['low', 'medium', 'high'] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];

export interface ComplianceRequirement {
  readonly id: string;
  readonly authority: Authority;
  /** Citation/reference only, e.g. "OAC 5122-29-09(B)". */
  readonly citation: string;
  readonly effectiveDate?: string;
  readonly applicability: string;
  readonly summary: string;
  /** Pointer to licensed source text, never the text itself. */
  readonly sourceTextLocation?: string;
  readonly responsibleDepartment: string;
  readonly responsibleRole: BaselineRole;
  readonly policyRefs: readonly string[];
  readonly procedureRefs: readonly string[];
  readonly evidenceExamples: readonly string[];
  readonly auditMethod: string;
  readonly reviewFrequencyMonths: number;
  readonly riskRating: RiskRating;
  readonly lastReviewedAt?: string;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

export const EVIDENCE_TYPES = ['document', 'audit_event', 'work_item', 'attestation'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface EvidenceItem {
  readonly id: string;
  readonly requirementId: string;
  readonly type: EvidenceType;
  /** Internal reference (audit event id, work item id, document path). */
  readonly reference: string;
  readonly description: string;
  readonly collectedBy: string;
  readonly collectedAt: string;
}

export type CorrectiveActionStatus = 'open' | 'in_progress' | 'closed';

export interface CorrectiveAction {
  readonly id: string;
  readonly requirementId?: string;
  readonly findingSummary: string;
  readonly ownerRole: BaselineRole;
  readonly dueDate: string;
  readonly status: CorrectiveActionStatus;
  readonly openedBy: string;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly closedBy?: string;
  readonly closureNote?: string;
}

export interface AuditCalendarEntry {
  readonly id: string;
  readonly name: string;
  readonly authority: Authority;
  readonly scheduledFor: string;
  readonly requirementIds: readonly string[];
  readonly status: 'planned' | 'in_progress' | 'complete';
}

export interface ReadinessSummary {
  readonly generatedAt: string;
  readonly byAuthority: readonly {
    readonly authority: Authority;
    readonly requirements: number;
    readonly withEvidence: number;
    readonly reviewsOverdue: number;
    readonly highRiskWithoutEvidence: number;
  }[];
  readonly correctiveActions: {
    readonly open: number;
    readonly overdue: number;
    readonly closed: number;
  };
  readonly upcomingAudits: readonly AuditCalendarEntry[];
}

export interface ComplianceServiceOptions {
  readonly audit: AuditLog;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`${field} must not be empty`);
}

export class ComplianceService {
  readonly #requirements = new Map<string, ComplianceRequirement>();
  readonly #evidence = new Map<string, EvidenceItem[]>();
  readonly #actions = new Map<string, CorrectiveAction>();
  readonly #calendar = new Map<string, AuditCalendarEntry>();
  readonly #audit: AuditLog;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: ComplianceServiceOptions) {
    this.#audit = options.audit;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  addRequirement(
    input: Omit<ComplianceRequirement, 'id' | 'version' | 'createdAt'>,
  ): ComplianceRequirement {
    if (!AUTHORITIES.includes(input.authority)) {
      throw new Error(`Unknown authority: ${String(input.authority)}`);
    }
    requireNonEmpty(input.citation, 'citation');
    requireNonEmpty(input.applicability, 'applicability');
    requireNonEmpty(input.summary, 'summary');
    requireNonEmpty(input.auditMethod, 'auditMethod');
    requireNonEmpty(input.responsibleDepartment, 'responsibleDepartment');
    if (!isBaselineRole(input.responsibleRole)) {
      throw new Error(`Unknown responsible role: ${String(input.responsibleRole)}`);
    }
    if (!RISK_RATINGS.includes(input.riskRating)) {
      throw new Error(`Unknown risk rating: ${String(input.riskRating)}`);
    }
    if (input.reviewFrequencyMonths < 1 || input.reviewFrequencyMonths > 36) {
      throw new Error('reviewFrequencyMonths must be 1..36');
    }
    const requirement: ComplianceRequirement = Object.freeze({
      ...input,
      id: this.#newId(),
      version: 1,
      createdAt: this.#now().toISOString(),
    });
    this.#requirements.set(requirement.id, requirement);
    this.#audit.append({
      actorType: 'user',
      actorId: input.createdBy,
      action: 'compliance.requirement_added',
      subjectType: 'compliance_requirement',
      subjectId: requirement.id,
      summary: `authority=${input.authority} citation=${input.citation} risk=${input.riskRating}`,
    });
    return requirement;
  }

  requirements(filter: { authority?: Authority; responsibleRole?: BaselineRole } = {}): readonly ComplianceRequirement[] {
    return [...this.#requirements.values()]
      .filter(
        (r) =>
          (filter.authority === undefined || r.authority === filter.authority) &&
          (filter.responsibleRole === undefined || r.responsibleRole === filter.responsibleRole),
      )
      .sort((a, b) => a.citation.localeCompare(b.citation));
  }

  recordEvidence(input: Omit<EvidenceItem, 'id' | 'collectedAt'>): EvidenceItem {
    if (!this.#requirements.has(input.requirementId)) {
      throw new Error(`Unknown requirement: ${input.requirementId}`);
    }
    if (!EVIDENCE_TYPES.includes(input.type)) {
      throw new Error(`Unknown evidence type: ${String(input.type)}`);
    }
    requireNonEmpty(input.reference, 'reference');
    requireNonEmpty(input.description, 'description');
    const item: EvidenceItem = Object.freeze({
      ...input,
      id: this.#newId(),
      collectedAt: this.#now().toISOString(),
    });
    const list = this.#evidence.get(input.requirementId) ?? [];
    list.push(item);
    this.#evidence.set(input.requirementId, list);
    this.#audit.append({
      actorType: 'user',
      actorId: input.collectedBy,
      action: 'compliance.evidence_recorded',
      subjectType: 'compliance_requirement',
      subjectId: input.requirementId,
      summary: `type=${input.type} reference=${input.reference}`,
    });
    return item;
  }

  evidenceFor(requirementId: string): readonly EvidenceItem[] {
    return [...(this.#evidence.get(requirementId) ?? [])];
  }

  openCorrectiveAction(
    input: Omit<CorrectiveAction, 'id' | 'status' | 'openedAt' | 'closedAt' | 'closedBy' | 'closureNote'>,
  ): CorrectiveAction {
    requireNonEmpty(input.findingSummary, 'findingSummary');
    if (!isBaselineRole(input.ownerRole)) {
      throw new Error(`Unknown owner role: ${String(input.ownerRole)}`);
    }
    if (Number.isNaN(Date.parse(input.dueDate))) {
      throw new Error('dueDate must be a valid date');
    }
    if (input.requirementId !== undefined && !this.#requirements.has(input.requirementId)) {
      throw new Error(`Unknown requirement: ${input.requirementId}`);
    }
    const action: CorrectiveAction = Object.freeze({
      ...input,
      id: this.#newId(),
      status: 'open' as const,
      openedAt: this.#now().toISOString(),
    });
    this.#actions.set(action.id, action);
    this.#audit.append({
      actorType: 'user',
      actorId: input.openedBy,
      action: 'compliance.corrective_action_opened',
      subjectType: 'corrective_action',
      subjectId: action.id,
      summary: `owner_role=${input.ownerRole} due=${input.dueDate}`,
    });
    return action;
  }

  closeCorrectiveAction(
    actionId: string,
    input: { closedBy: string; closureNote: string },
  ): CorrectiveAction {
    const action = this.#actions.get(actionId);
    if (action === undefined) throw new Error(`Unknown corrective action: ${actionId}`);
    if (action.status === 'closed') throw new Error('Corrective action is already closed');
    if (input.closureNote.trim().length < 10) {
      throw new Error('Closure requires an explanatory note (>= 10 chars)');
    }
    const closed: CorrectiveAction = Object.freeze({
      ...action,
      status: 'closed' as const,
      closedAt: this.#now().toISOString(),
      closedBy: input.closedBy,
      closureNote: input.closureNote.trim(),
    });
    this.#actions.set(actionId, closed);
    this.#audit.append({
      actorType: 'user',
      actorId: input.closedBy,
      action: 'compliance.corrective_action_closed',
      subjectType: 'corrective_action',
      subjectId: actionId,
    });
    return closed;
  }

  correctiveActions(filter: { status?: CorrectiveActionStatus } = {}): readonly CorrectiveAction[] {
    return [...this.#actions.values()].filter(
      (a) => filter.status === undefined || a.status === filter.status,
    );
  }

  scheduleAudit(input: Omit<AuditCalendarEntry, 'id' | 'status'>): AuditCalendarEntry {
    requireNonEmpty(input.name, 'name');
    if (Number.isNaN(Date.parse(input.scheduledFor))) {
      throw new Error('scheduledFor must be a valid date');
    }
    const entry: AuditCalendarEntry = Object.freeze({
      ...input,
      id: this.#newId(),
      status: 'planned' as const,
    });
    this.#calendar.set(entry.id, entry);
    return entry;
  }

  auditCalendar(): readonly AuditCalendarEntry[] {
    return [...this.#calendar.values()].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  /** Tracer-readiness rollup for the quality/compliance workspace. */
  readinessSummary(): ReadinessSummary {
    const now = this.#now();
    const byAuthority = AUTHORITIES.map((authority) => {
      const requirements = this.requirements({ authority });
      if (requirements.length === 0) return undefined;
      let withEvidence = 0;
      let reviewsOverdue = 0;
      let highRiskWithoutEvidence = 0;
      for (const requirement of requirements) {
        const evidence = this.evidenceFor(requirement.id);
        if (evidence.length > 0) withEvidence += 1;
        else if (requirement.riskRating === 'high') highRiskWithoutEvidence += 1;
        const baseline = requirement.lastReviewedAt ?? requirement.createdAt;
        const dueBy = new Date(baseline);
        dueBy.setMonth(dueBy.getMonth() + requirement.reviewFrequencyMonths);
        if (dueBy.getTime() < now.getTime()) reviewsOverdue += 1;
      }
      return {
        authority,
        requirements: requirements.length,
        withEvidence,
        reviewsOverdue,
        highRiskWithoutEvidence,
      };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

    const actions = [...this.#actions.values()];
    const overdue = actions.filter(
      (a) => a.status !== 'closed' && Date.parse(a.dueDate) < now.getTime(),
    ).length;
    return {
      generatedAt: now.toISOString(),
      byAuthority,
      correctiveActions: {
        open: actions.filter((a) => a.status !== 'closed').length,
        overdue,
        closed: actions.filter((a) => a.status === 'closed').length,
      },
      upcomingAudits: this.auditCalendar().filter((e) => e.status !== 'complete'),
    };
  }
}

/** Development seed: citation-only starter requirements (no licensed text). */
export function seedComplianceRequirements(
  service: ComplianceService,
  createdBy: string,
): readonly ComplianceRequirement[] {
  const base = {
    createdBy,
    policyRefs: [] as readonly string[],
    procedureRefs: [] as readonly string[],
  };
  return [
    service.addRequirement({
      ...base,
      authority: 'OhioMHAS',
      citation: 'OAC 5122-29-09',
      applicability: 'Residential and withdrawal-management SUD services (3.2-WM, 3.5, 3.7, 3.7-WM)',
      summary:
        'Service structure requirements for residential/withdrawal-management SUD services referencing ASAM level 3 / 3-WM.',
      sourceTextLocation: 'docs/compliance/sources.md (register entry; retrieve current text)',
      responsibleDepartment: 'Clinical',
      responsibleRole: 'clinical_director',
      evidenceExamples: ['Program schedules', 'Staffing plans', 'Service documentation samples'],
      auditMethod: 'Quarterly internal tracer against current rule text',
      reviewFrequencyMonths: 6,
      riskRating: 'high',
    }),
    service.addRequirement({
      ...base,
      authority: 'HIPAA',
      citation: '45 CFR 164.312(b)',
      applicability: 'All electronic PHI systems',
      summary: 'Audit controls: mechanisms to record and examine activity in systems containing ePHI.',
      responsibleDepartment: 'Technology',
      responsibleRole: 'system_administrator',
      evidenceExamples: ['Append-only audit log integrity checks', 'Access review reports'],
      auditMethod: 'Verify audit-log integrity and review cadence evidence',
      reviewFrequencyMonths: 12,
      riskRating: 'high',
    }),
    service.addRequirement({
      ...base,
      authority: 'Part2',
      citation: '42 CFR Part 2 §2.13',
      applicability: 'All SUD treatment records and disclosures',
      summary: 'Disclosures require written consent with limited exceptions; prohibition on redisclosure.',
      responsibleDepartment: 'Privacy',
      responsibleRole: 'privacy_administrator',
      evidenceExamples: ['Consent decision audit trail', 'Default-deny test evidence'],
      auditMethod: 'Review consent decision service outcomes and test evidence',
      reviewFrequencyMonths: 6,
      riskRating: 'high',
    }),
    service.addRequirement({
      ...base,
      authority: 'JointCommission',
      citation: 'BHC accreditation manual (licensed) — care coordination chapter',
      applicability: 'All programs seeking/holding accreditation',
      summary:
        'Care coordination and handoff standards; store mappings and evidence, not the copyrighted standard text.',
      sourceTextLocation: 'Licensed manual (compliance office)',
      responsibleDepartment: 'Quality',
      responsibleRole: 'quality_risk',
      evidenceExamples: ['Handoff standard work', 'Tracer results', 'Lineup records'],
      auditMethod: 'Mock tracer twice yearly',
      reviewFrequencyMonths: 12,
      riskRating: 'medium',
    }),
  ];
}
