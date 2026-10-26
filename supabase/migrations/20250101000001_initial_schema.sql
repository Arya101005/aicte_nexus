-- ============================================================
-- AICTE Nexus — 0001: core schema, roles, constraints, RLS
-- ============================================================
-- Security model:
--   * Roles live in public.profiles (users can never write them).
--   * RLS on every table; policies read the role through SECURITY DEFINER
--     helpers so profiles policies cannot recurse.
--   * complaint_audit is INSERT + SELECT only (no UPDATE/DELETE policy,
--     privileges revoked as defence in depth).
-- ============================================================

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Immutable wrapper so unaccent() can be used in a generated column.
create or replace function public.immutable_unaccent(input text)
returns text
language sql
immutable
strict
parallel safe
as $$ select unaccent(input) $$;

-- ============================================================
-- Enum types
-- ============================================================
create type public.user_role as enum ('admin', 'bureau_official', 'reviewer', 'read_only');
create type public.complaint_status as enum ('Open', 'In Progress', 'Awaiting Information', 'Resolved', 'Closed');
create type public.complaint_priority as enum ('Low', 'Medium', 'High', 'Urgent');
create type public.coordination_flag_type as enum (
  'multiple_bureaus',
  'overlapping_subjects',
  'repeated_reassignment',
  'inconsistent_status',
  'approaching_deadline',
  'stale_case'
);
create type public.import_job_status as enum ('pending', 'running', 'completed', 'failed');
create type public.verification_status as enum ('pending', 'verified', 'disputed');

-- ============================================================
-- profiles — role assignment is admin-only (no self-escalation)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role public.user_role not null default 'read_only',
  bureau text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bureau_required_for_official check (role <> 'bureau_official' or bureau is not null)
);

alter table public.profiles enable row level security;

-- ============================================================
-- Role helpers (SECURITY DEFINER → no policy recursion).
-- Created after profiles exists: SQL-language function bodies have
-- their relations resolved at creation time.
-- ============================================================
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

create or replace function public.current_user_bureau()
returns text
language sql
security definer
set search_path = public
stable
as $$ select p.bureau from public.profiles p where p.id = auth.uid() $$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_bureau() from public;
-- anon is included so a signed-out caller reaches the RPC's friendly
-- "signed out" message instead of a raw permission error. The helpers
-- only return the caller's own role/bureau (derived from their own JWT
-- subject), so nothing is disclosed to anyone else.
grant execute on function public.current_user_role() to anon, authenticated, service_role;
grant execute on function public.current_user_bureau() to anon, authenticated, service_role;

-- Auto-provision a read_only profile for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'read_only')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles: admin reads all" on public.profiles
  for select to authenticated using (public.current_user_role() = 'admin');

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "profiles: admin updates" on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "profiles: admin inserts" on public.profiles
  for insert to authenticated with check (public.current_user_role() = 'admin');

create policy "profiles: admin deletes" on public.profiles
  for delete to authenticated using (public.current_user_role() = 'admin');

-- ============================================================
-- institutions — canonical list
-- ============================================================
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  normalized_name text
    generated always as (
      lower(regexp_replace(immutable_unaccent(btrim(name)), '\s+', ' ', 'g'))
    ) stored,
  country text,
  city text,
  established_year smallint check (established_year between 1000 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.institutions enable row level security;

create policy "institutions: read all authenticated" on public.institutions
  for select to authenticated using (true);
create policy "institutions: admin write" on public.institutions
  for insert to authenticated with check (public.current_user_role() = 'admin');
create policy "institutions: admin update" on public.institutions
  for update to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
create policy "institutions: admin delete" on public.institutions
  for delete to authenticated using (public.current_user_role() = 'admin');

-- ============================================================
-- institution_identifiers — source system mappings
-- ============================================================
create table public.institution_identifiers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions on delete cascade,
  source_system text not null check (length(btrim(source_system)) > 0),
  source_identifier text not null check (length(btrim(source_identifier)) > 0),
  verification_status public.verification_status not null default 'pending',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_system, source_identifier)
);

alter table public.institution_identifiers enable row level security;

create policy "institution_identifiers: read all" on public.institution_identifiers
  for select to authenticated using (true);
create policy "institution_identifiers: admin write" on public.institution_identifiers
  for insert to authenticated
  with check (public.current_user_role() in ('admin', 'reviewer'));
create policy "institution_identifiers: admin update" on public.institution_identifiers
  for update to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
create policy "institution_identifiers: admin delete" on public.institution_identifiers
  for delete to authenticated using (public.current_user_role() = 'admin');

