import { isBaselineRole, type BaselineRole } from '@armada/auth';
import {
  APPROVER_ROLES,
  CONSTITUTION_DOC_TYPES,
  CONTENT_KINDS,
  type ContentBody,
  type ContentItem,
  type ContentKind,
  type ContentVersion,
} from './types.js';

/**
 * Excellence content service: create → edit (draft only) → submit → approve
 * (separation of duties) → publish (supersedes prior). Versions are frozen
 * objects; anything past draft is immutable — corrections require a new
 * version, so approval history is preserved verbatim (blueprint §15.2).
 *
 * Storage is in-memory behind this service's contract; the database epic
 * swaps the storage without changing the workflow rules.
 */

export interface ExcellenceServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface CreateDraftInput {
  readonly title: string;
  readonly body: ContentBody;
  readonly authorId: string;
}

export interface EditDraftInput {
  readonly title?: string;
  readonly body?: ContentBody;
  readonly editorId: string;
}

export interface ApproveInput {
  readonly approverId: string;
  readonly approverRole: BaselineRole;
  readonly note?: string;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`${field} must not be empty`);
}

function requireList(values: readonly string[], field: string): void {
  if (values.length === 0) throw new Error(`${field} must have at least one entry`);
  for (const value of values) requireNonEmpty(value, `${field} entry`);
}

export function validateBody(body: ContentBody): void {
  if (!CONTENT_KINDS.includes(body.kind)) {
    throw new Error(`Unknown content kind: ${String(body.kind)}`);
  }
  switch (body.kind) {
    case 'gold_standard': {
      requireNonEmpty(body.statement, 'statement');
      requireNonEmpty(body.whyItMatters, 'whyItMatters');
      requireList(body.observableBehaviors, 'observableBehaviors');
      requireList(body.unacceptableBehaviors, 'unacceptableBehaviors');
      requireNonEmpty(body.huddlePrompt, 'huddlePrompt');
      for (const example of body.roleExamples) {
        if (!isBaselineRole(example.role)) throw new Error(`Unknown role: ${example.role}`);
        requireNonEmpty(example.example, 'roleExamples entry');
      }
      return;
    }
    case 'role_card': {
      if (!isBaselineRole(body.role)) throw new Error(`Unknown role: ${body.role}`);
      requireNonEmpty(body.rolePurpose, 'rolePurpose');
      requireNonEmpty(body.patientPromise, 'patientPromise');
      requireList(body.topResponsibilities, 'topResponsibilities');
      requireList(body.shiftStart, 'shiftStart');
      requireList(body.duringShift, 'duringShift');
      requireList(body.shiftEnd, 'shiftEnd');
      requireList(body.escalationTriggers, 'escalationTriggers');
      return;
    }
    case 'policy': {
      requireNonEmpty(body.purpose, 'purpose');
      requireNonEmpty(body.scope, 'scope');
      requireNonEmpty(body.policyText, 'policyText');
      if (!isBaselineRole(body.responsibleRole)) {
        throw new Error(`Unknown role: ${body.responsibleRole}`);
      }
      if (body.reviewFrequencyMonths < 1 || body.reviewFrequencyMonths > 36) {
        throw new Error('reviewFrequencyMonths must be 1..36');
      }
      return;
    }
    case 'constitution_document': {
      if (!CONSTITUTION_DOC_TYPES.includes(body.docType)) {
        throw new Error(`Unknown constitution docType: ${String(body.docType)}`);
      }
      requireNonEmpty(body.text, 'text');
      return;
    }
  }
}

