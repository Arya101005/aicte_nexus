/**
 * Duplicate / related-case classification.
 *
 * Division of labour (see docs/DECISIONS.md):
 *  - SQL (`get_duplicate_candidate_pairs`) narrows candidates with
 *    deterministic filters and supplies pg_trgm `subject_similarity`.
 *  - This module turns a candidate pair into one of the three review
 *    outcomes with a human-readable reason. It is a pure function so the
 *    labelled fixture set in `duplicate-fixtures.ts` can measure
 *    precision/recall in tests.
 *
 * Rules are evaluated in documented order — deterministic signals first,
 * then lightweight text similarity. The engine never says "Confirmed
 * duplicate": confirmation is a human decision (`decide_duplicate_review`).
 * Same institution alone never means duplicate.
 */

export type DuplicateSuggestion = 'Potential duplicate' | 'Related but distinct';

/** A candidate pair exactly as returned by `get_duplicate_candidate_pairs`. */
export type DuplicatePairInput = {
  complaintId: string;
  candidateId: string;
  complaintReference: string;
  candidateReference: string;
  institutionId: string | null;
  candidateInstitutionId: string | null;
  category: string;
  candidateCategory: string;
  bureau: string;
  candidateBureau: string;
  sourceSystem: string;
  sourceReference: string | null;
  candidateSourceSystem: string;
  candidateSourceReference: string | null;
  dateReceived: string; // ISO timestamp
  candidateDateReceived: string; // ISO timestamp
  subject: string;
  candidateSubject: string;
  /** pg_trgm similarity of normalized subjects, supplied by SQL. */
  subjectSimilarity: number;
};

export type ClassificationOutcome = {
  suggestion: DuplicateSuggestion;
  reason: string;
  signals: Record<string, string | number | boolean>;
};

/** Days within which the same institution + category counts as "potential". */
export const POTENTIAL_DUPLICATE_WINDOW_DAYS = 30;
/** Similarity at/above which text alone suggests a relationship. */
export const SUBJECT_SIMILARITY_THRESHOLD = 0.6;

/**
 * Mirror of the SQL generated column `complaints.normalized_subject`:
 * trim, strip combining marks (unaccent approximation), lowercase.
 * ASCII-only inputs match exactly; exotic transliterations are decided
 * by SQL similarity, not by this function.
 */
export function normalizeSubject(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Whole days between two ISO timestamps, always non-negative. */
export function daysApart(isoA: string, isoB: string): number {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.MAX_SAFE_INTEGER;
  return Math.floor(Math.abs(a - b) / 86_400_000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Classify one candidate pair. Returns `null` when the pair does not
 * deserve a suggestion at all (the caller simply persists nothing).
 */
export function classifyDuplicatePair(input: DuplicatePairInput): ClassificationOutcome | null {
  const sameInstitution =
    input.institutionId !== null &&
    input.candidateInstitutionId !== null &&
    input.institutionId === input.candidateInstitutionId;
  const sameCategory = input.category === input.candidateCategory;
  const apart = daysApart(input.dateReceived, input.candidateDateReceived);
  const similarity = input.subjectSimilarity;

  // 1) Same source reference in the same source system = the same case.
  if (
    input.sourceReference !== null &&
    input.sourceReference === input.candidateSourceReference &&
    input.sourceSystem === input.candidateSourceSystem
  ) {
    return {
      suggestion: 'Potential duplicate',
      reason: `Same source reference (${input.sourceSystem}: ${input.sourceReference})`,
      signals: { source_reference_match: true },
    };
  }

  const normalizedSubject = normalizeSubject(input.subject);
  const normalizedCandidateSubject = normalizeSubject(input.candidateSubject);

  // 2) Identical normalized subject text.
  if (normalizedSubject.length > 0 && normalizedSubject === normalizedCandidateSubject) {
    // Different institutions cannot be the same case — related at most.
    if (
      input.institutionId !== null &&
      input.candidateInstitutionId !== null &&
      input.institutionId !== input.candidateInstitutionId
    ) {
      return {
        suggestion: 'Related but distinct',
        reason: 'Identical subject at a different institution',
        signals: { identical_subject: true, different_institution: true },
      };
    }
    return {
      suggestion: 'Potential duplicate',
      reason: 'Identical normalized subject',
      signals: { identical_subject: true },
    };
  }

  // 3) Same institution + same category, received close together.
  if (sameInstitution && sameCategory && apart <= POTENTIAL_DUPLICATE_WINDOW_DAYS) {
    return {
      suggestion: 'Potential duplicate',
      reason: `Same institution + same category + received ${apart} day${apart === 1 ? '' : 's'} apart`,
      signals: { same_institution: true, same_category: true, days_apart: apart },
    };
  }

  // 4) Same institution + same category, but far apart in time.
  if (sameInstitution && sameCategory) {
    return {
      suggestion: 'Related but distinct',
      reason: `Same institution and category but received ${apart} days apart`,
      signals: { same_institution: true, same_category: true, days_apart: apart },
    };
  }

  // 5) Text similarity carries the rest of the weight.
  if (similarity >= SUBJECT_SIMILARITY_THRESHOLD) {
    if (sameInstitution) {
      return {
        suggestion: 'Related but distinct',
        reason: `Similar subject at the same institution but different categories (similarity ${round2(similarity)})`,
        signals: { same_institution: true, subject_similarity: round2(similarity) },
      };
    }
    return {
      suggestion: 'Related but distinct',
      reason: `Similar subject at a different institution (similarity ${round2(similarity)})`,
      signals: { subject_similarity: round2(similarity) },
    };
  }

  // 6) Same institution alone is never enough (documented rule).
  return null;
}
