import type { Principal, UserRecord } from './types.js';

/**
 * OIDC-compatible authentication abstraction (blueprint master prompt step 3).
 *
 * The production implementation will wrap a real OIDC provider (e.g.
 * Microsoft Entra ID) — authorization-code flow, token validation, MFA
 * enforced at the IdP. That requires a vetted library and its own ADR
 * (ADR-0003 decision point). Until then, the application depends only on
 * this interface, and development uses the mock below.
 */

export interface IdentityProvider {
  readonly name: string;
  readonly issuer: string;
  /**
   * Authenticate a credential and return the asserted principal, or null.
   * For real OIDC this is the token-exchange + validation step; the dev
   * provider matches a synthetic directory.
   */
  authenticate(credential: DevCredential): Promise<Principal | null>;
}

export interface DevCredential {
  readonly email: string;
}

export const DEV_ISSUER = 'https://dev-idp.invalid';

export interface DevIdentityProviderOptions {
  /** Resolved NODE_ENV; construction is refused in production. */
  readonly nodeEnv: string;
  /** Directory of synthetic users to authenticate against. */
  readonly lookupByEmail: (email: string) => UserRecord | undefined;
}

/**
 * Development-only identity provider: asserts identity for known synthetic
 * users with no password, because it must never guard anything real. It
 * throws at construction in production so a misconfigured deployment fails
 * closed at boot rather than exposing a bypass.
 */
export class DevIdentityProvider implements IdentityProvider {
  readonly name = 'dev-identity-provider';
  readonly issuer = DEV_ISSUER;
  readonly #lookupByEmail: (email: string) => UserRecord | undefined;

  constructor(options: DevIdentityProviderOptions) {
    if (options.nodeEnv === 'production') {
      throw new Error('DevIdentityProvider must never be constructed in production');
    }
    this.#lookupByEmail = options.lookupByEmail;
  }

  authenticate(credential: DevCredential): Promise<Principal | null> {
    const user = this.#lookupByEmail(credential.email);
    if (user === undefined || user.status !== 'active') {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      subject: `dev|${user.id}`,
      issuer: this.issuer,
      email: user.email,
      displayName: user.displayName,
    });
  }
}
