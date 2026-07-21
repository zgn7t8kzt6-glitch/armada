import type { BaselineRole } from '@armada/auth';

/**
 * Metric registry types (blueprint §19). A metric may never be displayed
 * without its definition and provenance — so the definition carries every
 * §19 field, and observations refuse to exist without at least one
 * provenance source with a timestamp.
 */

export const METRIC_UNITS = ['percent', 'count', 'days', 'hours', 'currency_cents'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const DIRECTIONALITIES = ['higher_is_better', 'lower_is_better'] as const;
export type Directionality = (typeof DIRECTIONALITIES)[number];

export const METRIC_STATUSES = ['draft', 'active', 'retired'] as const;
export type MetricStatus = (typeof METRIC_STATUSES)[number];

export const SEGMENTATIONS = ['organization', 'facility'] as const;
export type Segmentation = (typeof SEGMENTATIONS)[number];

/** Roles that may approve metric definitions for active use. */
export const METRIC_APPROVER_ROLES: readonly BaselineRole[] = [
  'executive',
  'quality_risk',
  'compliance_administrator',
];

export interface MetricApproval {
  readonly approvedBy: string;
  readonly approverRole: BaselineRole;
  readonly approvedAt: string;
}

export interface MetricDefinition {
  /** Dotted id, e.g. `census.occupancy_rate`. */
  readonly id: string;
  readonly name: string;
  readonly businessQuestion: string;
  readonly ownerRole: BaselineRole;
  /** Human-readable formula, e.g. "occupied beds ÷ available beds × 100". */
  readonly formula: string;
  readonly numeratorDescription: string;
  readonly denominatorDescription?: string;
  readonly inclusionCriteria: readonly string[];
  readonly exclusionCriteria: readonly string[];
  readonly sourceSystems: readonly string[];
  readonly refreshSchedule: string;
  readonly expectedLatency: string;
  readonly unit: MetricUnit;
  readonly directionality: Directionality;
  readonly target?: number;
  readonly warningThreshold?: number;
  readonly segmentation: readonly Segmentation[];
  readonly version: number;
  readonly status: MetricStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly approval?: MetricApproval;
}

export interface MetricScope {
  readonly organizationId: string;
  readonly facilityId?: string;
}

/** Where an observation's inputs came from (§2.7 source traceability). */
export interface ObservationProvenance {
  readonly sourceSystem: string;
  readonly detail: string;
  readonly asOf: string;
  readonly recordCount?: number;
}

export interface MetricObservation {
  readonly metricId: string;
  readonly metricVersion: number;
  readonly scope: MetricScope;
  readonly value: number;
  readonly numerator?: number;
  readonly denominator?: number;
  readonly asOf: string;
  readonly computedAt: string;
  readonly provenance: readonly ObservationProvenance[];
}

/** Result a calculator returns; undefined means the source is unavailable —
 * the scorecard shows no_data instead of a stale or invented number. */
export interface CalculationResult {
  readonly value: number;
  readonly numerator?: number;
  readonly denominator?: number;
  readonly asOf: string;
  readonly provenance: readonly ObservationProvenance[];
}

export type MetricCalculator = (scope: MetricScope) => CalculationResult | undefined;

export type EntryStatus = 'on_target' | 'warning' | 'off_target' | 'informational' | 'no_data';

export interface ScorecardSection {
  readonly title: string;
  readonly metricIds: readonly string[];
}

export interface ScorecardDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sections: readonly ScorecardSection[];
}

export interface ScorecardEntry {
  readonly metricId: string;
  readonly name: string;
  readonly unit: MetricUnit;
  readonly status: EntryStatus;
  readonly observation: MetricObservation | null;
  readonly previousValue: number | null;
  /** Definition tooltip content (§19: never display without it). */
  readonly definition: {
    readonly businessQuestion: string;
    readonly formula: string;
    readonly numeratorDescription: string;
    readonly denominatorDescription?: string;
    readonly ownerRole: BaselineRole;
    readonly sourceSystems: readonly string[];
    readonly refreshSchedule: string;
    readonly expectedLatency: string;
    readonly target?: number;
    readonly warningThreshold?: number;
    readonly directionality: Directionality;
    readonly version: number;
  };
}

export interface ScorecardView {
  readonly scorecard: ScorecardDefinition;
  readonly scope: MetricScope;
  readonly generatedAt: string;
  readonly sections: readonly {
    readonly title: string;
    readonly entries: readonly ScorecardEntry[];
  }[];
}
