import type { AuditLog } from '@armada/audit';
import type { BaselineRole } from '@armada/auth';

/**
 * Daily lineup generator (blueprint §15.3, Epic 11).
 *
 * The lineup is AES's daily heartbeat: Gold Standard, recognition, safety
 * focus, and the day's operational facts. AIP fills the operational
 * sections from live sources; leaders edit, approve, and publish. A source
 * being down degrades one section — never the lineup (§24: "integration is
 * down during morning lineup"). Published lineups are immutable, and the
 * printable view works offline (§26).
 *
 * Clinical content in a lineup is minimal and role-appropriate — internal
 * references and counts only, never names or chart content.
 */

export const LINEUP_SECTIONS = [
  'gold_standard',
  'patient_experience_story',
  'recognition',
  'safety_focus',
  'census',
  'arrivals_discharges',
  'authorization_risks',
  'operational_barriers',
  'staffing',
  'improvement_focus',
] as const;

export type LineupSection = (typeof LINEUP_SECTIONS)[number];

/** Sections AIP generates from data; the rest are human-authored. */
export const GENERATED_SECTIONS: readonly LineupSection[] = [
  'gold_standard',
  'census',
  'arrivals_discharges',
  'authorization_risks',
  'operational_barriers',
];

export const LINEUP_APPROVER_ROLES: readonly BaselineRole[] = [
  'facility_administrator',
  'clinical_director',
  'nursing_director',
  'executive',
  'quality_risk',
];

export interface LineupItem {
  readonly section: LineupSection;
  readonly title: string;
  readonly body: string;
  readonly generated: boolean;
  /** Source + freshness for generated facts (§2.7). */
  readonly source?: { readonly sourceSystem: string; readonly asOf: string };
  /** Set when a generated section's source was unavailable. */
  readonly unavailable?: boolean;
}

export type LineupStatus = 'draft' | 'approved' | 'published';

export interface DailyLineup {
  readonly id: string;
  readonly organizationId: string;
  readonly facilityId: string;
  /** Calendar date, YYYY-MM-DD. */
  readonly date: string;
  readonly status: LineupStatus;
  readonly items: readonly LineupItem[];
  readonly generatedAt: string;
  readonly approval?: {
    readonly approvedBy: string;
    readonly approverRole: BaselineRole;
    readonly approvedAt: string;
  };
  readonly publishedAt?: string;
  readonly version: number;
}

/** Everything AIP can contribute; each provider may return undefined
 * (source unavailable) and the lineup still generates. */
export interface LineupFactsProvider {
  goldStandard(): { title: string; statement: string; huddlePrompt: string } | undefined;
  census(facilityId: string): { body: string; sourceSystem: string; asOf: string } | undefined;
  arrivalsDischarges(facilityId: string): { body: string; sourceSystem: string; asOf: string } | undefined;
  authorizationRisks(facilityId: string): { body: string; sourceSystem: string; asOf: string } | undefined;
  operationalBarriers(facilityId: string): { body: string; sourceSystem: string; asOf: string } | undefined;
}

export interface LineupServiceOptions {
  readonly audit: AuditLog;
  readonly facts: LineupFactsProvider;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const UNAVAILABLE_BODY =
  'Source unavailable — use the manual downtime process for this section (see runbooks).';

export class LineupService {
  readonly #lineups = new Map<string, DailyLineup>();
  readonly #audit: AuditLog;
  readonly #facts: LineupFactsProvider;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: LineupServiceOptions) {
    this.#audit = options.audit;
    this.#facts = options.facts;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Get today's lineup, generating a draft if none exists yet. */
  getOrGenerate(organizationId: string, facilityId: string, date: string): DailyLineup {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`date must be YYYY-MM-DD (got "${date}")`);
    }
    const key = `${facilityId}:${date}`;
    const existing = this.#lineups.get(key);
    if (existing !== undefined) return existing;

