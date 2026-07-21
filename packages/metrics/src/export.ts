import type { ScorecardView } from './types.js';

/** CSV export for offline review and downtime binders (blueprint §26). */

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function renderScorecardCsv(view: ScorecardView): string {
  const rows: string[] = [
    [
      'section',
      'metric_id',
      'metric_name',
      'value',
      'unit',
      'status',
      'target',
      'warning_threshold',
      'directionality',
      'as_of',
      'sources',
      'owner_role',
      'formula',
      'definition_version',
    ]
      .map(csvCell)
      .join(','),
  ];
  for (const section of view.sections) {
    for (const entry of section.entries) {
      rows.push(
        [
          section.title,
          entry.metricId,
          entry.name,
          entry.observation?.value ?? null,
          entry.unit,
          entry.status,
          entry.definition.target ?? null,
          entry.definition.warningThreshold ?? null,
          entry.definition.directionality,
          entry.observation?.asOf ?? null,
          entry.observation?.provenance.map((p) => p.sourceSystem).join('; ') ??
            entry.definition.sourceSystems.join('; '),
          entry.definition.ownerRole,
          entry.definition.formula,
          entry.definition.version,
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `${rows.join('\n')}\n`;
}
