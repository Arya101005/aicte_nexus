/**
 * Institution name normalization — TypeScript mirror of the SQL
 * generated column `institutions.normalized_name`:
 *
 *   lower(regexp_replace(immutable_unaccent(btrim(name)), '\s+', ' ', 'g'))
 *
 * The SQL side is authoritative (it does the real `unaccent()`); this
 * mirror exists for import previews, client-side hints and unit tests.
 * ASCII names match exactly; exotic transliterations (ß, œ, …) are only
 * decided by SQL, never here.
 */
export function normalizeInstitutionName(name: string): string {
  return name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Two names that normalize identically are exact-match candidates. */
export function namesExactMatch(a: string, b: string): boolean {
  const na = normalizeInstitutionName(a);
  const nb = normalizeInstitutionName(b);
  return na.length > 0 && na === nb;
}