export class ExcellenceContentService {
  readonly #items = new Map<string, ContentItem>();
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: ExcellenceServiceOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  createDraft(input: CreateDraftInput): ContentVersion {
    requireNonEmpty(input.title, 'title');
    validateBody(input.body);
    const version: ContentVersion = Object.freeze({
      contentId: this.#newId(),
      version: 1,
      kind: input.body.kind,
      title: input.title,
      body: input.body,
      status: 'draft',
      createdById: input.authorId,
      createdAt: this.#now().toISOString(),
    });
    this.#items.set(version.contentId, {
      id: version.contentId,
      kind: version.kind,
      versions: [version],
    });
    return version;
  }

  /** Drafts are the only mutable stage; edits replace the draft in place. */
  editDraft(contentId: string, input: EditDraftInput): ContentVersion {
    const item = this.#require(contentId);
    const draft = item.versions.at(-1);
    if (draft === undefined || draft.status !== 'draft') {
      throw new Error('Only a draft version can be edited');
    }
    const body = input.body ?? draft.body;
    if (body.kind !== item.kind) {
      throw new Error('Content kind cannot change across versions');
    }
    validateBody(body);
    const title = input.title ?? draft.title;
    requireNonEmpty(title, 'title');
    const updated: ContentVersion = Object.freeze({ ...draft, title, body });
    this.#replaceLast(item, updated);
    return updated;
  }

  submitForReview(contentId: string, submitterId: string): ContentVersion {
    const item = this.#require(contentId);
    const draft = item.versions.at(-1);
    if (draft === undefined || draft.status !== 'draft') {
      throw new Error('Only a draft can be submitted for review');
    }
    if (submitterId !== draft.createdById) {
      throw new Error('Only the author may submit a draft for review');
    }
    const submitted: ContentVersion = Object.freeze({
      ...draft,
      status: 'in_review',
      submittedAt: this.#now().toISOString(),
    });
    this.#replaceLast(item, submitted);
    return submitted;
  }

  approve(contentId: string, input: ApproveInput): ContentVersion {
    const item = this.#require(contentId);
    const current = item.versions.at(-1);
    if (current === undefined || current.status !== 'in_review') {
      throw new Error('Only content in review can be approved');
    }
    if (input.approverId === current.createdById) {
      throw new Error('Approver must be different from the author (separation of duties)');
    }
    if (!APPROVER_ROLES.includes(input.approverRole)) {
      throw new Error(`Role ${input.approverRole} is not an approver role`);
    }
    const approved: ContentVersion = Object.freeze({
      ...current,
      status: 'approved',
      approval: {
        approverId: input.approverId,
        approverRole: input.approverRole,
        approvedAt: this.#now().toISOString(),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    this.#replaceLast(item, approved);
    return approved;
  }

  publish(contentId: string): ContentVersion {
    const item = this.#require(contentId);
    const current = item.versions.at(-1);
    if (current === undefined || current.status !== 'approved') {
      throw new Error('Only approved content can be published');
    }
    const versions = item.versions.map((v) =>
      v.status === 'published' ? Object.freeze({ ...v, status: 'superseded' as const }) : v,
    );
    const published: ContentVersion = Object.freeze({
      ...current,
      status: 'published',
      publishedAt: this.#now().toISOString(),
    });
    versions[versions.length - 1] = published;
    this.#items.set(item.id, { ...item, versions });
    return published;
  }

  /** Start the next version from the published one. One open revision at a time. */
  reviseDraft(contentId: string, input: CreateDraftInput): ContentVersion {
    const item = this.#require(contentId);
    const latest = item.versions.at(-1);
    if (latest === undefined || latest.status !== 'published') {
      throw new Error('A revision requires the latest version to be published');
    }
    if (input.body.kind !== item.kind) {
      throw new Error('Content kind cannot change across versions');
    }
    requireNonEmpty(input.title, 'title');
    validateBody(input.body);
    const draft: ContentVersion = Object.freeze({
      contentId: item.id,
      version: latest.version + 1,
      kind: item.kind,
      title: input.title,
      body: input.body,
      status: 'draft',
      createdById: input.authorId,
      createdAt: this.#now().toISOString(),
    });
    this.#items.set(item.id, { ...item, versions: [...item.versions, draft] });
    return draft;
  }

  getPublished(contentId: string): ContentVersion | undefined {
    return this.#items.get(contentId)?.versions.find((v) => v.status === 'published');
  }

  listPublished(kind?: ContentKind): readonly ContentVersion[] {
    const published: ContentVersion[] = [];
    for (const item of this.#items.values()) {
      if (kind !== undefined && item.kind !== kind) continue;
      const version = item.versions.find((v) => v.status === 'published');
      if (version !== undefined) published.push(version);
    }
    return published.sort((a, b) => a.title.localeCompare(b.title));
  }

  findPublishedRoleCard(role: string): ContentVersion | undefined {
    return this.listPublished('role_card').find(
      (v) => v.body.kind === 'role_card' && v.body.role === role,
    );
  }

  history(contentId: string): readonly ContentVersion[] {
    return this.#require(contentId).versions;
  }

  getLatest(contentId: string): ContentVersion | undefined {
    return this.#items.get(contentId)?.versions.at(-1);
  }

  #require(contentId: string): ContentItem {
    const item = this.#items.get(contentId);
    if (item === undefined) throw new Error(`Unknown content: ${contentId}`);
    return item;
  }

  #replaceLast(item: ContentItem, version: ContentVersion): void {
    const versions = [...item.versions];
    versions[versions.length - 1] = version;
    this.#items.set(item.id, { ...item, versions });
  }
}
