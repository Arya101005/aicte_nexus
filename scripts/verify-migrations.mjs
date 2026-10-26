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
// Phase 4: import pipeline (idempotent by stable source keys)
// ------------------------------------------------------------
console.log('== Phase 4: import pipeline ==');
const complaintsCount = () => count('select count(*)::int as n from public.complaints');

// Data Health is honest before anything is configured.
await asSuper();
const health0 = (
  await db.query('select source_system, health_state from public.v_source_health order by source_system')
).rows;
check(
  'data health reports Not configured before any import',
  health0.length > 0 && health0.every((r) => r.health_state === 'Not configured'),
  JSON.stringify(health0),
);

await asUser(viewerId);
await expectError(
  'read_only cannot run imports',
  () => db.query('select public.begin_import_job($1, $2, $3)', ['x.csv', 'TESTSRC', 'complaints']),
  ['Only administrators'],
);

await asUser(adminId);
const fileA = [
  'TESTSRC',
  'SRC-100',
  'IMP-2026-001',
  'AICTE',
  'Facilities',
  'Medium',
  'Open',
  'Imported canteen complaint',
  'Synthetic row created by the import pipeline check.',
  new Date(Date.now() - 3 * 86_400_000).toISOString(),
  null, // due date deliberately absent: no invented deadlines
  null,
  null,
  'Nonexistent Polytechnic of Technology', // must stay unresolved (exact match only)
];

const job1 = (
  await db.query("select * from public.begin_import_job('complaints.csv', 'TESTSRC', 'complaints')")
).rows[0];
check(
  'import job starts as running',
  job1?.status === 'running' && Boolean(job1?.started_at),
  JSON.stringify([job1?.status, job1?.started_at]),
);
const beforeImport = await complaintsCount();
const u1 = (await db.query('select public.upsert_complaint_from_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as r', fileA)).rows[0].r;
check(
  'new row is created and unmatched institution stays unresolved',
  u1.result === 'created' && u1.institution_note === 'institution_unmatched' && u1.institution_id === null,
  JSON.stringify(u1),
);
check('complaint count grew by exactly one', (await complaintsCount()) === beforeImport + 1);

const err1 = (
  await db.query(
    'select * from public.record_import_error($1, $2, $3, $4, $5)',
    [job1.id, 2, 'priority', 'Unknown priority "Critical"', '=CMD()'],
  )
).rows[0];
check(
  'rejected row captured with formula-neutralized value',
  err1?.raw_value === '=CMD()' && err1?.neutralized_value === "'=CMD()",
  JSON.stringify([err1?.raw_value, err1?.neutralized_value]),
);
const fin1 = (
  await db.query('select * from public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    job1.id, 'completed', 2, 1, 0, 0, 1, 0, '{}',
  ])
).rows[0];
check(
  'import job finishes with counts + timestamps',
  fin1?.status === 'completed' && Number(fin1?.created_rows) === 1 && Number(fin1?.rejected_rows) === 1 && Boolean(fin1?.completed_at),
  JSON.stringify([fin1?.status, fin1?.created_rows, fin1?.rejected_rows]),
);check(
  'rejected rows immediately put the source in Awaiting verification',
  (await db.query("select health_state from public.v_source_health where source_system = 'TESTSRC'"))
    .rows[0]?.health_state === 'Awaiting verification',
);

// THE headline idempotency claim: replay file A -> zero duplicates.
const countAfterJob1 = await complaintsCount();
const job2 = (
  await db.query("select * from public.begin_import_job('complaints.csv', 'TESTSRC', 'complaints')")
).rows[0];
const u2 = (await db.query('select public.upsert_complaint_from_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as r', fileA)).rows[0].r;
await db.query('select public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
  job2.id, 'completed', 2, 0, 0, 1, 1, 0, '{}',
]);
check(
  're-importing the same file creates zero duplicates (row is unchanged)',
  u2.result === 'unchanged' && (await complaintsCount()) === countAfterJob1,
  JSON.stringify([u2.result, await complaintsCount()]),
);

