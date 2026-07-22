import type { CandidateMatch, IdentitySignals, PersonRecord, SignalField } from './types.js';

/**
 * Deterministic matching (blueprint §9.2). Normalization is conservative:
 * we lowercase/trim/collapse, we do NOT do fuzzy or phonetic matching —
 * anything short of exact normalized equality is a human's call.
 */

export function normalizeSignals(signals: IdentitySignals): IdentitySignals {
  const collapse = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return {
    ...(signals.mrn !== undefined ? { mrn: signals.mrn.trim().toUpperCase() } : {}),
    ...(signals.mrnFacilityId !== undefined ? { mrnFacilityId: signals.mrnFacilityId.trim() } : {}),
    ...(signals.legalName !== undefined ? { legalName: collapse(signals.legalName) } : {}),
    ...(signals.dateOfBirth !== undefined ? { dateOfBirth: signals.dateOfBirth.trim() } : {}),
    ...(signals.phone !== undefined ? { phone: signals.phone.replace(/\D/g, '') } : {}),
    ...(signals.email !== undefined ? { email: signals.email.trim().toLowerCase() } : {}),
    ...(signals.addressLine !== undefined ? { addressLine: collapse(signals.addressLine) } : {}),
    ...(signals.payerMemberId !== undefined
      ? { payerMemberId: signals.payerMemberId.trim().toUpperCase() }
      : {}),
  };
}

const COMPARABLE_FIELDS: readonly SignalField[] = [
  'mrn',
  'legalName',
  'dateOfBirth',
  'phone',
  'email',
  'addressLine',
  'payerMemberId',
];

/** §9.2: conflicting MRN (within the issuing facility) or DOB forbids auto-link. */
const HARD_CONFLICT_FIELDS: readonly SignalField[] = ['mrn', 'dateOfBirth'];

/** Corroborating attributes for the name+DOB rule (approved set, §9.2). */
export const CORROBORATING_FIELDS: readonly SignalField[] = [
  'phone',
  'email',
  'payerMemberId',
  'addressLine',
];

export function compareSignals(incoming: IdentitySignals, candidate: IdentitySignals): Omit<CandidateMatch, 'personId'> {
  const matched: SignalField[] = [];
  const differing: SignalField[] = [];
  for (const field of COMPARABLE_FIELDS) {
    const a = incoming[field];
    const b = candidate[field];
    if (a === undefined || b === undefined || a === '' || b === '') continue;
    if (field === 'mrn') {
      // MRNs are facility-scoped: equality (and conflict) only counts when
      // both records name the same issuing facility.
      if (
        incoming.mrnFacilityId === undefined ||
        candidate.mrnFacilityId === undefined ||
        incoming.mrnFacilityId !== candidate.mrnFacilityId
      ) {
        continue;
      }
    }
    if (a === b) matched.push(field);
    else differing.push(field);
  }
  const conflicting = differing.filter((f) => HARD_CONFLICT_FIELDS.includes(f));
  return { matchedFields: matched, conflictingFields: conflicting, differingFields: differing };
}

/**
 * A person is a candidate when the overlap is meaningful enough to show a
 * reviewer: an MRN match, a name+DOB match, any two matched fields, or a
 * strong-key match (MRN/name/DOB) that carries a hard conflict.
 */
export function findCandidates(
  incoming: IdentitySignals,
  persons: Iterable<PersonRecord>,
): readonly CandidateMatch[] {
  const normalizedIncoming = normalizeSignals(incoming);
  const candidates: CandidateMatch[] = [];
  for (const person of persons) {
    if (person.mergedInto !== undefined) continue;
    const comparison = compareSignals(normalizedIncoming, normalizeSignals(person.signals));
    const m = comparison.matchedFields;
    const meaningful =
      m.includes('mrn') ||
      (m.includes('legalName') && m.includes('dateOfBirth')) ||
      m.length >= 2 ||
      (comparison.conflictingFields.length > 0 && m.length >= 1);
    if (meaningful) {
      candidates.push({ personId: person.id, ...comparison });
    }
  }
  return candidates;
}

export interface AutoLinkDecision {
  readonly ruleId: 'R1_MRN_DOB' | 'R2_NAME_DOB_CORROBORATED';
  readonly personId: string;
}

/**
 * §9.2 deterministic auto-link rules. Returns undefined when no rule fires —
 * which is the answer for any ambiguity: multiple qualifying candidates,
 * any hard conflict on a candidate, or insufficient corroboration.
 */
export function evaluateAutoLink(candidates: readonly CandidateMatch[]): AutoLinkDecision | undefined {
  if (candidates.some((c) => c.conflictingFields.length > 0)) return undefined;

  const mrnDob = candidates.filter(
    (c) => c.matchedFields.includes('mrn') && c.matchedFields.includes('dateOfBirth'),
  );
  if (mrnDob.length === 1) {
    return { ruleId: 'R1_MRN_DOB', personId: mrnDob[0]!.personId };
  }
  if (mrnDob.length > 1) return undefined;

  const nameDobPlus = candidates.filter(
    (c) =>
      c.matchedFields.includes('legalName') &&
      c.matchedFields.includes('dateOfBirth') &&
      CORROBORATING_FIELDS.some((f) => c.matchedFields.includes(f)),
  );
  if (nameDobPlus.length === 1) {
    return { ruleId: 'R2_NAME_DOB_CORROBORATED', personId: nameDobPlus[0]!.personId };
  }
  return undefined;
}