    const items: LineupItem[] = [];
    const generated = (
      section: LineupSection,
      title: string,
      fact: { body: string; sourceSystem: string; asOf: string } | undefined,
    ): void => {
      if (fact === undefined) {
        items.push({ section, title, body: UNAVAILABLE_BODY, generated: true, unavailable: true });
      } else {
        items.push({
          section,
          title,
          body: fact.body,
          generated: true,
          source: { sourceSystem: fact.sourceSystem, asOf: fact.asOf },
        });
      }
    };

    const standard = this.#tryFacts(() => this.#facts.goldStandard());
    if (standard !== undefined) {
      items.push({
        section: 'gold_standard',
        title: `Today's Gold Standard: ${standard.title}`,
        body: `${standard.statement}\n\nHuddle prompt: ${standard.huddlePrompt}`,
        generated: true,
      });
    } else {
      items.push({
        section: 'gold_standard',
        title: "Today's Gold Standard",
        body: 'Excellence Library unavailable — use the printed Gold Standards binder.',
        generated: true,
        unavailable: true,
      });
    }
    generated('census', 'Census', this.#tryFacts(() => this.#facts.census(facilityId)));
    generated(
      'arrivals_discharges',
      'Arrivals and discharges',
      this.#tryFacts(() => this.#facts.arrivalsDischarges(facilityId)),
    );
    generated(
      'authorization_risks',
      'Authorization risks',
      this.#tryFacts(() => this.#facts.authorizationRisks(facilityId)),
    );
    generated(
      'operational_barriers',
      'High-priority operational barriers',
      this.#tryFacts(() => this.#facts.operationalBarriers(facilityId)),
    );
    // Human sections start as prompts for the leader running the lineup.
    items.push(
      {
        section: 'recognition',
        title: 'Recognition',
        body: 'Recognize a teammate who lived a Gold Standard yesterday.',
        generated: false,
      },
      {
        section: 'safety_focus',
        title: 'Safety focus',
        body: 'Name one safety focus for this shift.',
        generated: false,
      },
      {
        section: 'improvement_focus',
        title: 'One improvement focus',
        body: 'What one thing will we do better today than yesterday?',
        generated: false,
      },
    );

    const lineup: DailyLineup = Object.freeze({
      id: this.#newId(),
      organizationId,
      facilityId,
      date,
      status: 'draft' as const,
      items: Object.freeze(items),
      generatedAt: this.#now().toISOString(),
      version: 1,
    });
    this.#lineups.set(key, lineup);
    this.#audit.append({
      actorType: 'service',
      actorId: 'lineup-generator',
      action: 'lineup.generated',
      subjectType: 'daily_lineup',
      subjectId: lineup.id,
      organizationId,
      facilityId,
      summary: `date=${date} unavailable_sections=${items.filter((i) => i.unavailable === true).length}`,
    });
    return lineup;
  }

  /** Replace or add a section item while the lineup is a draft. */
  editItem(
    lineupId: string,
    input: { section: LineupSection; title: string; body: string; editorId: string },
  ): DailyLineup {
    const lineup = this.#requireById(lineupId);
    if (lineup.status !== 'draft') {
      throw new Error(`Only draft lineups can be edited (status: ${lineup.status})`);
    }
    if (!LINEUP_SECTIONS.includes(input.section)) {
      throw new Error(`Unknown section: ${String(input.section)}`);
    }
    if (input.title.trim() === '' || input.body.trim() === '') {
      throw new Error('title and body must not be empty');
    }
    const items = lineup.items.filter((i) => i.section !== input.section);
    items.push({ section: input.section, title: input.title, body: input.body, generated: false });
    const updated: DailyLineup = Object.freeze({
      ...lineup,
      items: Object.freeze(items),
      version: lineup.version + 1,
    });
    this.#store(updated);
    this.#audit.append({
      actorType: 'user',
      actorId: input.editorId,
      action: 'lineup.edited',
      subjectType: 'daily_lineup',
      subjectId: lineupId,
      facilityId: lineup.facilityId,
      summary: `section=${input.section}`,
    });
    return updated;
  }

  approve(lineupId: string, input: { approvedBy: string; approverRole: BaselineRole }): DailyLineup {
    const lineup = this.#requireById(lineupId);
    if (lineup.status !== 'draft') {
      throw new Error(`Only draft lineups can be approved (status: ${lineup.status})`);
    }
    if (!LINEUP_APPROVER_ROLES.includes(input.approverRole)) {
      throw new Error(`Role ${input.approverRole} cannot approve lineups`);
    }
    const updated: DailyLineup = Object.freeze({
      ...lineup,
      status: 'approved' as const,
      approval: {
        approvedBy: input.approvedBy,
        approverRole: input.approverRole,
        approvedAt: this.#now().toISOString(),
      },
      version: lineup.version + 1,
    });
    this.#store(updated);
    this.#audit.append({
      actorType: 'user',
      actorId: input.approvedBy,
      action: 'lineup.approved',
      subjectType: 'daily_lineup',
      subjectId: lineupId,
      facilityId: lineup.facilityId,
      summary: `approver_role=${input.approverRole}`,
    });
    return updated;
  }

  publish(lineupId: string, publishedBy: string): DailyLineup {
    const lineup = this.#requireById(lineupId);
    if (lineup.status !== 'approved') {
      throw new Error(`Only approved lineups can be published (status: ${lineup.status})`);
    }
    const updated: DailyLineup = Object.freeze({
      ...lineup,
      status: 'published' as const,
      publishedAt: this.#now().toISOString(),
      version: lineup.version + 1,
    });
    this.#store(updated);
    this.#audit.append({
      actorType: 'user',
      actorId: publishedBy,
      action: 'lineup.published',
      subjectType: 'daily_lineup',
      subjectId: lineupId,
      facilityId: lineup.facilityId,
      summary: `date=${lineup.date}`,
    });
    return updated;
  }

  getById(id: string): DailyLineup | undefined {
    return [...this.#lineups.values()].find((l) => l.id === id);
  }

  #tryFacts<T>(fn: () => T | undefined): T | undefined {
    try {
      return fn();
    } catch {
      return undefined; // A failing provider degrades one section, not the lineup.
    }
  }

  #requireById(id: string): DailyLineup {
    const lineup = this.getById(id);
    if (lineup === undefined) throw new Error(`Unknown lineup: ${id}`);
    return lineup;
  }

  #store(lineup: DailyLineup): void {
    this.#lineups.set(`${lineup.facilityId}:${lineup.date}`, lineup);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Self-contained printable view for the huddle (offline-capable, §26). */
