import type { MetricsService } from './service.js';
import type { ScorecardDefinition } from './types.js';

/**
 * Priority metric definitions (blueprint §19) and the executive scorecard.
 * Definitions are governance content: seeded here for development, owned by
 * the Data Governance Council in production. Targets are synthetic
 * placeholders pending leadership approval.
 */

export interface MetricsSeedActors {
  readonly definedBy: string;
  readonly approvedBy: string;
}

export const EXECUTIVE_SCORECARD_ID = 'executive-daily';

export function seedMetricDefinitions(
  service: MetricsService,
  actors: MetricsSeedActors,
): ScorecardDefinition {
  const define = (
    input: Omit<
      Parameters<MetricsService['define']>[0],
      'createdBy' | 'inclusionCriteria' | 'exclusionCriteria'
    > & {
      inclusionCriteria?: readonly string[];
      exclusionCriteria?: readonly string[];
    },
  ): void => {
    service.define({
      inclusionCriteria: [],
      exclusionCriteria: [],
      ...input,
      createdBy: actors.definedBy,
    });
    service.approve(input.id, { approvedBy: actors.approvedBy, approverRole: 'executive' });
  };

  define({
    id: 'census.occupancy_rate',
    name: 'Occupancy rate',
    businessQuestion: 'Are we filling the beds we operate?',
    ownerRole: 'facility_administrator',
    formula: 'current census ÷ operated beds × 100',
    numeratorDescription: 'Patients in a bed at the census snapshot',
    denominatorDescription: 'Operated (staffed) beds',
    inclusionCriteria: ['All operated beds at the facility'],
    exclusionCriteria: ['Beds closed for maintenance'],
    sourceSystems: ['mock-kipu'],
    refreshSchedule: 'every ingestion cycle (5 min in development)',
    expectedLatency: 'minutes',
    unit: 'percent',
    directionality: 'higher_is_better',
    target: 85,
    warningThreshold: 75,
    segmentation: ['organization', 'facility'],
  });

  define({
    id: 'admissions.conversion_rate',
    name: 'Referral-to-admission conversion',
    businessQuestion: 'How many qualified opportunities become admissions?',
    ownerRole: 'admissions',
    formula: 'admitted opportunities ÷ all closed opportunities × 100',
    numeratorDescription: 'Opportunities reaching the admitted stage',
    denominatorDescription: 'All opportunities in a terminal stage (admitted or lost)',
    sourceSystems: ['mock-salesforce'],
    refreshSchedule: 'every ingestion cycle',
    expectedLatency: 'minutes',
    unit: 'percent',
    directionality: 'higher_is_better',
    target: 60,
    warningThreshold: 45,
    segmentation: ['organization'],
  });

  define({
    id: 'revenue.denial_rate',
    name: 'Denial rate',
    businessQuestion: 'What share of claims is being denied?',
    ownerRole: 'revenue_cycle',
    formula: 'claims with denials ÷ all claims × 100',
    numeratorDescription: 'Distinct claims with at least one denial record',
    denominatorDescription: 'All claims in the revenue-cycle system',
    sourceSystems: ['mock-collaboratemd'],
    refreshSchedule: 'every ingestion cycle',
    expectedLatency: 'hours',
    unit: 'percent',
    directionality: 'lower_is_better',
    target: 8,
    warningThreshold: 12,
    segmentation: ['organization'],
  });

  define({
    id: 'work.overdue_items',
    name: 'Overdue work items',
    businessQuestion: 'Is owned work being completed on time?',
    ownerRole: 'facility_administrator',
    formula: 'count of open or acknowledged work items past due',
    numeratorDescription: 'Open/acknowledged work items with dueAt in the past',
    sourceSystems: ['aip-work-service'],
    refreshSchedule: 'on demand',
    expectedLatency: 'minutes',
    unit: 'count',
    directionality: 'lower_is_better',
    target: 0,
    warningThreshold: 3,
    segmentation: ['organization', 'facility'],
  });

  define({
    id: 'ama.weekend_rate',
    name: 'Weekend AMA rate',
    businessQuestion: 'Are weekend departures against medical advice trending down?',
    ownerRole: 'clinical_director',
    formula: 'weekend AMA discharges ÷ weekend discharges × 100',
    numeratorDescription: 'AMA discharges occurring Saturday–Sunday',
    denominatorDescription: 'All discharges occurring Saturday–Sunday',
    sourceSystems: ['kipu (pending discovery)'],
    refreshSchedule: 'daily once the clinical connector is live',
    expectedLatency: 'daily',
    unit: 'percent',
    directionality: 'lower_is_better',
    target: 5,
    warningThreshold: 8,
    segmentation: ['organization', 'facility'],
  });
  // Deliberately no calculator for ama.weekend_rate yet: its source needs
  // vendor discovery, so the scorecard shows no_data instead of a guess.

  return service.defineScorecard({
    id: EXECUTIVE_SCORECARD_ID,
    name: 'Executive daily scorecard',
    description:
      'Occupancy, flow, work discipline, and revenue health at a glance. Every figure carries its definition and provenance.',
    sections: [
      { title: 'Operations', metricIds: ['census.occupancy_rate', 'work.overdue_items'] },
      { title: 'Growth', metricIds: ['admissions.conversion_rate'] },
      { title: 'Revenue cycle', metricIds: ['revenue.denial_rate'] },
      { title: 'Clinical quality', metricIds: ['ama.weekend_rate'] },
    ],
  });
}
