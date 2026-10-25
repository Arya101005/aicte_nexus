/**
 * Labelled fixture set for duplicate classification.
 *
 * Each fixture is a candidate pair with the outcome a reviewer would
 * expect. The Phase 7 test runs `classifyDuplicatePair` over this set
 * and reports precision, recall, false positives and false negatives
 * for the positive class ("Potential duplicate"), so classifier changes
 * are measured instead of assumed.
 *
 * Fixtures are synthetic and ASCII-only (SQL unaccent handles exotic
 * transliterations; parity with it is asserted separately).
 */

import type { DuplicatePairInput } from './duplicates';

export type FixtureLabel = 'Potential duplicate' | 'Related but distinct' | 'none';

export type DuplicateFixture = {
  name: string;
  input: DuplicatePairInput;
  expected: FixtureLabel;
};

const base = (overrides: Partial<DuplicatePairInput>): DuplicatePairInput => ({
  complaintId: 'f0000000-0000-0000-0000-000000000001',
  candidateId: 'f0000000-0000-0000-0000-000000000002',
  complaintReference: 'SYN-FIX-001',
  candidateReference: 'SYN-FIX-002',
  institutionId: 'inst-0001',
  candidateInstitutionId: 'inst-0001',
  category: 'Facilities',
  candidateCategory: 'Facilities',
  bureau: 'AICTE',
  candidateBureau: 'AICTE',
  sourceSystem: 'AICTE',
  sourceReference: null,
  candidateSourceSystem: 'AICTE',
  candidateSourceReference: null,
  dateReceived: '2026-01-10T10:00:00.000Z',
  candidateDateReceived: '2026-01-12T10:00:00.000Z',
  subject: 'Hostel maintenance backlog',
  candidateSubject: 'Hostel maintenance backlog',
  subjectSimilarity: 1,
  ...overrides,
});

export const duplicateFixtures: DuplicateFixture[] = [
  // --- positives: should be classified "Potential duplicate" -----------
  {
    name: 'same source reference in the same source system',
    input: base({
      sourceReference: 'AICTE-REF-77',
      candidateSourceReference: 'AICTE-REF-77',
      subject: 'Different wording entirely',
      candidateSubject: 'Completely unrelated text',
      subjectSimilarity: 0.12,
    }),
    expected: 'Potential duplicate',
  },
  {
    name: 'identical subject at the same institution',
    input: base({
      subject: 'Bus route cancelled for evening batch',
      candidateSubject: '  BUS ROUTE CANCELLED for evening batch  ',
      subjectSimilarity: 1,
    }),
    expected: 'Potential duplicate',
  },
  {
    name: 'same institution + same category, 1 day apart',
    input: base({
      subject: 'Delayed hostel repairs in block C',
      candidateSubject: 'Hostel repair work taking too long',
      subjectSimilarity: 0.41,
      candidateDateReceived: '2026-01-11T10:00:00.000Z',
    }),
    expected: 'Potential duplicate',
  },
  {
    name: 'same institution + same category, exactly 30 days apart',
    input: base({
      subject: 'Lab equipment not serviced',
      candidateSubject: 'Annual lab service overdue',
      subjectSimilarity: 0.3,
      candidateDateReceived: '2026-02-09T10:00:00.000Z',
    }),
    expected: 'Potential duplicate',
  },
  {
    name: 'identical subject, institution unknown on both sides',
    input: base({
      institutionId: null,
      candidateInstitutionId: null,
      subject: 'Scholarship disbursement delayed',
      candidateSubject: 'scholarship disbursement delayed',
      subjectSimilarity: 1,
    }),
    expected: 'Potential duplicate',
  },

  // --- related: should be classified "Related but distinct" ------------
  {
    name: 'same institution + same category, 74 days apart',
    input: base({
      subject: 'Delayed hostel repairs in block C',
      candidateSubject: 'Workshop seating shortage',
      subjectSimilarity: 0.18,
      candidateDateReceived: '2026-03-25T10:00:00.000Z',
    }),
    expected: 'Related but distinct',
  },
  {
    name: 'identical subject at a different institution',
    input: base({
      candidateInstitutionId: 'inst-0002',
      subject: 'Anti-ragging committee not constituted',
      candidateSubject: 'Anti-ragging committee not constituted',
      subjectSimilarity: 1,
    }),
    expected: 'Related but distinct',
  },
  {
    name: 'same institution, different category, very similar subject',
    input: base({
      candidateCategory: 'Hostel',
      subject: 'Mess food quality complaints raised repeatedly',
      candidateSubject: 'Mess food quality complaint raised repeatedly',
      subjectSimilarity: 0.92,
    }),
    expected: 'Related but distinct',
  },
  {
    name: 'different institution, highly similar subject',
    input: base({
      candidateInstitutionId: 'inst-0002',
      candidateCategory: 'Academic',
      subject: 'Exam results delayed for final semester',
      candidateSubject: 'Final semester exam results are delayed',
      subjectSimilarity: 0.71,
    }),
    expected: 'Related but distinct',
  },
  {
    name: 'same institution + same category but 45 days apart and unrelated text',
    input: base({
      subject: 'Electrical safety inspection pending',
      candidateSubject: 'Scholarship disbursement delayed',
      subjectSimilarity: 0.09,
      candidateDateReceived: '2026-02-24T10:00:00.000Z',
    }),
    expected: 'Related but distinct',
  },

  // --- negatives: no suggestion at all ---------------------------------
  {
    name: 'same institution alone with unrelated subjects',
    input: base({
      candidateCategory: 'Anti-ragging',
      subject: 'Electrical safety inspection pending',
      candidateSubject: 'Scholarship disbursement delayed',
      subjectSimilarity: 0.1,
    }),
    expected: 'none',
  },
  {
    name: 'same category, different institutions, weak similarity',
    input: base({
      candidateInstitutionId: 'inst-0002',
      subject: 'Parking allocation unfair',
      candidateSubject: 'Library extended hours requested',
      subjectSimilarity: 0.22,
    }),
    expected: 'none',
  },
];