export function renderLineupHtml(lineup: DailyLineup, facilityName: string): string {
  const sections = lineup.items
    .map((item) => {
      const meta =
        item.source !== undefined
          ? `<p class="meta">Source: ${escapeHtml(item.source.sourceSystem)} · as of ${escapeHtml(item.source.asOf)}</p>`
          : item.unavailable === true
            ? '<p class="meta">⚠ Source unavailable — manual process applies</p>'
            : '';
      const body = escapeHtml(item.body).replaceAll('\n', '<br>');
      return `<section><h2>${escapeHtml(item.title)}</h2><p>${body}</p>${meta}</section>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Daily Lineup — ${escapeHtml(facilityName)} — ${escapeHtml(lineup.date)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 44rem; margin: 2rem auto; color: #1a1a1a; line-height: 1.5; }
  header { border-bottom: 2px solid #1a1a1a; margin-bottom: 1rem; padding-bottom: 0.5rem; }
  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.1rem 0 0.3rem; }
  .meta { font-size: 0.75rem; color: #555; margin: 0.15rem 0 0; }
  footer { margin-top: 2rem; border-top: 1px solid #999; padding-top: 0.5rem; font-size: 0.75rem; color: #555; }
  @media print { body { margin: 0.5in; } }
</style>
</head>
<body>
<header>
  <h1>Daily Lineup — ${escapeHtml(facilityName)}</h1>
  <p>${escapeHtml(lineup.date)} · status: ${escapeHtml(lineup.status)}${
    lineup.approval !== undefined ? ` · approved by role ${escapeHtml(lineup.approval.approverRole)}` : ''
  }</p>
</header>
${sections}
<footer>Printed copies are uncontrolled. The lineup must never be the only copy of information required to run a shift safely.</footer>
</body>
</html>
`;
}
