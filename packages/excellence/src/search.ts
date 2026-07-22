import { renderPlainText } from './render.js';
import type { ContentKind, ContentVersion } from './types.js';

/**
 * Dependency-free search over published content. Term-frequency scoring with
 * a title boost — deliberately simple; PostgreSQL full-text replaces this in
 * the database epic (blueprint §5.1) behind the same result shape.
 */

export interface SearchHit {
  readonly contentId: string;
  readonly kind: ContentKind;
  readonly title: string;
  readonly version: number;
  readonly score: number;
  readonly snippet: string;
}

const TITLE_WEIGHT = 5;
const MAX_RESULTS = 20;
const SNIPPET_RADIUS = 60;

export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function countOccurrences(tokens: readonly string[], term: string): number {
  let count = 0;
  for (const token of tokens) {
    if (token === term) count += 1;
  }
  return count;
}

function makeSnippet(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase();
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1) {
      const start = Math.max(0, index - SNIPPET_RADIUS);
      const end = Math.min(text.length, index + term.length + SNIPPET_RADIUS);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < text.length ? '…' : '';
      return `${prefix}${text.slice(start, end).replaceAll('\n', ' ').trim()}${suffix}`;
    }
  }
  return text.slice(0, SNIPPET_RADIUS * 2).replaceAll('\n', ' ').trim();
}

export function searchPublished(
  versions: readonly ContentVersion[],
  query: string,
): readonly SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const version of versions) {
    const titleTokens = tokenize(version.title);
    const text = renderPlainText(version);
    const bodyTokens = tokenize(text);
    let score = 0;
    for (const term of terms) {
      score += TITLE_WEIGHT * countOccurrences(titleTokens, term);
      score += countOccurrences(bodyTokens, term);
    }
    if (score > 0) {
      hits.push({
        contentId: version.contentId,
        kind: version.kind,
        title: version.title,
        version: version.version,
        score,
        snippet: makeSnippet(text, terms),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, MAX_RESULTS);
}
