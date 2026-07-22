import type { AuditLog } from '@armada/audit';
import { isBaselineRole } from '@armada/auth';
import {
  DIRECTIONALITIES,
  METRIC_APPROVER_ROLES,
  METRIC_UNITS,
  SEGMENTATIONS,
  type CalculationResult,
  type EntryStatus,
  type MetricCalculator,
  type MetricDefinition,
  type MetricObservation,
  type MetricScope,
  type ScorecardDefinition,
  type ScorecardEntry,
  type ScorecardView,
} from './types.js';

/**
 * Metric registry, calculation service, and scorecards (blueprint §19).
 *
 * Rules enforced here:
 *  - definitions must be complete (business question, owner, formula,
 *    numerator, sources, refresh, latency) before they can even be drafts;
 *  - only approver roles activate a metric, and the approver must differ
 *    from the definer;
 *  - observations exist only for active metrics, within their declared
 *    segmentation, and always with provenance;
 *  - a missing source produces no_data — never a stale or invented value.
 */

const ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface MetricsServiceOptions {
  readonly audit: AuditLog;
  readonly now?: () => Date;
}

export interface DefineMetricInput
  extends Omit<MetricDefinition, 'version' | 'status' | 'createdAt' | 'approval'> {}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`${field} must not be empty`);
}

export function entryStatus(
  definition: MetricDefinition,
  value: number | undefined,
): EntryStatus {
  if (value === undefined) return 'no_data';
  const { target, warningThreshold, directionality } = definition;
  if (target === undefined) return 'informational';
  if (directionality === 'higher_is_better') {
    if (value >= target) return 'on_target';
    if (warningThreshold !== undefined && value >= warningThreshold) return 'warning';
    return 'off_target';
  }
  if (value <= target) return 'on_target';
  if (warningThreshold !== undefined && value <= warningThreshold) return 'warning';
  return 'off_target';
}

export class MetricsService {
  readonly #definitions = new Map<string, MetricDefinition>();
  readonly #calculators = new Map<string, MetricCalculator>();
  readonly #observations = new Map<string, MetricObservation[]>();
  readonly #scorecards = new Map<string, ScorecardDefinition>();
  readonly #audit: AuditLog;
  readonly #now: () => Date;

  constructor(options: MetricsServiceOptions) {
    this.#audit = options.audit;
    this.#now = options.now ?? (() => new Date());
  }

