import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Server-side session management with signed bearer tokens.
 *
 * Token = base64url(payload JSON) + '.' + HMAC-SHA256 signature. Verification
 * requires BOTH a valid signature AND a live server-side record, so
 * revocation is immediate (blueprint §23: "revoked user retaining session").
 * TTLs are short by default; there is no refresh in Epic 2 — re-authenticate.
 */

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type SessionVerification =
  | { readonly ok: true; readonly session: SessionRecord }
  | { readonly ok: false; readonly reason: 'malformed' | 'bad_signature' | 'expired' | 'revoked' };

export interface SessionManagerOptions {
  readonly secret: string;
  readonly ttlMinutes: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

interface TokenPayload {
  readonly sid: string;
  readonly sub: string;
  readonly exp: number;
}

const MIN_SECRET_LENGTH = 32;

function b64url(data: string): string {
  return Buffer.from(data, 'utf8').toString('base64url');
}

export class SessionManager {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #secret: string;
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: SessionManagerOptions) {
    if (options.secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`Session secret must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    if (options.ttlMinutes < 1) {
      throw new Error('Session TTL must be at least 1 minute');
    }
    this.#secret = options.secret;
    this.#ttlMs = options.ttlMinutes * 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  #sign(encodedPayload: string): string {
    return createHmac('sha256', this.#secret).update(encodedPayload).digest('base64url');
  }

  create(userId: string): { token: string; session: SessionRecord } {
    const now = this.#now();
    const session: SessionRecord = Object.freeze({
      id: this.#newId(),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#ttlMs).toISOString(),
    });
    this.#sessions.set(session.id, session);
    const payload: TokenPayload = {
      sid: session.id,
      sub: userId,
      exp: now.getTime() + this.#ttlMs,
    };
    const encoded = b64url(JSON.stringify(payload));
    return { token: `${encoded}.${this.#sign(encoded)}`, session };
  }

  verify(token: string): SessionVerification {
    const parts = token.split('.');
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
      return { ok: false, reason: 'malformed' };
    }
    const [encoded, signature] = parts;
    const expected = this.#sign(encoded);
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { ok: false, reason: 'bad_signature' };
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    const session = this.#sessions.get(payload.sid);
    if (session === undefined) {
      return { ok: false, reason: 'revoked' };
    }
    if (this.#now().getTime() >= new Date(session.expiresAt).getTime()) {
      this.#sessions.delete(session.id);
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, session };
  }

  revoke(sessionId: string): boolean {
    return this.#sessions.delete(sessionId);
  }

  /** Revoke every session for a user (deprovisioning hook). */
  revokeAllForUser(userId: string): number {
    let revoked = 0;
    for (const [id, session] of this.#sessions) {
      if (session.userId === userId) {
        this.#sessions.delete(id);
        revoked += 1;
      }
    }
    return revoked;
  }

  listActive(): readonly SessionRecord[] {
    const now = this.#now().getTime();
    return [...this.#sessions.values()].filter((s) => new Date(s.expiresAt).getTime() > now);
  }
}