// A changed file updates in place; a changed reference is flagged, not lost.
const fileB = [...fileA];
fileB[2] = 'IMP-2026-001B';
fileB[7] = 'Imported canteen complaint - updated';
const job3 = (
  await db.query("select * from public.begin_import_job('complaints-v2.csv', 'TESTSRC', 'complaints')")
).rows[0];
const u3 = (await db.query('select public.upsert_complaint_from_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as r', fileB)).rows[0].r;
await db.query('select public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
  job3.id, 'completed', 1, 0, 1, 0, 0, 0, '{}',
]);
check(
  'changed reference on the same source key is reported as conflicting',
  u3.result === 'conflicting',
  JSON.stringify(u3),
);
const job4 = (
  await db.query("select * from public.begin_import_job('complaints-v2.csv', 'TESTSRC', 'complaints')")
).rows[0];
const u4 = (await db.query('select public.upsert_complaint_from_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as r', fileB)).rows[0].r;
await db.query('select public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
  job4.id, 'completed', 1, 0, 0, 1, 0, 0, '{}',
]);
check('replaying the changed file is also unchanged', u4.result === 'unchanged', JSON.stringify(u4));

await expectError(
  'import rows without source keys are rejected up front',
  () =>
    db.query('select public.upsert_complaint_from_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as r', [
      'TESTSRC', '', 'IMP-X', 'AICTE', 'Facilities', 'Medium', 'Open', 'x',
      null, null, null, null, null, null,
    ]),
  ['required'],
);

// Reconciliation: absent rows are reported, never deleted.
await asUser(reviewerId);
const missingRows = (
  await db.query("select * from public.find_missing_from_export('AICTE', array['SYN-AICTE-REF-001'])")
).rows;
check(
  'missing-from-export reports every absent record with a never-delete note',
  missingRows.length === 3 && missingRows.every((r) => r.note.includes('never deleted')),
  JSON.stringify(missingRows.map((r) => r.missing_reference)),
);
check('absence from an export never deletes a record', (await complaintsCount()) === countAfterJob1 + 0 + 0, `count ${await complaintsCount()}`);

// Health states: Failed, Delayed, Awaiting verification.
await asUser(adminId);
const job5 = (
  await db.query("select * from public.begin_import_job('ugc.csv', 'UGC', 'complaints')")
).rows[0];
await db.query('select public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
  job5.id, 'failed', 0, 0, 0, 0, 0, 3, JSON.stringify({ error: 'malformed rows' }),
]);
const ugcHealth = (
  await db.query("select health_state from public.v_source_health where source_system = 'UGC'")
).rows[0]?.health_state;
check('a failed latest import reports Failed', ugcHealth === 'Failed', ugcHealth);

const job6 = (
  await db.query("select * from public.begin_import_job('aicte.csv', 'AICTE', 'complaints')")
).rows[0];
await db.query('select public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
  job6.id, 'completed', 0, 0, 0, 0, 0, 0, '{}',
]);
const aicteHealthy = (
  await db.query("select health_state from public.v_source_health where source_system = 'AICTE'")
).rows[0]?.health_state;
check('a recent clean import reports Healthy', aicteHealthy === 'Healthy', aicteHealthy);

await asSuper();
await db.query(
  'update public.import_jobs set created_at = now() - interval \'9 days\', started_at = now() - interval \'9 days\', completed_at = now() - interval \'9 days\' + interval \'1 minute\' where id = $1',
  [job6.id],
);
await asUser(reviewerId);
const aicteDelayed = (
  await db.query("select health_state from public.v_source_health where source_system = 'AICTE'")
).rows[0]?.health_state;
check('an import older than 7 days reports Delayed', aicteDelayed === 'Delayed', aicteDelayed);

await asUser(adminId);
const job7 = (
  await db.query("select * from public.begin_import_job('aicte-v2.csv', 'AICTE', 'complaints')")
).rows[0];
await db.query('select public.finish_import_job($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
  job7.id, 'completed', 5, 4, 0, 0, 1, 0, '{}',
]);
await asUser(reviewerId);
const aicteAwaiting = (
  await db.query("select health_state from public.v_source_health where source_system = 'AICTE'")
).rows[0]?.health_state;
check(
  'rejected rows put the source in Awaiting verification',
  aicteAwaiting === 'Awaiting verification',
  aicteAwaiting,
);