  define(input: DefineMetricInput): MetricDefinition {
    if (!ID_PATTERN.test(input.id)) {
      throw new Error(`Metric id must be dotted lowercase (got "${input.id}")`);
    }
    if (this.#definitions.has(input.id)) {
      throw new Error(`Metric already defined: ${input.id}`);
    }
    requireNonEmpty(input.name, 'name');
    requireNonEmpty(input.businessQuestion, 'businessQuestion');
    requireNonEmpty(input.formula, 'formula');
    requireNonEmpty(input.numeratorDescription, 'numeratorDescription');
    requireNonEmpty(input.refreshSchedule, 'refreshSchedule');
    requireNonEmpty(input.expectedLatency, 'expectedLatency');
    if (!isBaselineRole(input.ownerRole)) throw new Error(`Unknown owner role: ${input.ownerRole}`);
    if (!METRIC_UNITS.includes(input.unit)) throw new Error(`Unknown unit: ${String(input.unit)}`);
    if (!DIRECTIONALITIES.includes(input.directionality)) {
      throw new Error(`Unknown directionality: ${String(input.directionality)}`);
    }
    if (input.sourceSystems.length === 0) {
      throw new Error('At least one source system is required');
    }
    if (input.segmentation.length === 0 || input.segmentation.some((s) => !SEGMENTATIONS.includes(s))) {
      throw new Error('segmentation must be a non-empty subset of organization/facility');
    }
    const definition: MetricDefinition = Object.freeze({
      ...input,
      version: 1,
      status: 'draft' as const,
      createdAt: this.#now().toISOString(),
    });
    this.#definitions.set(definition.id, definition);
    this.#audit.append({
      actorType: 'user',
      actorId: input.createdBy,
      action: 'metric.defined',
      subjectType: 'metric_definition',
      subjectId: definition.id,
      summary: `owner_role=${definition.ownerRole} unit=${definition.unit}`,
    });
    return definition;
  }

  approve(
    metricId: string,
    input: { approvedBy: string; approverRole: MetricDefinition['ownerRole'] },
  ): MetricDefinition {
    const definition = this.#require(metricId);
    if (definition.status !== 'draft') {
      throw new Error(`Only draft metrics can be approved (status: ${definition.status})`);
    }
    if (!METRIC_APPROVER_ROLES.includes(input.approverRole)) {
      throw new Error(`Role ${input.approverRole} is not a metric approver role`);
    }
    if (input.approvedBy === definition.createdBy) {
      throw new Error('Metric approver must differ from the definer (separation of duties)');
    }
    const approved: MetricDefinition = Object.freeze({
      ...definition,
      status: 'active' as const,
      approval: {
        approvedBy: input.approvedBy,
        approverRole: input.approverRole,
        approvedAt: this.#now().toISOString(),
      },
    });
    this.#definitions.set(metricId, approved);
    this.#audit.append({
      actorType: 'user',
      actorId: input.approvedBy,
      action: 'metric.approved',
      subjectType: 'metric_definition',
      subjectId: metricId,
      summary: `approver_role=${input.approverRole} version=${approved.version}`,
    });
    return approved;
  }

  retire(metricId: string, retiredBy: string): MetricDefinition {
    const definition = this.#require(metricId);
    const retired: MetricDefinition = Object.freeze({ ...definition, status: 'retired' as const });
    this.#definitions.set(metricId, retired);
    this.#audit.append({
      actorType: 'user',
      actorId: retiredBy,
      action: 'metric.retired',
      subjectType: 'metric_definition',
      subjectId: metricId,
    });
    return retired;
  }

  definitions(status?: MetricDefinition['status']): readonly MetricDefinition[] {
    return [...this.#definitions.values()]
      .filter((d) => status === undefined || d.status === status)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getDefinition(metricId: string): MetricDefinition | undefined {
    return this.#definitions.get(metricId);
  }

  registerCalculator(metricId: string, calculator: MetricCalculator): void {
    this.#require(metricId);
    if (this.#calculators.has(metricId)) {
      throw new Error(`Calculator already registered for ${metricId}`);
    }
    this.#calculators.set(metricId, calculator);
  }

  /** Compute and record an observation. Returns null when the source is
   * unavailable (graceful degradation — CLAUDE.md #15). */
  compute(metricId: string, scope: MetricScope): MetricObservation | null {
    const definition = this.#require(metricId);
    if (definition.status !== 'active') {
      throw new Error(`Metric ${metricId} is not active`);
    }
    const segment: 'facility' | 'organization' =
      scope.facilityId !== undefined ? 'facility' : 'organization';
    if (!definition.segmentation.includes(segment)) {
      throw new Error(`Metric ${metricId} does not support ${segment} segmentation`);
    }
    const calculator = this.#calculators.get(metricId);
    if (calculator === undefined) {
      throw new Error(`No calculator registered for ${metricId}`);
    }
    let result: CalculationResult | undefined;
    try {
      result = calculator(scope);
    } catch {
      result = undefined; // A failing source must not take the scorecard down.
    }
    if (result === undefined) return null;
    if (result.provenance.length === 0) {
      throw new Error(`Observation for ${metricId} requires provenance`);
    }
    for (const p of result.provenance) {
      if (Number.isNaN(Date.parse(p.asOf))) {
        throw new Error(`Provenance for ${metricId} has an invalid asOf timestamp`);
      }
    }
    const observation: MetricObservation = Object.freeze({
      metricId,
      metricVersion: definition.version,
      scope,
      value: result.value,
      asOf: result.asOf,
      computedAt: this.#now().toISOString(),
      provenance: Object.freeze([...result.provenance]),
      ...(result.numerator !== undefined ? { numerator: result.numerator } : {}),
      ...(result.denominator !== undefined ? { denominator: result.denominator } : {}),
    });
    const key = this.#scopeKey(metricId, scope);
    const history = this.#observations.get(key) ?? [];
    history.push(observation);
    this.#observations.set(key, history);
    return observation;
  }

  latest(metricId: string, scope: MetricScope): MetricObservation | undefined {
    return this.#observations.get(this.#scopeKey(metricId, scope))?.at(-1);
  }

  previous(metricId: string, scope: MetricScope): MetricObservation | undefined {
    return this.#observations.get(this.#scopeKey(metricId, scope))?.at(-2);
  }

  defineScorecard(definition: ScorecardDefinition): ScorecardDefinition {
    if (this.#scorecards.has(definition.id)) {
      throw new Error(`Scorecard already defined: ${definition.id}`);
    }
    for (const section of definition.sections) {
      for (const metricId of section.metricIds) {
        this.#require(metricId);
      }
    }
    const frozen = Object.freeze(definition);
    this.#scorecards.set(definition.id, frozen);
    return frozen;
  }

  scorecards(): readonly ScorecardDefinition[] {
    return [...this.#scorecards.values()];
  }

  getScorecard(id: string): ScorecardDefinition | undefined {
    return this.#scorecards.get(id);
  }

  /** Compute all scorecard metrics fresh and assemble the view. */
  scorecardView(id: string, scope: MetricScope): ScorecardView {
    const scorecard = this.#scorecards.get(id);
    if (scorecard === undefined) throw new Error(`Unknown scorecard: ${id}`);
    const sections = scorecard.sections.map((section) => ({
      title: section.title,
      entries: section.metricIds.map((metricId) => this.#entry(metricId, scope)),
    }));
    return {
      scorecard,
      scope,
      generatedAt: this.#now().toISOString(),
      sections,
    };
  }

  #entry(metricId: string, scope: MetricScope): ScorecardEntry {
    const definition = this.#require(metricId);
    const segment: 'facility' | 'organization' =
      scope.facilityId !== undefined ? 'facility' : 'organization';
    const effectiveScope: MetricScope = definition.segmentation.includes(segment)
      ? scope
      : { organizationId: scope.organizationId };
    const observation =
      definition.status === 'active' && this.#calculators.has(metricId)
        ? this.compute(metricId, effectiveScope)
        : null;
    const previous = this.previous(metricId, effectiveScope);
    return {
      metricId,
      name: definition.name,
      unit: definition.unit,
      status: entryStatus(definition, observation?.value),
      observation,
      previousValue: previous?.value ?? null,
      definition: {
        businessQuestion: definition.businessQuestion,
        formula: definition.formula,
        numeratorDescription: definition.numeratorDescription,
        ownerRole: definition.ownerRole,
        sourceSystems: definition.sourceSystems,
        refreshSchedule: definition.refreshSchedule,
        expectedLatency: definition.expectedLatency,
        directionality: definition.directionality,
        version: definition.version,
        ...(definition.denominatorDescription !== undefined
          ? { denominatorDescription: definition.denominatorDescription }
          : {}),
        ...(definition.target !== undefined ? { target: definition.target } : {}),
        ...(definition.warningThreshold !== undefined
          ? { warningThreshold: definition.warningThreshold }
          : {}),
      },
    };
  }

  #scopeKey(metricId: string, scope: MetricScope): string {
    return `${metricId}@${scope.organizationId}:${scope.facilityId ?? 'org'}`;
  }

  #require(metricId: string): MetricDefinition {
    const definition = this.#definitions.get(metricId);
    if (definition === undefined) throw new Error(`Unknown metric: ${metricId}`);
    return definition;
  }
}
