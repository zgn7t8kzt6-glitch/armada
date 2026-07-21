import { isBaselineRole } from './roles.js';
import type { RoleAssignment, UserRecord, UserStatus } from './types.js';

/**
 * User provisioning store (interface + in-memory implementation).
 * A database-backed implementation with the same contract replaces this in
 * the database epic; provisioning flows (SCIM/HR-driven) come with real SSO.
 */

export interface UserStore {
  create(input: NewUser): UserRecord;
  getById(id: string): UserRecord | undefined;
  getByEmail(email: string): UserRecord | undefined;
  list(): readonly UserRecord[];
  setStatus(id: string, status: UserStatus): UserRecord;
  setAssignments(id: string, assignments: readonly RoleAssignment[]): UserRecord;
}

export interface NewUser {
  readonly email: string;
  readonly displayName: string;
  readonly assignments: readonly RoleAssignment[];
  readonly status?: UserStatus;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAssignments(assignments: readonly RoleAssignment[]): void {
  for (const a of assignments) {
    if (!isBaselineRole(a.role)) {
      throw new Error(`Unknown role: ${String(a.role)}`);
    }
    if (a.organizationId.trim() === '') {
      throw new Error('Role assignment requires an organizationId');
    }
    if (a.facilityScope !== 'all' && a.facilityScope.length === 0) {
      throw new Error('Facility scope must be "all" or a non-empty facility list');
    }
  }
}

export interface InMemoryUserStoreOptions {
  readonly newId?: () => string;
}

export class InMemoryUserStore implements UserStore {
  readonly #byId = new Map<string, UserRecord>();
  readonly #newId: () => string;

  constructor(options: InMemoryUserStoreOptions = {}) {
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  create(input: NewUser): UserRecord {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error('Invalid email');
    }
    if (this.getByEmail(email) !== undefined) {
      throw new Error(`User already exists: ${email}`);
    }
    validateAssignments(input.assignments);
    const user: UserRecord = Object.freeze({
      id: this.#newId(),
      email,
      displayName: input.displayName,
      status: input.status ?? 'active',
      assignments: Object.freeze([...input.assignments]),
    });
    this.#byId.set(user.id, user);
    return user;
  }

  getById(id: string): UserRecord | undefined {
    return this.#byId.get(id);
  }

  getByEmail(email: string): UserRecord | undefined {
    const normalized = email.trim().toLowerCase();
    for (const user of this.#byId.values()) {
      if (user.email === normalized) return user;
    }
    return undefined;
  }

  list(): readonly UserRecord[] {
    return [...this.#byId.values()];
  }

  setStatus(id: string, status: UserStatus): UserRecord {
    const user = this.#requireUser(id);
    const updated: UserRecord = Object.freeze({ ...user, status });
    this.#byId.set(id, updated);
    return updated;
  }

  setAssignments(id: string, assignments: readonly RoleAssignment[]): UserRecord {
    validateAssignments(assignments);
    const user = this.#requireUser(id);
    const updated: UserRecord = Object.freeze({
      ...user,
      assignments: Object.freeze([...assignments]),
    });
    this.#byId.set(id, updated);
    return updated;
  }

  #requireUser(id: string): UserRecord {
    const user = this.#byId.get(id);
    if (user === undefined) throw new Error(`Unknown user: ${id}`);
    return user;
  }
}
