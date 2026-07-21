import type { ContentVersion } from './types.js';

/**
 * Printable and offline exports (blueprint §1.1: AES content must export to
 * printable and offline formats). Output is fully self-contained — inline
 * CSS, no scripts, no external assets — and every value is HTML-escaped
 * because content is user-authored.
 */

export interface Section {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly string[];
}

export function contentSections(version: ContentVersion): readonly Section[] {
  const body = version.body;
  switch (body.kind) {
    case 'gold_standard':
      return [
        { heading: 'Standard', paragraphs: [body.statement] },
        { heading: 'Why it matters', paragraphs: [body.whyItMatters] },
        { heading: 'Observable behaviors', items: body.observableBehaviors },
        { heading: 'Unacceptable behaviors', items: body.unacceptableBehaviors },
        ...(body.roleExamples.length > 0
          ? [
              {
                heading: 'Role-specific examples',
                items: body.roleExamples.map((e) => `${e.role}: ${e.example}`),
              },
            ]
          : []),
        { heading: 'Patient experience connection', paragraphs: [body.patientExperienceConnection] },
        { heading: 'Compliance connection', paragraphs: [body.complianceConnection] },
        { heading: 'Huddle discussion prompt', paragraphs: [body.huddlePrompt] },
        ...(body.recognitionExamples.length > 0
          ? [{ heading: 'Recognition examples', items: body.recognitionExamples }]
          : []),
      ];
    case 'role_card':
      return [
        { heading: 'Role purpose', paragraphs: [body.rolePurpose] },
        { heading: 'Patient promise', paragraphs: [body.patientPromise] },
        { heading: 'Top responsibilities', items: body.topResponsibilities },
        { heading: 'Shift start — standard work', items: body.shiftStart },
        { heading: 'During shift — standard work', items: body.duringShift },
        { heading: 'Shift end — standard work', items: body.shiftEnd },
        { heading: 'Moments of truth', items: body.momentsOfTruth },
        { heading: 'Escalation triggers', items: body.escalationTriggers },
        { heading: 'Documentation responsibilities', items: body.documentationResponsibilities },
        { heading: 'KPIs', items: body.kpis },
        { heading: 'Competencies', items: body.competencies },
        { heading: 'Required policies', items: body.requiredPolicies },
        { heading: 'Gold Standard examples', items: body.goldStandardExamples },
        { heading: 'Career and mastery path', items: body.careerPath },
      ];
    case 'policy':
      return [
        { heading: 'Purpose', paragraphs: [body.purpose] },
        { heading: 'Scope', paragraphs: [body.scope] },
        { heading: 'Policy', paragraphs: [body.policyText] },
        ...(body.procedureSteps.length > 0
          ? [{ heading: 'Procedure', items: body.procedureSteps }]
          : []),
        ...(body.references.length > 0 ? [{ heading: 'References', items: body.references }] : []),
        {
          heading: 'Governance',
          items: [
            `Responsible role: ${body.responsibleRole}`,
            `Review frequency: every ${body.reviewFrequencyMonths} months`,
          ],
        },
      ];
    case 'constitution_document':
      return [{ heading: body.docType.replaceAll('_', ' '), paragraphs: [body.text] }];
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function footerLines(version: ContentVersion): string[] {
  const lines = [
    `Version ${version.version} — status: ${version.status}`,
    version.approval !== undefined
      ? `Approved by role ${version.approval.approverRole} on ${version.approval.approvedAt}`
      : 'Not yet approved',
  ];
  if (version.publishedAt !== undefined) lines.push(`Published ${version.publishedAt}`);
  lines.push('Printed copies are uncontrolled — verify against the Excellence Library.');
  return lines;
}

export function renderPrintableHtml(version: ContentVersion): string {
  const sections = contentSections(version)
    .map((section) => {
      const heading = `<h2>${escapeHtml(section.heading)}</h2>`;
      const paragraphs = (section.paragraphs ?? [])
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('\n');
      const items =
        section.items !== undefined && section.items.length > 0
          ? `<ul>${section.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
          : '';
      return `<section>${heading}${paragraphs}${items}</section>`;
    })
    .join('\n');

  const footer = footerLines(version)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(version.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 2rem auto; max-width: 46rem; color: #1a1a1a; line-height: 1.5; }
  header { border-bottom: 2px solid #1a1a1a; margin-bottom: 1.5rem; padding-bottom: 0.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  .kind { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; color: #555; }
  h2 { font-size: 1.05rem; margin: 1.25rem 0 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
  ul { margin: 0.25rem 0 0.75rem 1.25rem; padding: 0; }
  li { margin-bottom: 0.25rem; }
  footer { margin-top: 2rem; border-top: 1px solid #999; padding-top: 0.5rem; font-size: 0.75rem; color: #555; }
  @media print { body { margin: 0.5in; } }
</style>
</head>
<body>
<header>
  <p class="kind">${escapeHtml(version.kind.replaceAll('_', ' '))}</p>
  <h1>${escapeHtml(version.title)}</h1>
</header>
${sections}
<footer>${footer}</footer>
</body>
</html>
`;
}

/** Plain-text export for offline/downtime binders (blueprint §26). */
export function renderPlainText(version: ContentVersion): string {
  const lines: string[] = [
    version.title.toUpperCase(),
    `[${version.kind.replaceAll('_', ' ')}]`,
    '',
  ];
  for (const section of contentSections(version)) {
    lines.push(`## ${section.heading}`);
    for (const paragraph of section.paragraphs ?? []) lines.push(paragraph);
    for (const item of section.items ?? []) lines.push(`- ${item}`);
    lines.push('');
  }
  lines.push(...footerLines(version));
  return `${lines.join('\n')}\n`;
}
