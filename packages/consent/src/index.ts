import type { AuditLog } from '@armada/audit';

/**
 * Consent and disclosure decision service (blueprint §10, Epic 13).
 *
 * This is a policy enforcement service, not a checkbox field — and it is
 * deliberately a STUB in the legal sense: until qualified counsel/privacy
 * leadership approve the decision matrix and its test cases (§10.3), no
 * input combination can produce ALLOW for Part 2 data. Directives can be
 * recorded, revoked, and evaluated; covered requests yield REQUIRE_REVIEW,
 * everything else yields DENY. Approving the real matrix is a code+config
 * release under §3.2 decision rights (Privacy Officer / Counsel), captured
 * by constructing the service with `legalApprovedMatrixVersion`.
 */

export const DATA_CATEGORIES = [
  'operational',
  'demographics',
  'treatment_summary',
  'sud_treatment_records',
  'billing',
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** Categories governed by 42 CFR Part 2 handling. */
export const PART2_CATEGORIES: readonly DataCategory[] = ['sud_treatment_records'];

export const DISCLOSURE_PURPOSES = [
  'treatment',
  'payment',
  'operations',
  'audit',
  'patient_request',
] as const;
export type DisclosurePurpose = (typeof DISCLOSURE_PURPOSES)[number];

export interface ConsentDirective {
  readonly id: string;
  readonly personId: string;
  readonly categories: readonly DataCategory[];
  readonly purposes: readonly DisclosurePurpose[];
  /** Recipient systems/organizations the person consented to. */
  readonly recipients: readonly string[];
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly policyBasis: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

/** §10.1 required inputs. */
export interface ConsentDecisionInput {
  readonly personId: string;
  readonly treatmentEpisodeId?: string;
  readonly dataCategory: DataCategory;
  readonly sourceSystem: string;
  readonly destination: string;
  readonly purpose: DisclosurePurpose;
  readonly requestorId: string;
  readonly facilityId?: string;
}

/** §10.2 required output shape. */
export interface ConsentDecision {
  readonly decision: 'ALLOW' | 'DENY' | 'REQUIRE_REVIEW';
  readonly reason_codes: readonly string[];
  readonly policy_version: string;
  readonly consent_directive_id: string | null;
  readonly evaluated_at: string;
  readonly minimum_necessary_fields: readonly string[];
  readonly obligations: readonly string[];
}

export const CONSENT_POLICY_VERSION = 'consent-policy/0.1.0-pending-legal-approval';

export interface ConsentServiceOptions {
  readonly audit: AuditLog;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Set ONLY via a release approved by Privacy Officer / Counsel (§3.2).
   * Absent (the default), no Part 2 request can produce ALLOW. */
  readonly legalApprovedMatrixVersion?: string;
}

/** Minimum-necessary field sets per category — placeholders pending the
 * approved matrix; used only for REQUIRE_REVIEW context today. */
const MINIMUM_NECESSARY: Record<DataCategory, readonly string[]> = {
  operational: ['facilityId', 'counts'],
  demographics: ['name', 'dateOfBirth', 'contact'],
  treatment_summary: ['episodeId', 'levelOfCare', 'admissionDate'],
  sud_treatment_records: [],
  billing: ['claimId', 'payer', 'balance'],
};

export class ConsentDecisionService {
  readonly #directives = new Map<string, ConsentDirective>();
  readonly #audit: AuditLog;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #matrixVersion: string | undefined;

  constructor(options: ConsentServiceOptions) {
    this.#audit = options.audit;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#matrixVersion = options.legalApprovedMatrixVersion;
  }

  recordDirective(
    input: Omit<ConsentDirective, 'id' | 'recordedAt' | 'revokedAt'>,
  ): ConsentDirective {
    if (input.categories.length === 0 || input.purposes.length === 0 || input.recipients.length === 0) {
      throw new Error('Directive requires categories, purposes, and recipients');
    }
    for (const category of input.categories) {
      if (!DATA_CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
    }
    if (Number.isNaN(Date.parse(input.effectiveAt))) {
      throw new Error('effectiveAt must be a valid timestamp');
    }
    if (input.expiresAt !== undefined && Number.isNaN(Date.parse(input.expiresAt))) {
      throw new Error('expiresAt must be a valid timestamp');
    }
    if (input.policyBasis.trim() === '') throw new Error('policyBasis is required');
    const directive: ConsentDirective = Object.freeze({
      ...input,
      id: this.#newId(),
      recordedAt: this.#now().toISOString(),
    });
    this.#directives.set(directive.id, directive);
    this.#audit.append({
      actorType: 'user',
      actorId: input.recordedBy,
      action: 'consent.directive_recorded',
      subjectType: 'consent_directive',
      subjectId: directive.id,
      summary: `categories=${input.categories.join(',')} purposes=${input.purposes.join(',')}`,
    });
    return directive;
  }

  /** Revocation affects future exchanges; history and audit are retained (§10.3). */
  revokeDirective(directiveId: string, revokedBy: string): ConsentDirective {
    const directive = this.#directives.get(directiveId);
    if (directive === undefined) throw new Error(`Unknown directive: ${directiveId}`);
    if (directive.revokedAt !== undefined) throw new Error('Directive is already revoked');
    const revoked: ConsentDirective = Object.freeze({
      ...directive,
      revokedAt: this.#now().toISOString(),
    });
    this.#directives.set(directiveId, revoked);
    this.#audit.append({
      actorType: 'user',
      actorId: revokedBy,
      action: 'consent.directive_revoked',
      subjectType: 'consent_directive',
      subjectId: directiveId,
    });
    return revoked;
  }

  directivesFor(personId: string): readonly ConsentDirective[] {
    return [...this.#directives.values()].filter((d) => d.personId === personId);
  }

  /** §10 evaluation. Every decision is audited without payload data. */
  evaluate(input: ConsentDecisionInput): ConsentDecision {
    const now = this.#now();
    const decide = (
      decision: ConsentDecision['decision'],
      reasonCodes: readonly string[],
      directiveId: string | null = null,
      obligations: readonly string[] = [],
      minimumNecessary: readonly string[] = [],
    ): ConsentDecision => {
      const result: ConsentDecision = Object.freeze({
        decision,
        reason_codes: reasonCodes,
        policy_version: this.#matrixVersion ?? CONSENT_POLICY_VERSION,
        consent_directive_id: directiveId,
        evaluated_at: now.toISOString(),
        minimum_necessary_fields: minimumNecessary,
        obligations,
      });
      this.#audit.append({
        actorType: 'user',
        actorId: input.requestorId,
        action: 'consent.decision_evaluated',
        subjectType: 'person',
        subjectId: input.personId,
        purpose: input.purpose,
        policyDecision: `${decision}:${reasonCodes.join(',')}`,
        summary: `category=${input.dataCategory} destination=${input.destination}`,
        ...(input.facilityId !== undefined ? { facilityId: input.facilityId } : {}),
      });
      return result;
    };

    if (!DATA_CATEGORIES.includes(input.dataCategory)) {
      // Default deny for unclassified data flows (§10.3).
      return decide('DENY', ['UNCLASSIFIED_DATA_CATEGORY']);
    }
    if (!PART2_CATEGORIES.includes(input.dataCategory)) {
      // Non-Part-2 categories are governed by the RBAC engine, not consent.
      return decide('ALLOW', ['NOT_PART2_GOVERNED'], null, [], MINIMUM_NECESSARY[input.dataCategory]);
    }

    // Part 2 flow: find a covering, currently-valid directive.
    const candidates = this.directivesFor(input.personId).filter(
      (d) =>
        d.categories.includes(input.dataCategory) &&
        d.purposes.includes(input.purpose) &&
        d.recipients.includes(input.destination),
    );
    if (candidates.length === 0) {
      return decide('DENY', ['PART2_NO_CONSENT_DIRECTIVE']);
    }
    const valid = candidates.filter((d) => {
      if (Date.parse(d.effectiveAt) > now.getTime()) return false;
      if (d.revokedAt !== undefined && Date.parse(d.revokedAt) <= now.getTime()) return false;
      if (d.expiresAt !== undefined && Date.parse(d.expiresAt) <= now.getTime()) return false;
      return true;
    });
    if (valid.length === 0) {
      const revoked = candidates.some((d) => d.revokedAt !== undefined);
      return decide('DENY', [revoked ? 'PART2_CONSENT_REVOKED' : 'PART2_CONSENT_EXPIRED']);
    }
    const directive = valid[0]!;
    if (this.#matrixVersion === undefined) {
      // A covering directive exists, but the legal decision matrix is not
      // yet approved: a human privacy review is required for every exchange.
      return decide(
        'REQUIRE_REVIEW',
        ['PART2_LEGAL_MATRIX_PENDING'],
        directive.id,
        ['PRIVACY_OFFICER_REVIEW_REQUIRED', 'NO_REDISCLOSURE_NOTICE_REQUIRED'],
      );
    }
    return decide(
      'ALLOW',
      ['PART2_CONSENT_DIRECTIVE_COVERS'],
      directive.id,
      ['NO_REDISCLOSURE_NOTICE_REQUIRED'],
      MINIMUM_NECESSARY[input.dataCategory],
    );
  }
}
