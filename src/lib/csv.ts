/**
 * CSV safety utilities.
 *
 * Two directions, two threat models:
 *
 *  - EXPORT: spreadsheet formula injection. A cell beginning with `=`, `+`,
 *    `-`, `@`, tab or CR is executed as a formula by Excel/LibreOffice when
 *    the exported file is opened. We neutralize by prefixing a single quote,
 *    the standard escape that spreadsheet apps strip on display.
 *
 *  - IMPORT: resource exhaustion and malformed input. `parseCsv` enforces a
 *    byte-size limit and a row limit, understands RFC 4180 quoting, and
 *    reports the offending row/column on failure so callers can surface a
 *    friendly message and log details server-side.
 */

/** Hard ceiling for uploaded CSV files (bytes). */
export const CSV_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
/** Hard ceiling for data rows in one import. */
export const CSV_MAX_ROWS = 50_000;
/** Hard ceiling for columns in one import. */
export const CSV_MAX_COLUMNS = 64;

export class CsvParseError extends Error {
  /** 1-based line number in the source text, when known. */
  readonly line: number | undefined;
  /** 1-based column (character position) in the source text, when known. */
  readonly column: number | undefined;

  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'CsvParseError';
    this.line = line;
    this.column = column;
  }
}

const FORMULA_TRIGGER = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralize a value for safe export: cells starting with a formula trigger
 * character get a leading single quote so spreadsheets treat them as text.
 * Values that do not need it are returned unchanged (identity, no copy).
 */
export function neutralizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length > 0 && FORMULA_TRIGGER.has(text[0])) {
    return `'${text}`;
  }
  return text;
}

/**
 * Escape one value for inclusion in a CSV file:
 * formula-neutralized, then RFC 4180 quoted when it contains a quote,
 * comma, CR or LF. Always returns a string (null/undefined -> '').
 */
export function escapeCsvCell(value: unknown): string {
  const text = neutralizeCell(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize rows to a CSV document. Every cell passes through
 * `escapeCsvCell`, so exports are formula-injection safe by construction.
 */
export function toCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  // Trailing newline: tolerated by Excel, required by RFC 4180 consumers.
  return `${lines.join('\r\n')}\r\n`;
}

/** Result of a successful parse. Headers are trimmed of a UTF-8 BOM. */
export type ParsedCsv = {
  headers: string[];
  /** Rows keyed by header name, empty string when a cell is missing. */
  rows: Record<string, string>[];
};

/**
 * Parse CSV text into header-keyed rows.
 *
 * - Rejects input larger than `maxBytes` and results beyond `maxRows`.
 * - Handles RFC 4180 quoting: `"a,b"`, `""` escapes, embedded newlines,
 *   CRLF/LF/CR line endings.
 * - Throws `CsvParseError` (friendly message, row/column attached) on
 *   malformed input such as an unterminated quote or ragged rows.
 */
export function parseCsv(
  text: string,
  options: { maxBytes?: number; maxRows?: number; maxColumns?: number } = {},
): ParsedCsv {
  const maxBytes = options.maxBytes ?? CSV_MAX_BYTES;
  const maxRows = options.maxRows ?? CSV_MAX_ROWS;
  const maxColumns = options.maxColumns ?? CSV_MAX_COLUMNS;

  // Byte size, not character count: an upload limit is measured in bytes.
  const byteLength = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text).length
    : text.length;
  if (byteLength > maxBytes) {
    throw new CsvParseError(
      `File is too large (${byteLength} bytes). The limit is ${maxBytes} bytes.`,
    );
  }

  let input = text;
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1); // strip BOM

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let column = 1;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // Skip a completely empty trailing record (file ends with newline).
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record);
      if (records.length > maxRows) {
        throw new CsvParseError(
          `File has too many rows (limit ${maxRows}). Split the export before importing.`,
          line,
          column,
        );
      }
    }
    record = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    column++;

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
          column++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') {
          line++;
          column = 1;
        }
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (field.length > 0) {
        throw new CsvParseError(
          'Unexpected quote in the middle of a value. Quotes may only start a value.',
          line,
          column,
        );
      }
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      line++;
      column = 0;
      endRecord();
    } else if (ch === '\n') {
      line++;
      column = 0;
      endRecord();
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new CsvParseError('Unterminated quoted value at end of file.', line, column);
  }
  if (field.length > 0 || record.length > 0) {
    endRecord();
  }

  if (records.length === 0) {
    throw new CsvParseError('The file is empty or contains no rows.');
  }

  const headers = records[0].map((h) => h.trim());
  if (headers.length > maxColumns) {
    throw new CsvParseError(
      `Header row has ${headers.length} columns; the limit is ${maxColumns}.`,
    );
  }
  if (headers.some((h) => h.length === 0)) {
    throw new CsvParseError(
      `Header row has an empty column name at position ${headers.findIndex((h) => h.length === 0) + 1}.`,
      1,
    );
  }

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    if (cells.length > headers.length) {
      throw new CsvParseError(
        `Row ${r + 1} has ${cells.length} values but the header declares ${headers.length}.`,
        r + 1,
      );
    }
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? '';
    }
    rows.push(row);
  }

  return { headers, rows };
}
