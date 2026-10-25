#!/usr/bin/env node
/**
 * AICTE Nexus — migration + RLS verification harness.
 *
 * Runs against PGlite (real Postgres compiled to WASM) with a clean
 * database every time. Bootstraps the parts of the Supabase runtime the
 * migrations rely on (roles, `auth` schema, `auth.uid()`), then:
 *
 *   1. applies supabase/migrations/*.sql in order,
 *   2. applies supabase/seed.sql twice (proving the seed is idempotent),
 *   3. proves the security model:
 *        - read_only users cannot write anything,
 *        - a bureau official cannot read or modify another bureau's data,
 *        - complaint_audit rows can never be updated or deleted,
 *        - users cannot self-escalate their own role,
 *        - update_complaint_with_audit is atomic (complaint + audit commit
 *          together or not at all) and rejects unauthorized callers with
 *          friendly messages.
 *   4. checks the SQL-computed attention states on the seeded data.
 *
 * Usage: node scripts/verify-migrations.mjs   (or: npm run verify:db)
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// ------------------------------------------------------------
// Tiny assertion helpers
// ------------------------------------------------------------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
}
async function expectError(name, fn, includes = []) {
  try {
    await fn();
    check(name, false, 'expected an error, but the statement succeeded');
  } catch (e) {
    const msg = String(e?.message ?? e);
    const missing = includes.filter((s) => !msg.toLowerCase().includes(s.toLowerCase()));
    check(name, missing.length === 0, missing.length ? `error was: ${msg}` : '');
  }
}
async function count(sql, params = []) {
  const r = await db.query(sql, params);
  return Number(r.rows[0].n);
}

const db = new PGlite({ extensions: { pg_trgm, unaccent, pgcrypto } });

// ------------------------------------------------------------
// 0. Bootstrap the Supabase runtime pieces migrations assume
// ------------------------------------------------------------
console.log('== bootstrap: roles + auth schema ==');
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;

  create schema auth;
  create table auth.users (
    instance_id uuid,
    id uuid primary key default gen_random_uuid(),
    aud text,
    role text,
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create or replace function auth.uid()
  returns uuid
  language sql stable
  as $$
    select nullif(
      (coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'sub'),
      ''
    )::uuid
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to public;
`);

// Impersonation helpers -------------------------------------------------
async function asUser(userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
  await db.exec('set role authenticated');
}
async function asSuper() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", ['{}']);
}
async function asAnonymous() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", ['{}']);
  await db.exec('set role anon');
}

// ------------------------------------------------------------
// 1. Apply migrations in filename order
// ------------------------------------------------------------
console.log('== applying migrations ==');
const { readdirSync } = await import('node:fs');
const migrations = readdirSync(resolve(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
if (migrations.length === 0) throw new Error('no migrations found');
for (const m of migrations) {
  await db.exec(read(`supabase/migrations/${m}`));
  console.log(`  applied ${m}`);
}
check('all migrations apply on a clean database', true);

// ------------------------------------------------------------
// 2. Seed twice — must be idempotent
// ------------------------------------------------------------
console.log('== seeding ==');
const countTables = async () => ({
  profiles: await count('select count(*)::int as n from public.profiles'),
  institutions: await count('select count(*)::int as n from public.institutions'),
  identifiers: await count('select count(*)::int as n from public.institution_identifiers'),
  complaints: await count('select count(*)::int as n from public.complaints'),
  audit: await count('select count(*)::int as n from public.complaint_audit'),
  sla_rules: await count('select count(*)::int as n from public.sla_rules'),
  flags: await count('select count(*)::int as n from public.coordination_flags'),
});

await db.exec(read('supabase/seed.sql'));
const afterFirst = await countTables();
await db.exec(read('supabase/seed.sql'));
const afterSecond = await countTables();

check(
  'seed is idempotent (re-running changes no row counts)',
  JSON.stringify(afterFirst) === JSON.stringify(afterSecond),
  `${JSON.stringify(afterFirst)} vs ${JSON.stringify(afterSecond)}`,
);
check('seed created 5 demo users', afterFirst.profiles === 5, `got ${afterFirst.profiles}`);
check('seed created 5 institutions', afterFirst.institutions === 5, `got ${afterFirst.institutions}`);
check('seed created 8 complaints', afterFirst.complaints === 8, `got ${afterFirst.complaints}`);
check('seed created 4 SLA rules', afterFirst.sla_rules === 4, `got ${afterFirst.sla_rules}`);

// ------------------------------------------------------------
// Look up the demo actors
// ------------------------------------------------------------
const idOf = async (email) => {
  const r = await db.query('select id from auth.users where email = $1', [email]);
  if (r.rows.length === 0) throw new Error(`missing demo user ${email}`);
  return r.rows[0].id;
};
const adminId = await idOf('admin@nexus.local');
const aicteId = await idOf('aicte@nexus.local');
const viewerId = await idOf('viewer@nexus.local');
const reviewerId = await idOf('reviewer@nexus.local');
const refId = async (ref) =>
  (await db.query('select id from public.complaints where complaint_reference = $1', [ref])).rows[0].id;
const c1 = await refId('SYN-CMP-2026-001'); // AICTE
const c2 = await refId('SYN-CMP-2026-002'); // UGC
const c3 = await refId('SYN-CMP-2026-003'); // AICTE

// The seed assigns exactly one complaint to the AICTE official.
const c3Assignee = (await db.query('select assigned_to from public.complaints where id = $1', [c3])).rows[0]
  .assigned_to;
check(
  'seed assigns one complaint to the AICTE official',
  String(c3Assignee) === String(aicteId),
  `assignee=${c3Assignee}`,
);

// ------------------------------------------------------------
// 3a. Attention states (before any mutation tests)
// ------------------------------------------------------------
console.log('== attention states ==');
await asUser(reviewerId);
const slaRows = (await db.query(
  'select complaint_reference, attention_state from public.v_complaint_sla',
)).rows;
const stateOf = (ref) => slaRows.find((r) => r.complaint_reference === ref)?.attention_state;
check('reviewer sees all 8 complaints in v_complaint_sla', slaRows.length === 8, `got ${slaRows.length}`);
check('resolved complaint is Normal', stateOf('SYN-CMP-2026-005') === 'Normal', stateOf('SYN-CMP-2026-005'));
check(
  'past-due escalated complaint = Escalation Review Required',
  stateOf('SYN-CMP-2026-003') === 'Escalation Review Required',
  stateOf('SYN-CMP-2026-003'),
);
check(
  'due-soon complaint = Approaching Deadline',
  stateOf('SYN-CMP-2026-001') === 'Approaching Deadline',
  stateOf('SYN-CMP-2026-001'),
);
check(
  'healthy in-window complaint = Normal',
  stateOf('SYN-CMP-2026-002') === 'Normal',
  stateOf('SYN-CMP-2026-002'),
);

// ------------------------------------------------------------
// 3b. read_only cannot write anything
// ------------------------------------------------------------
console.log('== RLS: read_only user ==');
await asUser(viewerId);
check(
  'read_only reads all complaints (8)',
  (await count('select count(*)::int as n from public.complaints')) === 8,
);
await expectError(
  'read_only cannot insert a complaint',
  () => db.exec(
    "insert into public.complaints (bureau, complaint_reference, source_system, category, subject) " +
    "values ('AICTE', 'EVIL-1', 'manual', 'Misc', 'should fail')",
  ),
  ['row-level security'],
);
let upd = await db.query("update public.complaints set subject = 'hacked' returning id");
check('read_only cannot update any complaint', upd.rows.length === 0, `updated ${upd.rows.length}`);
const c1StillOpen = await db.query('select subject from public.complaints where id = $1', [c1]);
check('complaint data unchanged after read_only update attempt', c1StillOpen.rows[0].subject !== 'hacked');
upd = await db.query("update public.profiles set role = 'admin' where id = $1 returning id", [viewerId]);
check('read_only cannot self-escalate own role', upd.rows.length === 0, `updated ${upd.rows.length}`);
const viewerRole = (await db.query('select role from public.profiles where id = $1', [viewerId])).rows[0].role;
check('viewer role is still read_only', viewerRole === 'read_only', viewerRole);
await expectError(
  'update_complaint_with_audit rejects read_only with a friendly message',
  () => db.query('select * from public.update_complaint_with_audit($1, $2, null, null, null)', [c1, 'In Progress']),
  ['read-only access'],
);

// ------------------------------------------------------------
// 3c. Bureau isolation
// ------------------------------------------------------------
console.log('== RLS: bureau isolation ==');
await asUser(aicteId);
check(
  'AICTE official sees only AICTE complaints (4)',
  (await count('select count(*)::int as n from public.complaints')) === 4,
  `got ${await count('select count(*)::int as n from public.complaints')}`,
);
check(
  'AICTE official sees only AICTE rows in v_complaint_sla (4)',
  (await count('select count(*)::int as n from public.v_complaint_sla')) === 4,
);
check(
  'AICTE official sees zero UGC complaints',
  (await count('select count(*)::int as n from public.complaints where bureau = $1', ['UGC'])) === 0,
);
upd = await db.query("update public.complaints set subject = 'cross-bureau edit' where bureau = 'UGC' returning id");
check('AICTE official cannot update UGC complaints', upd.rows.length === 0, `updated ${upd.rows.length}`);
await expectError(
  'AICTE official cannot insert a UGC complaint',
  () => db.exec(
    "insert into public.complaints (bureau, complaint_reference, source_system, category, subject) " +
    "values ('UGC', 'CROSS-1', 'manual', 'Misc', 'should fail')",
  ),
  ['row-level security'],
);
await expectError(
  'AICTE official audit insert on UGC complaint is blocked by RLS',
  () => db.query(
    'insert into public.complaint_audit (complaint_id, action, changed_by) values ($1, $2, $3)',
    [c2, 'test', aicteId],
  ),
  ['row-level security'],
);
const ownAudit = await db.query(
  'insert into public.complaint_audit (complaint_id, action, changed_by) values ($1, $2, $3) returning id',
  [c1, 'note', aicteId],
);
check('AICTE official can write audit rows on own-bureau complaint', ownAudit.rows.length === 1);
await expectError(
  'update_complaint_with_audit hides other bureaus (complaint not found)',
  () => db.query('select * from public.update_complaint_with_audit($1, $2, null, null, null)', [c2, 'In Progress']),
  ['not found'],
);

// reviewer: reads all, writes nothing
await asUser(reviewerId);
check(
  'reviewer reads all complaints (8)',
  (await count('select count(*)::int as n from public.complaints')) === 8,
);
upd = await db.query("update public.complaints set subject = 'reviewer edit' returning id");
check('reviewer cannot update complaints', upd.rows.length === 0, `updated ${upd.rows.length}`);
await expectError(
  'update_complaint_with_audit rejects reviewer',
  () => db.query('select * from public.update_complaint_with_audit($1, $2, null, null, null)', [c1, 'In Progress']),
  ['cannot change complaints'],
);

// ------------------------------------------------------------
// 3d. Audit rows are immutable
// ------------------------------------------------------------
console.log('== RLS: audit immutability ==');
await asUser(adminId);
await expectError(
  'nobody can UPDATE complaint_audit rows',
  () => db.query("update public.complaint_audit set notes = 'tampered'"),
  ['permission denied'],
);
await expectError(
  'nobody can DELETE complaint_audit rows',
  () => db.query('delete from public.complaint_audit'),
  ['permission denied'],
);

// ------------------------------------------------------------
// 3e. Signed-out callers
// ------------------------------------------------------------
console.log('== auth: signed out ==');
await asAnonymous();
await expectError(
  'signed-out caller is rejected with a friendly message',
  () => db.query('select * from public.update_complaint_with_audit($1, $2, null, null, null)', [c1, 'In Progress']),
  ['signed out'],
);

// ------------------------------------------------------------
// 3f. Atomicity of update_complaint_with_audit
// ------------------------------------------------------------
console.log('== atomicity: complaint + audit ==');
await asSuper();
await db.exec(`
  create or replace function public.test_simulate_audit_failure()
  returns trigger language plpgsql as $$
  begin raise exception 'simulated audit failure'; end;
  $$;
  create trigger t_test_audit_fail
    before insert on public.complaint_audit
    for each row when (new.notes = 'FORCE_FAIL_TEST')
    execute function public.test_simulate_audit_failure();
`);

await asUser(adminId);
await expectError(
  'audit failure aborts the whole update',
  () => db.query(
    'select * from public.update_complaint_with_audit($1, $2, null, null, $3)',
    [c1, 'In Progress', 'FORCE_FAIL_TEST'],
  ),
  ['simulated audit failure'],
);
await asSuper();
const c1Status = (await db.query('select status from public.complaints where id = $1', [c1])).rows[0].status;
check('complaint rolled back after audit failure (still Open)', c1Status === 'Open', c1Status);
check(
  'no orphan audit row after failure',
  (await count(
    "select count(*)::int as n from public.complaint_audit where complaint_id = $1 and notes = 'FORCE_FAIL_TEST'",
    [c1],
  )) === 0,
);

await asUser(adminId);
const okCall = (
  await db.query(
    'select status from public.update_complaint_with_audit($1, $2, null, null, $3)',
    [c1, 'In Progress', 'admin moved it'],
  )
).rows;
check('admin update succeeds and returns the row', okCall.length === 1 && okCall[0].status === 'In Progress');
await asSuper();
const c1Status2 = (await db.query('select status from public.complaints where id = $1', [c1])).rows[0].status;
check('complaint persisted as In Progress', c1Status2 === 'In Progress', c1Status2);
const auditRow = (
  await db.query(
    "select action, old_value, new_value, changed_by from public.complaint_audit where complaint_id = $1 and notes = 'admin moved it'",
    [c1],
  )
).rows;
check(
  'audit row written with old/new values and actor',
  auditRow.length === 1 &&
    auditRow[0].action === 'status_update' &&
    auditRow[0].old_value === 'Open' &&
    auditRow[0].new_value === 'In Progress' &&
    String(auditRow[0].changed_by) === String(adminId),
  JSON.stringify(auditRow),
);
await db.exec('drop trigger t_test_audit_fail on public.complaint_audit; drop function public.test_simulate_audit_failure();');

// ------------------------------------------------------------
// 3g. Data integrity constraints
// ------------------------------------------------------------
console.log('== constraints ==');
await asUser(adminId);
await expectError(
  'duplicate (source_system, source_identifier) is rejected',
  () => db.query(
    "insert into public.institution_identifiers (institution_id, source_system, source_identifier) " +
    "select id, 'AICTE', 'SYN-AICTE-1998-001' from public.institutions limit 1",
  ),
  ['duplicate key'],
);
await expectError(
  'due date before received date is rejected',
  () => db.query(
    "insert into public.complaints (bureau, complaint_reference, source_system, category, subject, date_received, due_date) " +
    "values ('AICTE', 'BAD-DATE-1', 'manual', 'Misc', 'bad dates', now(), now() - interval '1 day')",
  ),
  ['due_after_received'],
);
await expectError(
  'self-signed duplicate complaint reference is rejected',
  () => db.query(
    "insert into public.complaints (bureau, complaint_reference, source_system, category, subject) " +
    "values ('AICTE', 'SYN-CMP-2026-001', 'manual', 'Misc', 'dupe ref')",
  ),
  ['duplicate key'],
);

// ------------------------------------------------------------
// Phase 3: institution identity resolution (candidates only)
// ------------------------------------------------------------
console.log('== Phase 3: institution identity resolution ==');
const instIds = {};
const instRows = (await db.query('select id, name from public.institutions')).rows;
for (const r of instRows) instIds[r.name] = r.id;
const inst01 = instIds['Suryagarh Institute of Technology'];

const bySource = (
  await db.query(
    "select * from public.find_institution_matches($1, null, 'AICTE', 'SYN-AICTE-1998-001', 10)",
    ['Totally Unrelated Placeholder Name'],
  )
).rows;
check(
  'source mapping match is Strong and points at the canonical institution',
  bySource.length > 0 &&
    bySource[0].match_category === 'Strong' &&
    String(bySource[0].matched_institution_id) === String(inst01) &&
    bySource[0].matching_factors?.source_mapping === 'verified',
  JSON.stringify(bySource[0]),
);

const byName = (
  await db.query("select * from public.find_institution_matches('Chandrika University', 'Kochi', null, null, 10)")
).rows;
check(
  'normalized-name exact match is Strong with no city conflict',
  byName.length > 0 &&
    byName[0].match_category === 'Strong' &&
    String(byName[0].matched_institution_id) === String(instIds['Chandrika University']) &&
    byName[0].matching_factors?.normalized_name_exact === true &&
    JSON.stringify(byName[0].conflicting_fields) === '{}',
  JSON.stringify(byName[0]),
);

const similarRows = (
  await db.query("select * from public.find_institution_matches('Chandrika Univ', 'Mumbai', null, null, 10)")
).rows;
const chandrikaCandidates = similarRows.filter(
  (r) => String(r.matched_institution_id) === String(instIds['Chandrika University']),
);
check(
  'similar name produces a review candidate (never Strong)',
  chandrikaCandidates.length > 0 && chandrikaCandidates.every((r) => r.match_category !== 'Strong'),
  JSON.stringify(chandrikaCandidates.map((r) => r.match_category)),
);
check(
  'conflicting city is surfaced to the reviewer',
  chandrikaCandidates[0]?.conflicting_fields?.city !== undefined,
  JSON.stringify(chandrikaCandidates[0]?.conflicting_fields),
);

const sameCityRows = (
  await db.query("select * from public.find_institution_matches('Chandrika Univ', 'Kochi', null, null, 10)")
).rows;
const chandrikaSameCity = sameCityRows.filter(
  (r) => String(r.matched_institution_id) === String(instIds['Chandrika University']),
);
check(
  'same city is offered as a matching factor',
  chandrikaSameCity[0]?.matching_factors?.same_city === true,
  JSON.stringify(chandrikaSameCity[0]?.matching_factors),
);
check(
  'matching never writes — candidates only, no auto-merge',
  (await count('select count(*)::int as n from public.institution_identity_reviews')) === 0,
);

// Propose + idempotency (as reviewer)
await asUser(reviewerId);
const proposed1 = (
  await db.query(
    "select * from public.propose_institution_matches('Deccan College of Engineering Pune', 'Pune', 'AICTE', 'SYN-NEW-0001', 5)",
  )
).rows;
const deccanCandidates = proposed1.filter(
  (r) => String(r.institution_id) === String(instIds['Deccan College of Engineering']),
);
check(
  'propose records review candidates (never Strong without verification)',
  proposed1.length > 0 &&
    deccanCandidates.length > 0 &&
    proposed1.every((r) => r.match_category !== 'Strong'),
  JSON.stringify(proposed1.map((r) => [r.institution_id, r.match_category])),
);
const reviewsAfterFirstPropose = await count(
  'select count(*)::int as n from public.institution_identity_reviews',
);
await db.query(
  "select * from public.propose_institution_matches('Deccan College of Engineering Pune', 'Pune', 'AICTE', 'SYN-NEW-0001', 5)",
);
check(
  're-proposing the same input does not duplicate pending candidates',
  (await count('select count(*)::int as n from public.institution_identity_reviews')) ===
    reviewsAfterFirstPropose,
);

// Reject records a reason (as admin)
await asUser(adminId);
const pendingDeccan = (
  await db.query(
    "select * from public.institution_identity_reviews where status = 'pending' and input_name = 'Deccan College of Engineering Pune'",
  )
).rows.find((r) => String(r.institution_id) === String(instIds['Deccan College of Engineering']));
const rejectedRow = (
  await db.query(
    "select * from public.decide_identity_review($1, 'rejected', 'Name is similar but the city does not match our records.')",
    [pendingDeccan.id],
  )
).rows;
check(
  'reject records status + reason',
  rejectedRow[0]?.status === 'rejected' && rejectedRow[0]?.reason?.includes('city does not match'),
  JSON.stringify([rejectedRow[0]?.status, rejectedRow[0]?.reason]),
);

// Confirm links a NEW source identifier (as reviewer)
await asUser(reviewerId);
const proposed2 = (
  await db.query(
    "select * from public.propose_institution_matches('Chandrika University', 'Kochi', 'UGC', 'SYN-UGC-NEW-42', 5)",
  )
).rows;
const chandrikaReview = proposed2.find(
  (r) =>
    String(r.institution_id) === String(instIds['Chandrika University']) && r.match_category === 'Strong',
);
check(
  'exact-name proposal carrying a new source key is Strong',
  chandrikaReview !== undefined,
  JSON.stringify(proposed2.map((r) => [r.institution_id, r.match_category])),
);
const decidedIdentity = (
  await db.query(
    "select * from public.decide_identity_review($1, 'confirmed', 'Same university, confirmed against UGC records.')",
    [chandrikaReview.id],
  )
).rows;
check(
  'confirm flips the review to confirmed',
  decidedIdentity[0]?.status === 'confirmed',
  decidedIdentity[0]?.status,
);
const linkedIdentifier = (
  await db.query(
    "select verification_status from public.institution_identifiers where source_system = 'UGC' and source_identifier = 'SYN-UGC-NEW-42'",
  )
).rows;
check(
  'confirm links the source identifier as verified',
  linkedIdentifier.length === 1 && linkedIdentifier[0].verification_status === 'verified',
  JSON.stringify(linkedIdentifier),
);

await asUser(viewerId);
await expectError(
  'read_only cannot decide identity matches',
  () =>
    db.query("select * from public.decide_identity_review($1, 'confirmed', 'nope')", [
      chandrikaReview.id,
    ]),
  ['Only admins and reviewers'],
);
await asUser(adminId);
await expectError(
  'a decided match cannot be decided again',
  () =>
    db.query("select * from public.decide_identity_review($1, 'rejected', 'changed my mind')", [
      chandrikaReview.id,
    ]),
  ['already been decided'],
);

// ------------------------------------------------------------
// Phase 3: duplicate / related-case detection
// ------------------------------------------------------------
console.log('== Phase 3: duplicate detection ==');
const c4 = await refId('SYN-CMP-2026-004'); // AICTE
const c6 = await refId('SYN-CMP-2026-006'); // UGC
const c7 = await refId('SYN-CMP-2026-007'); // AICTE — near-duplicate of 001
const c8 = await refId('SYN-CMP-2026-008'); // UGC — related case, same institution

await asUser(reviewerId);
const pairsFor1 = (await db.query('select * from public.get_duplicate_candidate_pairs($1, 50)', [c1])).rows;
const pair7 = pairsFor1.find((r) => r.candidate_reference === 'SYN-CMP-2026-007');
const pair8 = pairsFor1.find((r) => r.candidate_reference === 'SYN-CMP-2026-008');
check(
  'near-duplicate pair offered with deterministic signals',
  pair7 &&
    pair7.same_institution === true &&
    pair7.same_category === true &&
    pair7.days_apart <= 2 &&
    pair7.subject_similarity >= 0,
  JSON.stringify(pair7),
);
check(
  'distant same-institution case offered too (classifier decides the label)',
  pair8 && pair8.same_institution === true && pair8.days_apart >= 70,
  JSON.stringify(pair8),
);

// The classification + reason itself lives in src/lib/duplicates.ts
// (unit-tested against the labelled fixture set in Phase 7); here we
// verify persistence and workflow.
const suggestion1 = (
  await db.query('select * from public.upsert_duplicate_review($1, $2, $3, $4, $5, $6)', [
    c1,
    c7,
    'Potential duplicate',
    'Same institution + same category + received 1 days apart',
    JSON.stringify({ same_institution: true, same_category: true, days_apart: 1 }),
    0.4,
  ])
).rows;
check(
  'suggestion recorded with a human-readable reason',
  suggestion1[0]?.suggestion === 'Potential duplicate' && suggestion1[0]?.status === 'pending',
  JSON.stringify([suggestion1[0]?.suggestion, suggestion1[0]?.reason]),
);
const overwriteAttempt = (
  await db.query('select * from public.upsert_duplicate_review($1, $2, $3, $4, $5, $6)', [
    c7,
    c1,
    'Related but distinct',
    'attempted overwrite of an existing pair',
    '{}',
    0.1,
  ])
).rows;
check(
  'an existing pair is never overwritten (direction-insensitive)',
  overwriteAttempt[0]?.id === suggestion1[0].id &&
    overwriteAttempt[0]?.suggestion === 'Potential duplicate',
  JSON.stringify([overwriteAttempt[0]?.id, overwriteAttempt[0]?.suggestion]),
);

await asUser(viewerId);
await expectError(
  'read_only cannot create duplicate suggestions',
  () =>
    db.query('select * from public.upsert_duplicate_review($1, $2, $3, $4, $5, $6)', [
      c1,
      c7,
      'Potential duplicate',
      'x',
      '{}',
      0,
    ]),
  ['read-only access'],
);

await asUser(reviewerId);
const decidedDup = (
  await db.query(
    "select * from public.decide_duplicate_review($1, 'Confirmed duplicate', 'Same incident reported through both portals.')",
    [suggestion1[0].id],
  )
).rows;
check(
  'reviewer decision captured with status + reason',
  decidedDup[0]?.status === 'reviewed' && decidedDup[0]?.decision === 'Confirmed duplicate',
  JSON.stringify([decidedDup[0]?.status, decidedDup[0]?.decision]),
);
check(
  'duplicate decision appears in the complaint audit timeline',
  (await count(
    "select count(*)::int as n from public.complaint_audit where complaint_id = $1 and action = 'duplicate_decision'",
    [c1],
  )) === 1,
);
await expectError(
  'a reviewed suggestion cannot be reviewed again',
  () => db.query("select * from public.decide_duplicate_review($1, 'Not related', 'x')", [suggestion1[0].id]),
  ['already been reviewed'],
);
await asUser(viewerId);
await expectError(
  'read_only cannot decide duplicate suggestions',
  () => db.query("select * from public.decide_duplicate_review($1, 'Not related', 'x')", [suggestion1[0].id]),
  ['Only admins and reviewers'],
);

await asUser(reviewerId);
const pairsAfterReview = (
  await db.query('select * from public.get_duplicate_candidate_pairs($1, 50)', [c1])
).rows;
check(
  'reviewed pairs are never re-proposed, unreviewed ones remain',
  !pairsAfterReview.some((r) => r.candidate_reference === 'SYN-CMP-2026-007') &&
    pairsAfterReview.some((r) => r.candidate_reference === 'SYN-CMP-2026-008'),
);

// ------------------------------------------------------------
// Phase 3: cross-bureau coordination flags
// ------------------------------------------------------------
console.log('== Phase 3: cross-bureau coordination ==');
await asUser(viewerId);
await expectError(
  'read_only cannot refresh coordination flags',
  () => db.query('select public.refresh_coordination_flags()'),
  ['Only admins and reviewers'],
);
await asUser(aicteId);
await expectError(
  'bureau officials cannot refresh coordination flags',
  () => db.query('select public.refresh_coordination_flags()'),
  ['Only admins and reviewers'],
);

await asUser(reviewerId);
const refresh1 = (await db.query('select public.refresh_coordination_flags() as n')).rows[0].n;
check('refresh generates explainable flags', Number(refresh1) >= 4, `created ${refresh1}`);
const flagPending = async (complaintId, type) =>
  (await count(
    "select count(*)::int as n from public.coordination_flags where complaint_id = $1 and flag_type = $2 and review_status = 'pending'",
    [complaintId, type],
  ));
check(
  'multi-bureau institution flagged once (anchored on oldest open case)',
  (await flagPending(c8, 'multiple_bureaus')) === 1,
);
check(
  'deadline flags raised on every due-soon case',
  (await flagPending(c4, 'approaching_deadline')) === 1 &&
    (await flagPending(c6, 'approaching_deadline')) === 1 &&
    (await flagPending(c7, 'approaching_deadline')) === 1,
);
check(
  'an existing pending flag is not duplicated',
  (await flagPending(c1, 'approaching_deadline')) === 1,
);
const flagCountAfter1 = await count('select count(*)::int as n from public.coordination_flags');
const refresh2 = (await db.query('select public.refresh_coordination_flags() as n')).rows[0].n;
check(
  'refresh is idempotent (second run creates nothing)',
  Number(refresh2) === 0 &&
    (await count('select count(*)::int as n from public.coordination_flags')) === flagCountAfter1,
  `created ${refresh2}`,
);

// Decide a flag (reviewer) — audited on the complaint timeline
const flagOn4 = (
  await db.query(
    "select id from public.coordination_flags where complaint_id = $1 and flag_type = 'approaching_deadline'",
    [c4],
  )
).rows[0];
const decidedFlag = (
  await db.query(
    "select * from public.decide_coordination_flag($1, 'accepted', 'Follow-up scheduled with the bureau.')",
    [flagOn4.id],
  )
).rows;
check(
  'flag decision recorded with reviewer + notes',
  decidedFlag[0]?.review_status === 'accepted' &&
    String(decidedFlag[0]?.reviewed_by) === String(reviewerId) &&
    decidedFlag[0]?.decision_notes?.includes('Follow-up'),
  JSON.stringify([decidedFlag[0]?.review_status, decidedFlag[0]?.reviewed_by]),
);
check(
  'flag decision is audited on the complaint timeline',
  (await count(
    "select count(*)::int as n from public.complaint_audit where complaint_id = $1 and action = 'flag_decision'",
    [c4],
  )) === 1,
);
await expectError(
  'a decided flag cannot be decided again',
  () => db.query("select * from public.decide_coordination_flag($1, 'dismissed', 'x')", [flagOn4.id]),
  ['already been decided'],
);
const refresh3 = (await db.query('select public.refresh_coordination_flags() as n')).rows[0].n;
check(
  'an accepted flag blocks re-raising (no nagging loop)',
  Number(refresh3) === 0,
  `created ${refresh3}`,
);

// Assign a reviewer (admin) — also audited
await asUser(adminId);
const flagOn6 = (
  await db.query(
    "select id from public.coordination_flags where complaint_id = $1 and flag_type = 'approaching_deadline'",
    [c6],
  )
).rows[0];
const assigned = (
  await db.query('select * from public.assign_coordination_flag($1, $2)', [flagOn6.id, reviewerId])
).rows;
check(
  'admin can assign a reviewer to a flag',
  String(assigned[0]?.assigned_to) === String(reviewerId),
  assigned[0]?.assigned_to,
);
check(
  'flag assignment is audited',
  (await count(
    "select count(*)::int as n from public.complaint_audit where complaint_id = $1 and action = 'flag_assigned'",
    [c6],
  )) === 1,
);
await expectError(
  'non-reviewers cannot be assigned flags',
  () => db.query('select * from public.assign_coordination_flag($1, $2)', [flagOn6.id, viewerId]),
  ['not a reviewer'],
);

// ------------------------------------------------------------
// Phase 3: cross-bureau views
// ------------------------------------------------------------
console.log('== Phase 3: cross-bureau views ==');
await asUser(reviewerId);
const xb = (
  await db.query('select * from public.v_institution_cross_bureau where institution_id = $1', [inst01])
).rows;
check(
  'cross-bureau overview groups an institution by bureau',
  xb.length === 2,
  `rows ${xb.length}`,
);
check(
  'cross-bureau overview counts active cases per bureau from the database',
  xb.reduce((sum, r) => sum + Number(r.active_cases), 0) === 4,
  JSON.stringify(xb.map((r) => [r.bureau, r.active_cases])),
);
const ov = (
  await db.query('select * from public.v_institution_overview where id = $1', [inst01])
).rows;
check(
  'institution overview rolls up counts from the database',
  Number(ov[0]?.complaint_count) === 4 &&
    Number(ov[0]?.bureau_count) === 2 &&
    Number(ov[0]?.identifier_count) === 1,
  JSON.stringify(ov[0]),
);
await asUser(aicteId);
const xbAicte = (
  await db.query('select * from public.v_institution_cross_bureau where institution_id = $1', [inst01])
).rows;
check(
  'cross-bureau view respects bureau RLS (security_invoker)',
  xbAicte.length === 1 && xbAicte[0].bureau === 'AICTE',
  JSON.stringify(xbAicte.map((r) => r.bureau)),
);

// ------------------------------------------------------------
// Summary
// ------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('----------------------------------------');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
await db.close();
process.exit(failed.length > 0 ? 1 : 0);