// ------------------------------------------------------------
// Phase 4: notifications (persisted, deduped, per-user)
// ------------------------------------------------------------
console.log('== Phase 4: notifications ==');
await asSuper();
const ugcId = await idOf('ugc@nexus.local');
await asUser(adminId);
// Assigning a complaint notifies exactly once (dedupe key = audit event).
await db.query('select * from public.update_complaint_with_audit($1, $2, $3, $4, $5)', [
  c2, null, null, ugcId, 'Phase 4 assignment check',
]);
await asSuper(); // cross-user notification rows are hidden by RLS from `authenticated`
const ugcNotifs1 = (
  await db.query("select * from public.notifications where user_id = $1 and type = 'assignment'", [ugcId])
).rows;
check(
  'assignment creates one notification for the assignee',
  ugcNotifs1.length === 1 && ugcNotifs1[0].read_at === null,
  `count ${ugcNotifs1.length}`,
);
await asUser(adminId);
await db.query('select * from public.update_complaint_with_audit($1, $2, $3, $4, $5)', [
  c2, null, null, ugcId, 'Phase 4 assignment check repeated',
]);
await asSuper();
const ugcNotifs2 = (
  await db.query("select * from public.notifications where user_id = $1 and type = 'assignment'", [ugcId])
).rows;
check('re-processing the same assignment creates no repeat', ugcNotifs2.length === 1, `count ${ugcNotifs2.length}`);

// Prepare events for refresh_notifications.
await asUser(reviewerId);
const flagOn6Decision = (
  await db.query(
    "select * from public.decide_coordination_flag($1, 'accepted', 'Coordinated with the other bureau on this deadline.')",
    [flagOn6.id],
  )
).rows;
check('flag decision still works after migration 0004', flagOn6Decision[0]?.review_status === 'accepted');
await db.query('select * from public.upsert_duplicate_review($1, $2, $3, $4, $5, $6)', [
  c1,
  c8,
  'Related but distinct',
  'Same institution and category but received 74 days apart',
  JSON.stringify({ same_institution: true, same_category: true, days_apart: 74 }),
  0.2,
]);

const n1 = (await db.query('select public.refresh_notifications() as n')).rows[0].n;
check(
  'refresh creates exactly the expected notifications',
  Number(n1) === 4,
  `created ${n1}`,
);
const n2 = (await db.query('select public.refresh_notifications() as n')).rows[0].n;
check('notification refresh is idempotent (dedupe keys)', Number(n2) === 0, `created ${n2}`);

// Type-wide counts: read as superuser (owners only see their own rows).
await asSuper();
check(
  'pending duplicate suggestion notifies reviewers + admins',
  (await count("select count(*)::int as n from public.notifications where type = 'duplicate_review'")) === 2,
);
check(
  'failed import notifies admins',
  (await count("select count(*)::int as n from public.notifications where type = 'import_failed'")) === 1,
);
check(
  'accepted assigned flag notifies its reviewer',
  (await count("select count(*)::int as n from public.notifications where type = 'coordination_resolved'")) === 1,
);
const adminDupNotif = (
  await db.query("select id from public.notifications where type = 'duplicate_review' and user_id = $1", [adminId])
).rows[0];

await asUser(viewerId);
await expectError(
  'read_only cannot refresh notifications',
  () => db.query('select public.refresh_notifications()'),
  ['Only admins and reviewers'],
);
await expectError(
  'users cannot mark someone else\'s notification read',
  () => db.query('select public.mark_notification_read($1)', [adminDupNotif.id]),
  ['Notification not found'],
);
await asUser(adminId);
const markedRead = (
  await db.query('select * from public.mark_notification_read($1)', [adminDupNotif.id])
).rows;
check('owner can mark their notification read', Boolean(markedRead[0]?.read_at), markedRead[0]?.read_at);

