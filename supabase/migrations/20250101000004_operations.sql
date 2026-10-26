-- ============================================================
-- AICTE Nexus — 0004: operational monitoring
--   * Persisted in-app notifications (deduped, per-user, audited source)
--   * Idempotent import pipeline (jobs, per-row errors, upsert by
--     stable source keys, missing-from-export report — never delete)
--   * Data Health (honest per-source states) + Data Quality metrics
--   * SLA summary + report overview RPCs (server-side aggregation)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Notifications — in-app, persisted, one per (user, dedupe_key)
-- ------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null check (type in (
    'assignment', 'reassignment', 'duplicate_review',
    'approaching_deadline', 'overdue', 'import_failed', 'coordination_resolved'
  )),
  entity_type text not null check (entity_type in (
    'complaint', 'duplicate_review', 'coordination_flag', 'import_job', 'institution'
  )),
  entity_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  body text,
  link text,
  dedupe_key text not null check (length(btrim(dedupe_key)) > 0),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

alter table public.notifications enable row level security;

create policy "notifications: owner reads own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: owner marks read" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- No INSERT policy: notifications are only ever created through the
-- SECURITY DEFINER function below, so users cannot forge them.

create index idx_notifications_user on public.notifications (user_id, read_at, created_at);
create index idx_notifications_entity on public.notifications (entity_type, entity_id);

-- ------------------------------------------------------------
-- 1a. create_notification — SECURITY DEFINER so one user's action can
--     notify another. Guarded to operational roles; dedupe key makes
--     re-processing the same event a no-op (on conflict do nothing).
-- ------------------------------------------------------------
create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_body text,
  p_link text,
  p_dedupe_key text
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.notifications;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'bureau_official', 'reviewer') then
    raise exception 'Your role cannot send notifications.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That user does not exist.' using errcode = 'P0002';
  end if;

  insert into public.notifications
    (user_id, type, entity_type, entity_id, title, body, link, dedupe_key)
  values
    (p_user_id, p_type, p_entity_type, p_entity_id, btrim(p_title), p_body, p_link, btrim(p_dedupe_key))
  on conflict (user_id, dedupe_key) do nothing;

  select * into v_row from public.notifications
  where user_id = p_user_id and dedupe_key = btrim(p_dedupe_key);

  return v_row;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns public.notifications
language plpgsql
set search_path = public
as $$
declare
  v_row public.notifications;
begin
  if auth.uid() is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'Notification not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 1b. refresh_notifications — scans events and creates notifications
