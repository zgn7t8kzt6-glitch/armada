import type { SourceSystem } from './types.js';

/**
 * Mapping registry (blueprint §12: mapping versioning). Envelopes must
 * declare a (sourceSystem, entityType, schemaVersion, mappingVersion) that
 * the platform has registered — anything else is quarantined instead of
 * silently ingested with the wrong interpretation.
 */

export interface MappingRegistration {
  readonly sourceSystem: SourceSystem;
  readonly entityType: string;
  readonly schemaVersion: string;
  readonly mappingVersion: string;
}

function key(sourceSystem: string, entityType: string): string {
  return `${sourceSystem}:${entityType}`;
}

export class MappingRegistry {
  readonly #registrations = new Map<string, MappingRegistration>();

  register(registration: MappingRegistration): void {
    const k = key(registration.sourceSystem, registration.entityType);
    if (this.#registrations.has(k)) {
      throw new Error(`Mapping already registered: ${k}`);
    }
    this.#registrations.set(k, registration);
  }

  get(sourceSystem: string, entityType: string): MappingRegistration | undefined {
    return this.#registrations.get(key(sourceSystem, entityType));
  }

  /** Does the envelope's declared schema/mapping version match what we registered? */
  matches(envelope: {
    sourceSystem: string;
    entityType: string;
    schemaVersion: string;
    mappingVersion: string;
  }): boolean {
    const registration = this.get(envelope.sourceSystem, envelope.entityType);
    return (
      registration !== undefined &&
      registration.schemaVersion === envelope.schemaVersion &&
      registration.mappingVersion === envelope.mappingVersion
    );
  }

  list(): readonly MappingRegistration[] {
    return [...this.#registrations.values()];
  }
}
