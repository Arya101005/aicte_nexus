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
check('seed created 6 complaints', afterFirst.complaints === 6, `got ${afterFirst.complaints}`);
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
check('reviewer sees all 6 complaints in v_complaint_sla', slaRows.length === 6, `got ${slaRows.length}`);
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
  'read_only reads all complaints (6)',
  (await count('select count(*)::int as n from public.complaints')) === 6,
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
  'AICTE official sees only AICTE complaints (3)',
  (await count('select count(*)::int as n from public.complaints')) === 3,
  `got ${await count('select count(*)::int as n from public.complaints')}`,
);
check(
  'AICTE official sees only AICTE rows in v_complaint_sla (3)',
  (await count('select count(*)::int as n from public.v_complaint_sla')) === 3,
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
  'reviewer reads all complaints (6)',
  (await count('select count(*)::int as n from public.complaints')) === 6,
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