--     idempotently. SECURITY DEFINER (sees all bureaus' cases).
--     Every dedupe key derives from the event identity, so running
--     this any number of times never produces repeats.
-- ------------------------------------------------------------
create or replace function public.refresh_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_total integer := 0;
  v_n integer := 0;
begin
  if v_jwt_role <> 'service_role' and (v_role is null or v_role not in ('admin', 'reviewer')) then
    raise exception 'Only admins and reviewers can refresh notifications.' using errcode = '42501';
  end if;

  -- Pending duplicate suggestions -> reviewers and admins.
  insert into public.notifications
    (user_id, type, entity_type, entity_id, title, body, link, dedupe_key)
  select
    p.id,
    'duplicate_review',
    'duplicate_review',
    d.id,
    'Duplicate suggestion needs review',
    format('%s vs %s — %s', cp.complaint_reference, cc.complaint_reference, d.reason),
    '/duplicates',
    'dup:' || d.id
  from public.duplicate_reviews d
  join public.complaints cp on cp.id = d.complaint_id
  join public.complaints cc on cc.id = d.candidate_id
  cross join public.profiles p
  where d.status = 'pending'
    and p.role in ('admin', 'reviewer')
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Deadline pressure on assigned cases -> the assignee.
  insert into public.notifications
    (user_id, type, entity_type, entity_id, title, body, link, dedupe_key)
  select
    c.assigned_to,
    case when s.attention_state = 'Overdue' then 'overdue' else 'approaching_deadline' end,
    'complaint',
    s.id,
    case when s.attention_state = 'Overdue'
         then 'Overdue case assigned to you'
         else 'Case approaching its deadline' end,
    format('%s — effective due %s', s.complaint_reference, s.effective_due_date::date),
    '/complaints',
    'sla:' || s.id || ':' || s.attention_state || ':' || s.effective_due_date::date
  from public.v_complaint_sla s
  join public.complaints c on c.id = s.id
  where s.attention_state in ('Overdue', 'Approaching Deadline')
    and c.assigned_to is not null
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Failed imports -> admins.
  insert into public.notifications
    (user_id, type, entity_type, entity_id, title, body, link, dedupe_key)
  select
    p.id,
    'import_failed',
    'import_job',
    j.id,
    'Import failed',
    format('%s (%s) failed and needs attention.', j.filename, j.source_system),
    '/data-health',
    'import:' || j.id || ':failed'
  from public.import_jobs j
  cross join public.profiles p
  where j.status = 'failed'
    and p.role = 'admin'
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Accepted coordination flags -> the reviewer they were assigned to.
  insert into public.notifications
    (user_id, type, entity_type, entity_id, title, body, link, dedupe_key)
  select
    f.assigned_to,
    'coordination_resolved',
    'coordination_flag',
    f.id,
    'Coordination flag decided',
    format('%s on %s: %s', f.flag_type, c.complaint_reference, coalesce(f.decision_notes, '')),
    '/cross-bureau',
    'flag:' || f.id || ':accepted'
  from public.coordination_flags f
  join public.complaints c on c.id = f.complaint_id
  where f.review_status = 'accepted'
    and f.assigned_to is not null
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end;
$$;

-- ------------------------------------------------------------
-- 1c. Assignment notifications, atomically with the complaint update.
--     Replaces the Phase 2 definition (same signature); the dedupe key
--     is the audit row's id — one audit event, at most one notification.
-- ------------------------------------------------------------
create or replace function public.update_complaint_with_audit(
  p_complaint_id uuid,
  p_status public.complaint_status default null,
  p_priority public.complaint_priority default null,
  p_assigned_to uuid default null,
  p_notes text default null
)
returns setof public.complaints
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_bureau text := public.current_user_bureau();
  v_old public.complaints;
  v_new public.complaints;
  v_action text;
  v_old_value text;
  v_new_value text;
  v_audit_id uuid;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role = 'read_only' then
    raise exception 'Your account has read-only access and cannot change complaints.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'bureau_official') then
    raise exception 'Your role cannot change complaints.' using errcode = '42501';
  end if;

  select * into v_old from public.complaints where id = p_complaint_id for update;
  if not found then
    raise exception 'Complaint not found.' using errcode = 'P0002';
  end if;
  if v_role = 'bureau_official' and v_old.bureau <> v_bureau then
    raise exception 'You can only change complaints belonging to your bureau.' using errcode = '42501';
  end if;

  update public.complaints set
    status        = coalesce(p_status, status),
    priority      = coalesce(p_priority, priority),
    assigned_to   = coalesce(p_assigned_to, assigned_to),
    resolved_at   = case
                      when p_status = 'Resolved' and resolved_at is null then now()
                      when p_status in ('Open', 'In Progress', 'Awaiting Information') then null
                      else resolved_at
                    end
  where id = p_complaint_id
  returning * into v_new;

  if v_old.status is distinct from v_new.status then
    v_action := 'status_update'; v_old_value := v_old.status::text; v_new_value := v_new.status::text;
  elsif v_old.priority is distinct from v_new.priority then
    v_action := 'priority_change'; v_old_value := v_old.priority::text; v_new_value := v_new.priority::text;
  elsif v_old.assigned_to is distinct from v_new.assigned_to then
    v_action := 'reassignment';
    v_old_value := coalesce(v_old.assigned_to::text, 'unassigned');
    v_new_value := coalesce(v_new.assigned_to::text, 'unassigned');
  else
    v_action := 'complaint_update'; v_old_value := null; v_new_value := null;
  end if;

  insert into public.complaint_audit (complaint_id, action, old_value, new_value, changed_by, notes)
  values (p_complaint_id, v_action, v_old_value, v_new_value, auth.uid(), p_notes)
  returning id into v_audit_id;

  -- Notify the new assignee (dedupe key = this exact audit event).
  if v_new.assigned_to is not null and v_old.assigned_to is distinct from v_new.assigned_to then
    perform public.create_notification(
      v_new.assigned_to,
      case when v_old.assigned_to is null then 'assignment' else 'reassignment' end,
      'complaint',
      v_new.id,
      case when v_old.assigned_to is null
           then 'New complaint assigned to you'
           else 'Complaint reassigned to you' end,
      format('%s — %s', v_new.complaint_reference, v_new.subject),
      '/complaints',
      'assign:' || v_audit_id::text
    );
  end if;

  return next v_new;
end;
$$;

-- ============================================================
-- 2. Import pipeline — idempotent by (source_system, source_reference)
-- ============================================================

create or replace function public.begin_import_job(
  p_filename text,
  p_source_system text,
  p_kind text default 'complaints'
)
returns public.import_jobs
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_row public.import_jobs;
begin
  if v_jwt_role = 'service_role' then
    null; -- scheduled imports run as the service role
  elsif v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  elsif v_role <> 'admin' then
    raise exception 'Only administrators can run imports.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_filename, ''))) = 0 or length(btrim(coalesce(p_source_system, ''))) = 0 then
    raise exception 'A file name and source system are required.' using errcode = '22023';
  end if;

  insert into public.import_jobs (filename, source_system, kind, status, started_at, created_by)
  values (btrim(p_filename), btrim(p_source_system), btrim(p_kind), 'running', now(), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_import_error(
  p_job_id uuid,
  p_row_number integer,
  p_field text,
  p_reason text,
  p_raw_value text default null
)
returns public.import_errors
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_neutralized text;
  v_row public.import_errors;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'Only administrators can record import errors.' using errcode = '42501';
  end if;
  if coalesce(p_row_number, 0) < 1 then
    raise exception 'Row numbers start at 1.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'An error reason is required.' using errcode = '22023';
  end if;

  -- Mirror of the TS export neutralizer, so a rejected cell can be
  -- shown or re-exported without becoming a formula vector.
  v_neutralized := case
    when p_raw_value is not null and left(p_raw_value, 1) in ('=', '+', '-', '@', chr(9), chr(13))
    then '''' || p_raw_value
    else p_raw_value
  end;

  insert into public.import_errors (job_id, row_number, field, reason, raw_value, neutralized_value)
  values (p_job_id, p_row_number, p_field, btrim(p_reason), p_raw_value, v_neutralized)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.finish_import_job(
  p_job_id uuid,
  p_status text,
  p_total integer default 0,
  p_created integer default 0,
  p_updated integer default 0,
  p_unchanged integer default 0,
  p_rejected integer default 0,
  p_failed integer default 0,
  p_error_summary jsonb default '{}'::jsonb
)
returns public.import_jobs
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.import_jobs;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role <> 'admin' then
    raise exception 'Only administrators can finish import jobs.' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed') then
    raise exception 'An import job can only finish as "completed" or "failed".' using errcode = '22023';
  end if;

  update public.import_jobs set
    status = p_status::public.import_job_status,
    total_rows = coalesce(p_total, 0),
    created_rows = coalesce(p_created, 0),
    updated_rows = coalesce(p_updated, 0),
    unchanged_rows = coalesce(p_unchanged, 0),
    rejected_rows = coalesce(p_rejected, 0),
    failed_rows = coalesce(p_failed, 0),
    completed_at = now(),
    error_summary = coalesce(p_error_summary, '{}'::jsonb)
  where id = p_job_id
  returning * into v_row;

  if not found then
    raise exception 'Import job not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 2a. The idempotent core: one row in, created/updated/unchanged/
--     conflicting out. Stable source keys decide identity; a missing
--     institution name resolves ONLY by exact normalized match or an
--     explicit id — never by fuzzy guess. Never deletes anything.
-- ------------------------------------------------------------
create or replace function public.upsert_complaint_from_import(
  p_source_system text,
  p_source_reference text,
  p_complaint_reference text,
  p_bureau text,
  p_category text,
  p_priority public.complaint_priority,
  p_status public.complaint_status,
  p_subject text,
  p_description text default null,
  p_date_received timestamptz default null,
  p_due_date timestamptz default null,
  p_resolved_at timestamptz default null,
  p_institution_id uuid default null,
  p_institution_name text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_existing public.complaints;
  v_institution uuid := p_institution_id;
  v_note text := null;
  v_changed boolean := false;
  v_conflict boolean := false;
  v_result text;
  v_institution_matches integer;
begin
  if v_jwt_role = 'service_role' then
    null;
  elsif v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  elsif v_role <> 'admin' then
    raise exception 'Only administrators can import complaints.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_source_system, ''))) = 0
     or length(btrim(coalesce(p_source_reference, ''))) = 0
     or length(btrim(coalesce(p_complaint_reference, ''))) = 0 then
    raise exception 'source_system, source_reference and complaint_reference identify the row and are required.' using errcode = '22023';
  end if;

  -- Institution resolution: explicit id wins; otherwise exact
  -- normalized-name match only (0 or >1 matches = unresolved).
  if v_institution is null and length(btrim(coalesce(p_institution_name, ''))) > 0 then
    select count(*) into v_institution_matches
    from public.institutions i
    where i.normalized_name =
          lower(regexp_replace(immutable_unaccent(btrim(p_institution_name)), '\s+', ' ', 'g'));
    if v_institution_matches = 1 then
      select i.id into v_institution
      from public.institutions i
      where i.normalized_name =
            lower(regexp_replace(immutable_unaccent(btrim(p_institution_name)), '\s+', ' ', 'g'));
    elsif v_institution_matches > 1 then
      v_note := 'institution_ambiguous';
    else
      v_note := 'institution_unmatched';
    end if;
  end if;

  select * into v_existing
  from public.complaints
  where source_system = btrim(p_source_system)
    and source_reference = btrim(p_source_reference)
  for update;

  if not found then
    insert into public.complaints (
      institution_id, bureau, complaint_reference, source_system, source_reference,
      category, priority, status, subject, description,
      date_received, due_date, resolved_at
    ) values (
      v_institution, btrim(p_bureau), btrim(p_complaint_reference),
      btrim(p_source_system), btrim(p_source_reference),
      btrim(p_category), p_priority, p_status, btrim(p_subject), p_description,
      coalesce(p_date_received, now()), p_due_date, p_resolved_at
    )
    returning * into v_existing;

    return jsonb_build_object(
      'result', 'created',
      'complaint_id', v_existing.id,
      'institution_id', v_existing.institution_id,
      'institution_note', v_note
    );
  end if;

  -- Row exists: compare only the fields the file actually provided.
  v_conflict := v_existing.complaint_reference <> btrim(p_complaint_reference);
  v_changed :=
       v_existing.bureau <> btrim(p_bureau)
    or v_existing.category <> btrim(p_category)
    or v_existing.priority <> p_priority
    or v_existing.status <> p_status
    or v_existing.subject <> btrim(p_subject)
    or coalesce(v_existing.description, '') <> coalesce(p_description, '')
    or (p_date_received is not null and v_existing.date_received <> p_date_received)
    or (p_due_date is not null and v_existing.due_date is distinct from p_due_date)
    or (p_resolved_at is not null and v_existing.resolved_at is distinct from p_resolved_at)
    or (v_institution is not null and v_existing.institution_id is distinct from v_institution);

  if not v_changed and not v_conflict then
    return jsonb_build_object(
      'result', 'unchanged',
      'complaint_id', v_existing.id,
      'institution_id', v_existing.institution_id,
      'institution_note', v_note
    );
  end if;

  -- File values win for provided fields; NULL keeps stored data
  -- (imports must never blank out fields they did not send).
  update public.complaints set
    institution_id = coalesce(v_institution, v_existing.institution_id),
    bureau = btrim(p_bureau),
    complaint_reference = btrim(p_complaint_reference),
    category = btrim(p_category),
    priority = p_priority,
    status = p_status,
    subject = btrim(p_subject),
    description = coalesce(p_description, v_existing.description),
    date_received = coalesce(p_date_received, v_existing.date_received),
    due_date = coalesce(p_due_date, v_existing.due_date),
    resolved_at = coalesce(p_resolved_at, v_existing.resolved_at)
  where id = v_existing.id
  returning * into v_existing;

  v_result := case when v_conflict then 'conflicting' else 'updated' end;

  return jsonb_build_object(
    'result', v_result,
    'complaint_id', v_existing.id,
    'institution_id', v_existing.institution_id,
    'institution_note', v_note
  );
end;
$$;

-- ------------------------------------------------------------
-- 2b. Reconciliation: what the export did NOT contain. Report-only —
--     absence from an export never deletes a record.
-- ------------------------------------------------------------
create or replace function public.find_missing_from_export(
  p_source_system text,
  p_presented_refs text[]
)
returns table (
  missing_reference text,
  missing_source_reference text,
  missing_status public.complaint_status,
  last_activity timestamptz,
  note text
)
language sql
stable
set search_path = public
as $$
  select
    c.complaint_reference,
    c.source_reference,
    c.status,
    c.last_activity_at,
    case
      when c.source_reference is null then 'No source reference recorded — retained, never deleted'
      else 'Absent from this export — retained, never deleted'
    end
  from public.complaints c
  where c.source_system = btrim(p_source_system)
    and (c.source_reference is null
         or not (c.source_reference = any(p_presented_refs)))
  order by c.date_received desc;
$$;

-- ============================================================
-- 3. Data Health + Data Quality (honest states, config != healthy)
-- ============================================================

create or replace view public.v_source_health
with (security_invoker = true) as
with srcs as (
  select distinct source_system from public.complaints
  union
  select distinct source_system from public.import_jobs
),
latest as (
  select distinct on (j.source_system)
         j.source_system, j.status, j.completed_at, j.rejected_rows, j.created_at
  from public.import_jobs j
  order by j.source_system, j.created_at desc, j.id desc
)
select
  s.source_system,
  case
    when l.source_system is null then 'Not configured'
    when l.status in ('pending', 'running') then 'Awaiting verification'
    when l.status = 'failed' then 'Failed'
    when l.completed_at is null then 'Awaiting verification'
    when l.rejected_rows > 0 then 'Awaiting verification'
    when l.completed_at > now() - interval '7 days' then 'Healthy'
    else 'Delayed'
  end as health_state,
  l.status as last_job_status,
  l.completed_at as last_success_at,
  l.rejected_rows as last_rejected_rows,
  (select count(*) from public.import_jobs j
    where j.source_system = s.source_system and j.status = 'failed') as failed_jobs,
  case
    when l.source_system is null
      then 'No import job has ever run for this source.'
    when l.status = 'failed'
      then 'The most recent import failed. Fix the file and re-import.'
    when l.completed_at is null or l.status in ('pending', 'running')
      then 'An import is in flight; results are not yet confirmed.'
    when l.rejected_rows > 0
      then 'Rows were rejected and need human review before the source is trusted.'
    when l.completed_at > now() - interval '7 days'
      then 'Imported within the last 7 days with no rejected rows.'
    else 'Last successful import is older than 7 days.'
  end as health_detail
from srcs s
left join latest l on l.source_system = s.source_system;

create or replace view public.v_data_quality
with (security_invoker = true) as
select * from (values
  ('complaints without a Bureau', 'error',
    (select count(*) from public.complaints where bureau is null),
    '/complaints?filter=no-bureau'),
  ('invalid or inconsistent dates', 'error',
    (select count(*) from public.complaints
      where (due_date is not null and date_received is not null and due_date < date_received)
         or (status in ('Resolved', 'Closed') and resolved_at is null)),
    '/complaints?filter=date-issues'),
  ('failed imports', 'error',
    (select count(*) from public.import_jobs where status = 'failed'),
    '/data-health'),
  ('rejected import rows awaiting review', 'error',
    (select coalesce(sum(rejected_rows), 0) from public.import_jobs where status = 'completed'),
    '/data-health'),
  ('disputed identifier verifications', 'error',
    (select count(*) from public.institution_identifiers where verification_status = 'disputed'),
    '/institutions?filter=disputed-identifiers'),
  ('missing identifiers', 'warning',
    (select count(*) from public.institutions i
      where not exists (select 1 from public.institution_identifiers ii where ii.institution_id = i.id)),
    '/institutions?filter=missing-identifiers'),
  ('pending identifier verifications', 'warning',
    (select count(*) from public.institution_identifiers where verification_status = 'pending'),
    '/institutions?filter=pending-identifiers'),
  ('complaints without an institution link', 'warning',
    (select count(*) from public.complaints where institution_id is null),
    '/complaints?filter=unlinked'),
  ('institutions sharing a normalized name', 'warning',
    (select count(*) from (
      select normalized_name from public.institutions
      group by normalized_name having count(*) > 1
    ) collisions),
    '/institutions?filter=possible-duplicates'),
  ('pending institution match reviews', 'warning',
    (select count(*) from public.institution_identity_reviews where status = 'pending'),
    '/institutions?filter=match-reviews'),
  ('pending duplicate suggestions', 'warning',
    (select count(*) from public.duplicate_reviews where status = 'pending'),
    '/duplicates'),
  ('open coordination flags', 'warning',
    (select count(*) from public.coordination_flags where review_status = 'pending'),
    '/cross-bureau'),
  ('conflicting-status flags', 'warning',
    (select count(*) from public.coordination_flags
      where flag_type = 'inconsistent_status' and review_status = 'pending'),
    '/cross-bureau'),
  ('open complaints without a due date', 'warning',
    (select count(*) from public.complaints
      where due_date is null and status not in ('Resolved', 'Closed')),
    '/complaints?filter=no-due-date')
) as v(metric, severity, metric_count, drilldown);

-- ============================================================
-- 4. SLA summary + report overview (server-side aggregation)
-- ============================================================

create or replace function public.get_sla_summary(
  p_from timestamptz default now() - interval '90 days',
  p_to timestamptz default now()
)
returns table (
  bureau text,
  open_cases bigint,
  approaching bigint,
  overdue bigint,
  awaiting_info bigint,
  stale bigint,
  resolved_in_period bigint,
  avg_resolution_days numeric,
  resolution_samples bigint
)
language sql
stable
set search_path = public
as $$
  with scoped as (
    select s.*
    from public.v_complaint_sla s
    where s.date_received >= p_from and s.date_received <= p_to
  ),
  resolved as (
    select c.bureau as r_bureau,
           count(*)::bigint as r_count,
           avg(extract(epoch from (c.resolved_at - c.date_received)) / 86400)::numeric as r_avg
    from public.complaints c
    where c.resolved_at is not null
      and c.resolved_at >= p_from and c.resolved_at <= p_to
    group by c.bureau
  ),
  bureaus as (
    select distinct s.bureau as b from scoped s
    union
    select r.r_bureau from resolved r
  )
  select
    bu.b,
    count(*) filter (where s.status not in ('Resolved', 'Closed')),
    count(*) filter (
      where s.status not in ('Resolved', 'Closed')
        and s.sla_rule_matched
        and s.effective_due_date >= now()
        and s.sla_warning_threshold is not null
        and s.effective_due_date - make_interval(days => s.sla_warning_threshold) <= now()
    ),
    count(*) filter (
      where s.status not in ('Resolved', 'Closed')
        and s.sla_rule_matched
        and s.effective_due_date < now()
    ),
    count(*) filter (where s.status = 'Awaiting Information'),
    count(*) filter (
      where s.status not in ('Resolved', 'Closed')
        and s.sla_stale_days is not null
        and s.days_since_activity > s.sla_stale_days
    ),
    coalesce(res.r_count, 0),
    res.r_avg,
    coalesce(res.r_count, 0)
  from bureaus bu
  left join scoped s on s.bureau = bu.b
  left join resolved res on res.r_bureau = bu.b
  group by bu.b, res.r_count, res.r_avg
  order by bu.b;
$$;

create or replace function public.get_report_overview(
  p_from timestamptz default now() - interval '90 days',
  p_to timestamptz default now(),
  p_bureau text default null
)
returns table (
  total_received bigint,
  open_now bigint,
  resolved_in_period bigint,
  overdue_now bigint,
  cross_bureau_institutions bigint,
  pending_duplicates bigint,
  confirmed_duplicates bigint,
  active_flags bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.complaints c
      where c.date_received >= p_from and c.date_received <= p_to
        and (p_bureau is null or c.bureau = p_bureau)),
    (select count(*) from public.complaints c
      where c.status not in ('Resolved', 'Closed')
        and (p_bureau is null or c.bureau = p_bureau)),
    (select count(*) from public.complaints c
      where c.resolved_at is not null
        and c.resolved_at >= p_from and c.resolved_at <= p_to
        and (p_bureau is null or c.bureau = p_bureau)),
    (select count(*) from public.v_complaint_sla s
      where s.status not in ('Resolved', 'Closed')
        and s.sla_rule_matched
        and s.effective_due_date < now()
        and (p_bureau is null or s.bureau = p_bureau)),
    (select count(*) from (
       select c.institution_id
       from public.complaints c
       where c.institution_id is not null
         and (p_bureau is null or c.bureau = p_bureau)
       group by c.institution_id
       having count(distinct c.bureau) >= 2
     ) multi),
    (select count(*) from public.duplicate_reviews d
      where d.status = 'pending'
        and (p_bureau is null or exists (
          select 1 from public.complaints c
          where (c.id = d.complaint_id or c.id = d.candidate_id) and c.bureau = p_bureau
        ))),
    (select count(*) from public.duplicate_reviews d
      where d.decision = 'Confirmed duplicate'
        and (p_bureau is null or exists (
          select 1 from public.complaints c
          where (c.id = d.complaint_id or c.id = d.candidate_id) and c.bureau = p_bureau
        ))),
    (select count(*) from public.coordination_flags f
      where f.review_status = 'pending'
        and (p_bureau is null or exists (
          select 1 from public.complaints c
          where c.id = f.complaint_id and c.bureau = p_bureau
        )));
$$;

-- ============================================================
-- 5. Grants + defence in depth
-- ============================================================
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Re-assert immutability / no-forgery guarantees after the blanket grant.
revoke update, truncate, delete on public.complaint_audit from authenticated, service_role;
revoke insert, delete on public.notifications from authenticated;

grant execute on function public.create_notification(uuid, text, text, uuid, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.mark_notification_read(uuid) to authenticated, service_role;
grant execute on function public.refresh_notifications() to authenticated, service_role;
grant execute on function public.update_complaint_with_audit(uuid, public.complaint_status, public.complaint_priority, uuid, text)
  to anon, authenticated;
grant execute on function public.begin_import_job(text, text, text) to authenticated, service_role;
grant execute on function public.record_import_error(uuid, integer, text, text, text)
  to authenticated, service_role;
grant execute on function public.finish_import_job(uuid, text, integer, integer, integer, integer, integer, integer, jsonb)
  to authenticated, service_role;
grant execute on function public.upsert_complaint_from_import(
  text, text, text, text, text, public.complaint_priority, public.complaint_status,
  text, text, timestamptz, timestamptz, timestamptz, uuid, text
) to authenticated, service_role;
grant execute on function public.find_missing_from_export(text, text[]) to authenticated, service_role;
grant execute on function public.get_sla_summary(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.get_report_overview(timestamptz, timestamptz, text)
  to authenticated, service_role;

grant select on public.v_source_health to authenticated, service_role;
grant select on public.v_data_quality to authenticated, service_role;