-- ============================================================
-- complaints
-- ============================================================
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions on delete set null,
  bureau text not null check (length(btrim(bureau)) > 0),
  complaint_reference text not null unique check (length(btrim(complaint_reference)) > 0),
  source_system text not null check (length(btrim(source_system)) > 0),
  source_reference text,
  category text not null check (length(btrim(category)) > 0),
  priority public.complaint_priority not null default 'Medium',
  status public.complaint_status not null default 'Open',
  subject text not null check (length(btrim(subject)) > 0),
  description text,
  date_received timestamptz not null default now(),
  due_date timestamptz,
  resolved_at timestamptz,
  assigned_to uuid references auth.users on delete set null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_reference_unique_per_source unique (source_system, source_reference),
  constraint due_after_received check (due_date is null or due_date >= date_received),
  constraint resolved_has_timestamp check (status <> 'Resolved' or resolved_at is not null),
  constraint closed_or_resolved_has_timestamp
    check (status in ('Open', 'In Progress', 'Awaiting Information') or resolved_at is not null)
);

-- A NULL source_reference must still be unique per source: unique constraints
-- allow multiple NULLs in Postgres, so add a partial guarantee via index below.
create unique index complaints_source_reference_once
  on public.complaints (source_system, source_reference)
  where source_reference is not null;

alter table public.complaints enable row level security;

create policy "complaints: admin read" on public.complaints
  for select to authenticated using (public.current_user_role() = 'admin');

create policy "complaints: bureau reads own bureau" on public.complaints
  for select to authenticated
  using (public.current_user_role() = 'bureau_official'
         and bureau = public.current_user_bureau());

create policy "complaints: reviewer reads all" on public.complaints
  for select to authenticated using (public.current_user_role() = 'reviewer');

create policy "complaints: read_only reads all" on public.complaints
  for select to authenticated using (public.current_user_role() = 'read_only');

create policy "complaints: admin writes" on public.complaints
  for insert to authenticated with check (public.current_user_role() = 'admin');

create policy "complaints: bureau writes own bureau" on public.complaints
  for insert to authenticated
  with check (public.current_user_role() = 'bureau_official'
              and bureau = public.current_user_bureau());

create policy "complaints: admin updates" on public.complaints
  for update to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "complaints: bureau updates own bureau" on public.complaints
  for update to authenticated
  using (public.current_user_role() = 'bureau_official'
         and bureau = public.current_user_bureau())
  with check (public.current_user_role() = 'bureau_official'
              and bureau = public.current_user_bureau());

create policy "complaints: admin deletes" on public.complaints
  for delete to authenticated using (public.current_user_role() = 'admin');

-- ============================================================
-- complaint_audit — append-only history
-- ============================================================
create table public.complaint_audit (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints on delete cascade,
  action text not null check (length(btrim(action)) > 0),
  old_value text,
  new_value text,
  changed_by uuid not null references auth.users on delete restrict,
  changed_at timestamptz not null default now(),
  notes text
);

alter table public.complaint_audit enable row level security;

create policy "complaint_audit: read all" on public.complaint_audit
  for select to authenticated using (true);

create policy "complaint_audit: admin/bureau/reviewer insert" on public.complaint_audit
  for insert to authenticated
  with check (
    public.current_user_role() = 'admin'
    or public.current_user_role() = 'reviewer'
    or (public.current_user_role() = 'bureau_official'
        and exists (
          select 1 from public.complaints c
          where c.id = complaint_id and c.bureau = public.current_user_bureau()
        ))
  );

-- No UPDATE / DELETE policies → denied by RLS.
revoke update, truncate, delete on public.complaint_audit from authenticated, anon;