// ------------------------------------------------------------
// Phase 4: data quality metrics (errors vs warnings)
// ------------------------------------------------------------
console.log('== Phase 4: data quality ==');
await asUser(reviewerId);
const quality = (metric) =>
  db.query('select metric_count from public.v_data_quality where metric = $1', [metric]).then(
    (r) => Number(r.rows[0]?.metric_count),
  );
check('constraint-proven: complaints always have a Bureau', (await quality('complaints without a Bureau')) === 0);
check(
  'constraint-proven: no invalid or inconsistent dates',
  (await quality('invalid or inconsistent dates')) === 0,
);
check(
  'imported complaint without an institution is surfaced as a warning',
  (await quality('complaints without an institution link')) === 1,
);
check('pending identifier verifications counted', (await quality('pending identifier verifications')) === 1);
check('disputed identifiers counted as errors', (await quality('disputed identifier verifications')) === 1);
check('failed imports counted as errors', (await quality('failed imports')) === 1);
check('pending duplicate suggestions counted', (await quality('pending duplicate suggestions')) === 1);
check('open coordination flags counted', (await quality('open coordination flags')) === 4);

// ------------------------------------------------------------
// Phase 4: SLA summary + report overview (server-side aggregates)
// ------------------------------------------------------------
console.log('== Phase 4: SLA summary + reports ==');
const slaSummary = (
  await db.query('select * from public.get_sla_summary($1, $2)', [
    new Date(Date.now() - 180 * 86_400_000).toISOString(),
    new Date().toISOString(),
  ])
).rows;
const slaOf = (bureau) => slaSummary.find((r) => r.bureau === bureau);
const aicteSla = slaOf('AICTE');
const ugcSla = slaOf('UGC');
check(
  'SLA summary counts open/approaching/overdue per bureau from SQL',
  Number(aicteSla?.open_cases) === 5 &&
    Number(aicteSla?.approaching) === 3 &&
    Number(aicteSla?.overdue) === 1 &&
    Number(aicteSla?.awaiting_info) === 1 &&
    Number(aicteSla?.stale) === 1,
  JSON.stringify(aicteSla),
);
check(
  'UGC SLA row: open 3, approaching 1, none overdue/stale',
  Number(ugcSla?.open_cases) === 3 &&
    Number(ugcSla?.approaching) === 1 &&
    Number(ugcSla?.overdue) === 0 &&
    Number(ugcSla?.stale) === 0,
  JSON.stringify(ugcSla),
);
check(
  'average resolution only reported with valid samples',
  Number(ugcSla?.resolution_samples) === 1 &&
    Math.abs(Number(ugcSla?.avg_resolution_days) - 13) < 0.1 &&
    Number(aicteSla?.resolution_samples) === 0 &&
    aicteSla?.avg_resolution_days === null,
  JSON.stringify([ugcSla?.avg_resolution_days, aicteSla?.avg_resolution_days]),
);

const overview = (
  await db.query('select * from public.get_report_overview($1, $2, $3)', [
    new Date(Date.now() - 180 * 86_400_000).toISOString(),
    new Date().toISOString(),
    null,
  ])
).rows[0];
check(
  'report overview aggregates the database (not the client)',
  Number(overview?.total_received) === 9 &&
    Number(overview?.open_now) === 8 &&
    Number(overview?.resolved_in_period) === 1 &&
    Number(overview?.overdue_now) === 1 &&
    Number(overview?.cross_bureau_institutions) === 1 &&
    Number(overview?.pending_duplicates) === 1 &&
    Number(overview?.confirmed_duplicates) === 1 &&
    Number(overview?.active_flags) === 4,
  JSON.stringify(overview),
);
const overviewUgc = (
  await db.query('select * from public.get_report_overview($1, $2, $3)', [
    new Date(Date.now() - 180 * 86_400_000).toISOString(),
    new Date().toISOString(),
    'UGC',
  ])
).rows[0];
check(
  'report overview is permission-aware per bureau',
  Number(overviewUgc?.total_received) === 4 &&
    Number(overviewUgc?.open_now) === 3 &&
    Number(overviewUgc?.confirmed_duplicates) === 0,
  JSON.stringify(overviewUgc),
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
