/**
 * Import adapters: parse -> validate -> normalize -> (upsert via RPC).
 *
 * This module owns the first three stages and is pure, so every rule is
 * unit-testable without a database. The final `upsert` stage runs on the
 * server through `public.upsert_complaint_from_import`, which is keyed on
 * (source_system, source_reference) — so re-importing a file is a no-op.
 *
 * Security posture:
 *  - Upload size/row limits enforced by `parseCsv` (5 MiB / 50 000 rows).
 *  - Cells are stored raw; formula neutralization happens on EXPORT
 *    (`escapeCsvCell`) and on rejected-cell capture (`record_import_error`).
 *  - No silent coercion: invalid enums, dates or required values become
 *    per-row errors with field + reason, never a guessed value.
 */

import { CSV_MAX_BYTES, CsvParseError, parseCsv } from '../csv';

export const IMPORT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export const IMPORT_STATUSES = [
  'Open',
  'In Progress',
  'Awaiting Information',
  'Resolved',
  'Closed',
] as const;

export type ComplaintDraft = {
  rowNumber: number;
  sourceSystem: string;
  sourceReference: string;
  complaintReference: string;
  bureau: string;
  category: string;
  priority: (typeof IMPORT_PRIORITIES)[number];
  status: (typeof IMPORT_STATUSES)[number];
  subject: string;
  description: string | null;
  dateReceived: string | null; // ISO timestamp
  dueDate: string | null;
  resolvedAt: string | null;
  institutionName: string | null;
};

export type RowError = {
  row: number;
  field: string;
  reason: string;
  rawValue?: string;
};

export type ValidationResult = {
  drafts: ComplaintDraft[];
  errors: RowError[];
};

/** Column names accepted in CSV headers and JSON keys (snake_case). */
const FIELDS = [
  'source_system',
  'source_reference',
  'complaint_reference',
  'bureau',
  'category',
  'priority',
  'status',
  'subject',
  'description',
  'date_received',
  'due_date',
  'resolved_at',
  'institution_name',
] as const;

const REQUIRED = [
  'source_system',
  'source_reference',
  'complaint_reference',
  'bureau',
  'category',
  'priority',
  'status',
  'subject',
] as const;

const clean = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const collapse = (v: unknown): string => clean(v).replace(/\s+/g, ' ');

/** Parse one timestamp field: empty -> null, unparseable -> undefined (error). */
function parseDate(raw: string): string | null | undefined {
  if (raw === '') return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

/**
 * Validate + normalize already-parsed records (one object per row).
 * `firstRowNumber` is 1-based and points at the first data row (2 when a
 * CSV header row preceded it), so errors line up with what users see.
 */
export function validateComplaintRows(
  records: Record<string, unknown>[],
  firstRowNumber: number,
): ValidationResult {
  const drafts: ComplaintDraft[] = [];
  const errors: RowError[] = [];

  records.forEach((record, i) => {
    const row = firstRowNumber + i;
    const rowErrors: RowError[] = [];

    const values: Record<string, string> = {};
    for (const field of FIELDS) {
      values[field] = clean(record[field]);
    }

    for (const field of REQUIRED) {
      if (values[field] === '') {
        rowErrors.push({ row, field, reason: `Required value "${field}" is missing.` });
      }
    }
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    if (!(IMPORT_PRIORITIES as readonly string[]).includes(values.priority)) {
      errors.push({
        row,
        field: 'priority',
        reason: `Unknown priority "${values.priority}". Allowed: ${IMPORT_PRIORITIES.join(', ')}.`,
        rawValue: values.priority,
      });
      return;
    }
    if (!(IMPORT_STATUSES as readonly string[]).includes(values.status)) {
      errors.push({
        row,
        field: 'status',
        reason: `Unknown status "${values.status}". Allowed: ${IMPORT_STATUSES.join(', ')}.`,
        rawValue: values.status,
      });
      return;
    }

    const dateReceived = parseDate(values.date_received);
    const dueDate = parseDate(values.due_date);
    const resolvedAt = parseDate(values.resolved_at);
    for (const [field, parsed] of [
      ['date_received', dateReceived],
      ['due_date', dueDate],
      ['resolved_at', resolvedAt],
    ] as const) {
      if (parsed === undefined) {
        errors.push({
          row,
          field,
          reason: `"${values[field]}" is not a recognizable date.`,
          rawValue: values[field],
        });
      }
    }
    if (dateReceived === undefined || dueDate === undefined || resolvedAt === undefined) {
      return;
    }

    if (dateReceived !== null && dueDate !== null && Date.parse(dueDate) < Date.parse(dateReceived)) {
      errors.push({
        row,
        field: 'due_date',
        reason: 'Due date is before the received date.',
        rawValue: values.due_date,
      });
      return;
    }

    const needsResolution =
      values.status === 'Resolved' || values.status === 'Closed';
    if (needsResolution && resolvedAt === null) {
      errors.push({
        row,
        field: 'resolved_at',
        reason: `Status "${values.status}" requires a resolution date.`,
      });
      return;
    }

    drafts.push({
      rowNumber: row,
      sourceSystem: values.source_system,
      sourceReference: values.source_reference,
      complaintReference: values.complaint_reference,
      bureau: collapse(record.bureau),
      category: collapse(record.category),
      priority: values.priority as ComplaintDraft['priority'],
      status: values.status as ComplaintDraft['status'],
      subject: collapse(record.subject),
      description: values.description === '' ? null : clean(record.description),
      dateReceived,
      dueDate,
      resolvedAt,
      institutionName: values.institution_name === '' ? null : collapse(record.institution_name),
    });
  });

  return { drafts, errors };
}

/** CSV upload: size-limited parse, then per-row validation. */
export function parseComplaintCsv(text: string): ValidationResult {
  const { headers, rows } = parseCsv(text); // throws CsvParseError on malformed input
  const unknownHeaders = headers.filter((h) => !(FIELDS as readonly string[]).includes(h));
  if (unknownHeaders.length > 0) {
    throw new CsvParseError(
      `Unknown column(s): ${unknownHeaders.join(', ')}. Allowed columns: ${FIELDS.join(', ')}.`,
      1,
    );
  }
  return validateComplaintRows(rows, 2); // row 1 is the header
}

/** JSON upload: same shape as the CSV columns, array of objects. */
export function parseComplaintJson(text: string): ValidationResult {
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > CSV_MAX_BYTES) {
    throw new CsvParseError(
      `File is too large (${byteLength} bytes). The limit is ${CSV_MAX_BYTES} bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CsvParseError('File is not valid JSON. Expected an array of complaint objects.');
  }
  if (!Array.isArray(parsed)) {
    throw new CsvParseError('JSON import must be an array of complaint objects.');
  }
  const records: Record<string, unknown>[] = [];
  parsed.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new CsvParseError(`Item ${i + 1} is not an object.`);
    }
    records.push(item as Record<string, unknown>);
  });
  return validateComplaintRows(records, 1); // JSON arrays have no header row
}