-- ============================================================
-- sla_rules
-- ============================================================
create table public.sla_rules (
  id uuid primary key default gen_random_uuid(),
  bureau text,
  category text,
  priority public.complaint_priority,
  response_period integer not null default 3 check (response_period > 0),
  resolution_period integer not null default 14 check (resolution_period > 0),
  warning_threshold integer not null default 10 check (warning_threshold > 0),
  escalation_threshold integer not null default 21 check (escalation_threshold > 0),
  stale_days integer not null default 30 check (stale_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threshold_within_resolution
    check (warning_threshold <= resolution_period and escalation_threshold >= warning_threshold)
);

alter table public.sla_rules enable row level security;

create policy "sla_rules: read all" on public.sla_rules
  for select to authenticated using (true);
create policy "sla_rules: admin write" on public.sla_rules
  for insert to authenticated with check (public.current_user_role() = 'admin');
create policy "sla_rules: admin update" on public.sla_rules
  for update to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
create policy "sla_rules: admin delete" on public.sla_rules
  for delete to authenticated using (public.current_user_role() = 'admin');

-- ============================================================
-- import_jobs / import_errors
-- ============================================================
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  source_system text not null default 'manual',
  kind text not null default 'complaints',
  status public.import_job_status not null default 'pending',
  total_rows integer not null default 0 check (total_rows >= 0),
  created_rows integer not null default 0 check (created_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  unchanged_rows integer not null default 0 check (unchanged_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completed_after_started check (completed_at is null or started_at is null or completed_at >= started_at)
);

alter table public.import_jobs enable row level security;

create policy "import_jobs: read all" on public.import_jobs
  for select to authenticated using (true);
create policy "import_jobs: admin write" on public.import_jobs
  for insert to authenticated with check (public.current_user_role() = 'admin');
create policy "import_jobs: admin update" on public.import_jobs
  for update to authenticated using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create table public.import_errors (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.import_jobs on delete cascade,
  row_number integer not null check (row_number > 0),
  field text,
  reason text not null,
  raw_value text,
  neutralized_value text,
  created_at timestamptz not null default now()
);

alter table public.import_errors enable row level security;

create policy "import_errors: read all" on public.import_errors
  for select to authenticated using (true);
create policy "import_errors: admin write" on public.import_errors
  for insert to authenticated with check (public.current_user_role() = 'admin');

-- ============================================================
-- coordination_flags — explainable cross-bureau signals
-- ============================================================
create table public.coordination_flags (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints on delete cascade,
  flag_type public.coordination_flag_type not null,
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'accepted', 'dismissed')),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (complaint_id, flag_type, generated_at)
);

alter table public.coordination_flags enable row level security;

create policy "coordination_flags: read all" on public.coordination_flags
  for select to authenticated using (true);
create policy "coordination_flags: write reviewers+" on public.coordination_flags
  for insert to authenticated
  with check (public.current_user_role() in ('admin', 'reviewer'));
create policy "coordination_flags: update reviewers+" on public.coordination_flags
  for update to authenticated
  using (public.current_user_role() in ('admin', 'reviewer'))
  with check (public.current_user_role() in ('admin', 'reviewer'));

-- ============================================================
-- updated_at maintenance
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger t_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger t_institutions_updated_at before update on public.institutions
  for each row execute function public.set_updated_at();
create trigger t_complaints_updated_at before update on public.complaints
  for each row execute function public.set_updated_at();
create trigger t_sla_rules_updated_at before update on public.sla_rules
  for each row execute function public.set_updated_at();
create trigger t_import_jobs_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();
create trigger t_coordination_flags_updated_at before update on public.coordination_flags
  for each row execute function public.set_updated_at();

-- Touch last_activity_at on any complaint change (feeds staleness signals).
-- An explicit last_activity_at in the UPDATE (imports, backfills, seeds)
-- wins over the trigger so historical activity can be restored.
create or replace function public.touch_complaint_activity()
returns trigger
language plpgsql
as $$
begin
  if new.last_activity_at = old.last_activity_at then
    new.last_activity_at = now();
  end if;
  return new;
end;
$$;

create trigger t_complaints_activity before update on public.complaints
  for each row execute function public.touch_complaint_activity();

-- ============================================================
-- Indexes (query patterns: filters, joins, trigram name search)
-- ============================================================
create index idx_institutions_normalized_name on public.institutions (normalized_name);
create index idx_institutions_name_trgm on public.institutions using gin (name gin_trgm_ops);
create index idx_institution_identifiers_institution on public.institution_identifiers (institution_id);
create index idx_complaints_institution on public.complaints (institution_id);
create index idx_complaints_bureau on public.complaints (bureau);
create index idx_complaints_status on public.complaints (status);
create index idx_complaints_priority on public.complaints (priority);
create index idx_complaints_due_date on public.complaints (due_date) where due_date is not null;
create index idx_complaints_received on public.complaints (date_received);
create index idx_complaints_assigned_to on public.complaints (assigned_to) where assigned_to is not null;
create index idx_complaints_last_activity on public.complaints (last_activity_at);
create index idx_audit_complaint on public.complaint_audit (complaint_id, changed_at);
create index idx_import_errors_job on public.import_errors (job_id);
create index idx_flags_complaint on public.coordination_flags (complaint_id);
create index idx_flags_unreviewed on public.coordination_flags (review_status) where review_status = 'pending';
create index idx_sla_rules_lookup on public.sla_rules (bureau, category, priority) where is_active;

-- ============================================================
-- Grants (RLS still governs row access)
-- ============================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke delete on public.complaint_audit from authenticated;
revoke update, truncate on public.complaint_audit from authenticated;