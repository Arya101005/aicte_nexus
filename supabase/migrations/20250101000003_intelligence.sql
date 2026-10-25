-- ============================================================
-- AICTE Nexus — 0003: core intelligence
--   * Institution identity resolution (candidates only, never auto-merge)
--   * Duplicate / related-case suggestions + reviewer decisions
--   * Explainable cross-bureau coordination flags + review workflow
-- ============================================================

-- ------------------------------------------------------------
-- 1. Normalized subject (generated) + similarity indexes
-- ------------------------------------------------------------
alter table public.complaints
  add column normalized_subject text
  generated always as (lower(immutable_unaccent(btrim(subject)))) stored;

create index idx_complaints_subject_trgm on public.complaints using gin (subject gin_trgm_ops);
create index idx_complaints_normalized_subject on public.complaints (normalized_subject);

-- ------------------------------------------------------------
-- 2. Institution identity reviews (candidates + decisions)
--    Matching NEVER auto-merges: candidates are recorded with their
--    factors and a human decides, with a reason, in one place.
-- ------------------------------------------------------------
create table public.institution_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  input_name text not null check (length(btrim(input_name)) > 0),
  input_city text,
  input_source_system text,
  input_source_identifier text,
  institution_id uuid not null references public.institutions on delete cascade,
  match_category text not null check (match_category in ('Strong', 'Possible', 'Weak')),
  matching_factors jsonb not null default '{}'::jsonb,
  conflicting_fields jsonb not null default '{}'::jsonb,
  recommended_action text not null check (length(btrim(recommended_action)) > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  reason text,
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint decided_has_timestamp check ((status = 'pending') = (decided_at is null)),
  constraint decided_has_reason check (status = 'pending' or length(btrim(coalesce(reason, ''))) > 0)
);

alter table public.institution_identity_reviews enable row level security;

create policy "identity_reviews: read all" on public.institution_identity_reviews
  for select to authenticated using (true);
create policy "identity_reviews: proposers insert" on public.institution_identity_reviews
  for insert to authenticated
  with check (public.current_user_role() in ('admin', 'bureau_official', 'reviewer'));
create policy "identity_reviews: reviewers decide" on public.institution_identity_reviews
  for update to authenticated
  using (public.current_user_role() in ('admin', 'reviewer'))
  with check (public.current_user_role() in ('admin', 'reviewer'));

create trigger t_identity_reviews_updated_at before update on public.institution_identity_reviews
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2a. Matching — documented order:
--     verified source mapping -> any source mapping
--     -> normalized-name exact -> pg_trgm similarity (candidates only)
-- ------------------------------------------------------------
create or replace function public.find_institution_matches(
  p_name text,
  p_city text default null,
  p_source_system text default null,
  p_source_identifier text default null,
  p_limit integer default 10
)
returns table (
  matched_institution_id uuid,
  matched_name text,
  matched_city text,
  matched_established_year smallint,
  match_category text,
  match_similarity real,
  matching_factors jsonb,
  conflicting_fields jsonb,
  recommended_action text
)
language sql
stable
set search_path = public
as $$
  with input as (
    select
      lower(regexp_replace(immutable_unaccent(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g')) as norm_name,
      nullif(lower(btrim(coalesce(p_city, ''))), '') as norm_city
  ),
  source_hits as (
    select ii.institution_id, ii.verification_status
    from public.institution_identifiers ii, input
    where p_source_system is not null
      and p_source_identifier is not null
      and btrim(p_source_system) <> ''
      and btrim(p_source_identifier) <> ''
      and ii.source_system = btrim(p_source_system)
      and ii.source_identifier = btrim(p_source_identifier)
  ),
  -- Strong: an identifier mapping exists (verified or pending)
  by_source as (
    select
      s.institution_id, i.name, i.city, i.established_year,
      'Strong' as category,
      null::real as score,
      jsonb_strip_nulls(jsonb_build_object(
        'source_mapping', s.verification_status,
        'source_system', p_source_system,
        'source_identifier', p_source_identifier
      )) as factors,
      (case
        when n.norm_city is not null and i.city is not null
             and lower(btrim(i.city)) = n.norm_city
        then jsonb_build_object()
        when n.norm_city is not null and i.city is not null
        then jsonb_build_object('city', jsonb_build_object('input', n.norm_city, 'existing', btrim(i.city)))
        else jsonb_build_object()
      end) as conflicts,
      (case when s.verification_status = 'verified'
            then 'Link this source identifier to the canonical institution'
            else 'Verify the source mapping, then link'
       end) as action
    from source_hits s
    join public.institutions i on i.id = s.institution_id
    cross join input n
  ),
  -- Strong: exact normalized-name match
  by_name as (
    select
      i.id, i.name, i.city, i.established_year,
      'Strong' as category,
      null::real as score,
      jsonb_strip_nulls(jsonb_build_object('normalized_name_exact', true)) as factors,
      (case
        when n.norm_city is not null and i.city is not null
             and lower(btrim(i.city)) = n.norm_city
        then jsonb_build_object()
        when n.norm_city is not null and i.city is not null
        then jsonb_build_object('city', jsonb_build_object('input', n.norm_city, 'existing', btrim(i.city)))
        else jsonb_build_object()
      end) as conflicts,
      'Confirm this is the same institution' as action
    from public.institutions i
    cross join input n
    where n.norm_name <> ''
      and i.normalized_name = n.norm_name
      and not exists (select 1 from source_hits s where s.institution_id = i.id)
  ),
  -- Possible/Weak: trigram similarity — review candidates only
  by_similarity as (
    select
      i.id, i.name, i.city, i.established_year,
      (case when sim >= 0.65 then 'Possible' else 'Weak' end) as category,
      sim as score,
      jsonb_strip_nulls(jsonb_build_object(
        'name_similarity', round(sim::numeric, 3),
        'same_city', (case when n.norm_city is not null and i.city is not null
                            and lower(btrim(i.city)) = n.norm_city
                      then true else null end)
      )) as factors,
      (case
        when n.norm_city is not null and i.city is not null
             and lower(btrim(i.city)) = n.norm_city
        then jsonb_build_object()
        when n.norm_city is not null and i.city is not null
        then jsonb_build_object('city', jsonb_build_object('input', n.norm_city, 'existing', btrim(i.city)))
        else jsonb_build_object()
      end) as conflicts,
      (case when sim >= 0.65
            then 'Review matching factors and confirm or reject'
            else 'Likely a different institution — reject unless a verified source mapping exists'
       end) as action
    from public.institutions i
    cross join input n
    cross join lateral (
      select similarity(n.norm_name, i.normalized_name)::real as sim
    ) s
    where n.norm_name <> ''
      and s.sim >= 0.4
      and not exists (select 1 from source_hits sh where sh.institution_id = i.id)
      and i.normalized_name <> n.norm_name
  ),
  all_candidates as (
    select * from by_source
    union all
    select * from by_name
    union all
    select * from by_similarity
  )
  select
    a.institution_id, a.name, a.city, a.established_year,
    a.category, a.score, a.factors, a.conflicts, a.action
  from all_candidates a
  order by
    case a.category when 'Strong' then 0 when 'Possible' then 1 else 2 end,
    a.score desc nulls last,
    a.name
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- ------------------------------------------------------------
-- 2b. Propose matches (records candidates for review, idempotent
--     while a candidate is still pending)
-- ------------------------------------------------------------
create or replace function public.propose_institution_matches(
  p_name text,
  p_city text default null,
  p_source_system text default null,
  p_source_identifier text default null,
  p_limit integer default 5
)
returns setof public.institution_identity_reviews
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role = 'read_only' then
    raise exception 'Your account has read-only access and cannot propose institution matches.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'bureau_official', 'reviewer') then
    raise exception 'Your role cannot propose institution matches.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'An institution name is required.' using errcode = '22023';
  end if;

  return query
  with inserted as (
    insert into public.institution_identity_reviews (
      input_name, input_city, input_source_system, input_source_identifier,
      institution_id, match_category, matching_factors, conflicting_fields,
      recommended_action, created_by
    )
    select
      btrim(p_name), p_city, p_source_system, p_source_identifier,
      m.matched_institution_id, m.match_category, m.matching_factors,
      m.conflicting_fields, m.recommended_action, auth.uid()
    from public.find_institution_matches(p_name, p_city, p_source_system, p_source_identifier, p_limit) m
    where not exists (
      select 1
      from public.institution_identity_reviews r
      where r.status = 'pending'
        and r.institution_id = m.matched_institution_id
        and lower(btrim(r.input_name)) = lower(btrim(p_name))
        and coalesce(r.input_source_system, '') = coalesce(p_source_system, '')
        and coalesce(r.input_source_identifier, '') = coalesce(p_source_identifier, '')
    )
    returning *
  )
  select * from inserted;
end;
$$;

-- ------------------------------------------------------------
-- 2c. Decide a match: confirm links the source identifier (single
--     transaction with the decision); reject records the reason.
--     Nothing is ever deleted or silently re-linked.
-- ------------------------------------------------------------
create or replace function public.decide_identity_review(
  p_review_id uuid,
  p_decision text,
  p_reason text
)
returns public.institution_identity_reviews
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.institution_identity_reviews;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'reviewer') then
    raise exception 'Only admins and reviewers can decide institution matches.' using errcode = '42501';
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    raise exception 'Decision must be "confirmed" or "rejected".' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required for every decision.' using errcode = '22023';
  end if;

  select * into v_row
  from public.institution_identity_reviews
  where id = p_review_id
  for update;

  if not found then
    raise exception 'Match review not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This match has already been decided.' using errcode = 'P0002';
  end if;

  if p_decision = 'confirmed'
     and v_row.input_source_system is not null
     and v_row.input_source_identifier is not null then
    -- Never silently re-point an existing mapping to another institution.
    if exists (
      select 1 from public.institution_identifiers ii
      where ii.source_system = btrim(v_row.input_source_system)
        and ii.source_identifier = btrim(v_row.input_source_identifier)
        and ii.institution_id <> v_row.institution_id
    ) then
      raise exception 'That source identifier is already linked to a different institution. Resolve the existing link first.'
        using errcode = '23505';
    end if;

    insert into public.institution_identifiers
      (institution_id, source_system, source_identifier, verification_status, first_seen_at, last_seen_at)
    values
      (v_row.institution_id, btrim(v_row.input_source_system), btrim(v_row.input_source_identifier),
       'verified', now(), now())
    on conflict (source_system, source_identifier) do update
      set verification_status = 'verified',
          last_seen_at = now();
  end if;

  update public.institution_identity_reviews
  set status = p_decision,
      reason = btrim(p_reason),
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_review_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ============================================================
-- 3. Duplicate / related-case suggestions
-- ============================================================
create table public.duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints on delete cascade,
  candidate_id uuid not null references public.complaints on delete cascade,
  suggestion text not null check (suggestion in ('Potential duplicate', 'Related but distinct')),
  reason text not null check (length(btrim(reason)) > 0),
  signals jsonb not null default '{}'::jsonb,
  subject_similarity real,
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  decision text check (decision is null or decision in
    ('Confirmed duplicate', 'Potential duplicate', 'Related but distinct', 'Not related')),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_pair check (complaint_id <> candidate_id),
  constraint decision_matches_status check ((status = 'pending') = (decision is null)),
  constraint decided_matches_status check ((status = 'pending') = (decided_at is null)),
  constraint decided_has_reason check (status = 'pending' or length(btrim(coalesce(decision_reason, ''))) > 0),
  unique (complaint_id, candidate_id)
);

-- Direction-insensitive pair uniqueness: (a,b) and (b,a) are one review.
create unique index uq_duplicate_reviews_pair
  on public.duplicate_reviews (least(complaint_id, candidate_id), greatest(complaint_id, candidate_id));

alter table public.duplicate_reviews enable row level security;

create policy "duplicate_reviews: read all" on public.duplicate_reviews
  for select to authenticated using (true);
create policy "duplicate_reviews: proposers insert" on public.duplicate_reviews
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
create policy "duplicate_reviews: reviewers decide" on public.duplicate_reviews
  for update to authenticated
  using (public.current_user_role() in ('admin', 'reviewer'))
  with check (public.current_user_role() in ('admin', 'reviewer'));

create trigger t_duplicate_reviews_updated_at before update on public.duplicate_reviews
  for each row execute function public.set_updated_at();

create index idx_duplicate_reviews_status on public.duplicate_reviews (status, created_at);
create index idx_duplicate_reviews_complaint on public.duplicate_reviews (complaint_id);
create index idx_duplicate_reviews_candidate on public.duplicate_reviews (candidate_id);

-- ------------------------------------------------------------
-- 3a. Candidate pairs — deterministic pre-filter only:
--     same institution + same category, OR normalized subjects that
--     look alike. Classification (the human-readable reason) happens
--     in src/lib/duplicates.ts so it is unit-testable against the
--     labelled fixture set. Pairs already reviewed are never re-proposed.
-- ------------------------------------------------------------
create or replace function public.get_duplicate_candidate_pairs(
  p_complaint_id uuid default null,
  p_limit integer default 200
)
returns table (
  primary_id uuid,
  primary_reference text,
  primary_subject text,
  primary_bureau text,
  primary_institution_id uuid,
  primary_category text,
  primary_status text,
  primary_received timestamptz,
  candidate_id uuid,
  candidate_reference text,
  candidate_subject text,
  candidate_bureau text,
  candidate_institution_id uuid,
  candidate_category text,
  candidate_status text,
  candidate_received timestamptz,
  same_institution boolean,
  same_category boolean,
  days_apart integer,
  subject_similarity real
)
language sql
stable
set search_path = public
as $$
  select
    p.id, p.complaint_reference, p.subject, p.bureau, p.institution_id, p.category, p.status, p.date_received,
    c.id, c.complaint_reference, c.subject, c.bureau, c.institution_id, c.category, c.status, c.date_received,
    (p.institution_id is not null and p.institution_id = c.institution_id),
    (p.category = c.category),
    floor(abs(extract(epoch from (p.date_received - c.date_received))) / 86400)::integer,
    similarity(p.normalized_subject, c.normalized_subject)::real
  from public.complaints p
  join public.complaints c on c.id <> p.id
  where (p_complaint_id is null or p.id = p_complaint_id)
    and (
      (p.institution_id is not null and p.institution_id = c.institution_id and p.category = c.category)
      or similarity(p.normalized_subject, c.normalized_subject) >= 0.45
    )
    and (
      p_complaint_id is not null  -- scanning one complaint: any status pair
      or p.id < c.id              -- full scan: each unordered pair once
    )
    and not exists (
      select 1 from public.duplicate_reviews d
      where least(d.complaint_id, d.candidate_id) = least(p.id, c.id)
        and greatest(d.complaint_id, d.candidate_id) = greatest(p.id, c.id)
    )
  order by
    (p.institution_id is not null and p.institution_id = c.institution_id and p.category = c.category) desc,
    similarity(p.normalized_subject, c.normalized_subject) desc,
    p.date_received asc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- ------------------------------------------------------------
-- 3b. Record a suggestion (idempotent: an existing pair — including
--     a reviewed decision — is never overwritten)
-- ------------------------------------------------------------
create or replace function public.upsert_duplicate_review(
  p_complaint_id uuid,
  p_candidate_id uuid,
  p_suggestion text,
  p_reason text,
  p_signals jsonb default '{}'::jsonb,
  p_subject_similarity real default null
)
returns public.duplicate_reviews
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_a uuid;
  v_b uuid;
  v_row public.duplicate_reviews;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role = 'read_only' then
    raise exception 'Your account has read-only access and cannot create duplicate suggestions.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'bureau_official', 'reviewer') then
    raise exception 'Your role cannot create duplicate suggestions.' using errcode = '42501';
  end if;
  if p_suggestion not in ('Potential duplicate', 'Related but distinct') then
    raise exception 'Suggestion must be "Potential duplicate" or "Related but distinct".' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A human-readable reason is required with every suggestion.' using errcode = '22023';
  end if;
  if p_complaint_id = p_candidate_id then
    raise exception 'A complaint cannot be a duplicate of itself.' using errcode = '22023';
  end if;

  -- Both complaints must be visible to the caller (RLS applies).
  perform 1 from public.complaints where id = p_complaint_id;
  if not found then
    raise exception 'Complaint not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.complaints where id = p_candidate_id;
  if not found then
    raise exception 'Complaint not found.' using errcode = 'P0002';
  end if;

  v_a := least(p_complaint_id, p_candidate_id);
  v_b := greatest(p_complaint_id, p_candidate_id);

  insert into public.duplicate_reviews
    (complaint_id, candidate_id, suggestion, reason, signals, subject_similarity)
  values (v_a, v_b, p_suggestion, btrim(p_reason), coalesce(p_signals, '{}'::jsonb), p_subject_similarity)
  on conflict (complaint_id, candidate_id) do nothing;

  select * into v_row from public.duplicate_reviews
  where complaint_id = v_a and candidate_id = v_b;

  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 3c. Reviewer decision on a suggestion
-- ------------------------------------------------------------
create or replace function public.decide_duplicate_review(
  p_review_id uuid,
  p_decision text,
  p_reason text
)
returns public.duplicate_reviews
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.duplicate_reviews;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'reviewer') then
    raise exception 'Only admins and reviewers can decide duplicate suggestions.' using errcode = '42501';
  end if;
  if p_decision not in ('Confirmed duplicate', 'Potential duplicate', 'Related but distinct', 'Not related') then
    raise exception 'Unknown decision for a duplicate suggestion.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required for every decision.' using errcode = '22023';
  end if;

  select * into v_row from public.duplicate_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Duplicate review not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This suggestion has already been reviewed.' using errcode = 'P0002';
  end if;

  update public.duplicate_reviews
  set status = 'reviewed',
      decision = p_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_reason = btrim(p_reason)
  where id = p_review_id
  returning * into v_row;

  -- Appear in the complaint timeline as well.
  insert into public.complaint_audit (complaint_id, action, old_value, new_value, changed_by, notes)
  values (v_row.complaint_id, 'duplicate_decision', v_row.suggestion, p_decision, auth.uid(), btrim(p_reason));

  return v_row;
end;
$$;

-- ============================================================
-- 4. Cross-bureau coordination
-- ============================================================

-- Reviewer assignment column (workflow: assign reviewer, then decide).
alter table public.coordination_flags
  add column assigned_to uuid references auth.users on delete set null;

-- One open flag per (complaint, type); a dismissed flag may be
-- re-raised later if the data changes again.
create unique index uq_coord_flags_pending
  on public.coordination_flags (complaint_id, flag_type) where review_status = 'pending';
create unique index uq_coord_flags_accepted
  on public.coordination_flags (complaint_id, flag_type) where review_status = 'accepted';

-- ------------------------------------------------------------
-- 4a. SLA view gains the raw thresholds (flag generation and UI
--     show why a case counts as stale/due without recomputing)
-- ------------------------------------------------------------
create or replace view public.v_complaint_sla
with (security_invoker = true) as
select
  c.id,
  c.complaint_reference,
  c.bureau,
  c.category,
  c.priority,
  c.status,
  c.subject,
  c.date_received,
  c.due_date,
  c.last_activity_at,
  c.institution_id,
  r.id                                   as sla_rule_id,
  (r.id is not null)                     as sla_rule_matched,
  coalesce(c.due_date, c.date_received + make_interval(days => r.resolution_period)) as effective_due_date,
  floor(extract(epoch from (now() - c.date_received)) / 86400)::integer              as days_open,
  floor(extract(epoch from (now() - c.last_activity_at)) / 86400)::integer           as days_since_activity,
  public.complaint_attention_state(
    c.status, c.date_received, c.due_date, c.last_activity_at,
    r.warning_threshold, r.escalation_threshold, r.resolution_period, r.stale_days
  ) as attention_state,
  r.warning_threshold    as sla_warning_threshold,
  r.escalation_threshold as sla_escalation_threshold,
  r.resolution_period    as sla_resolution_period,
  r.stale_days           as sla_stale_days
from public.complaints c
left join lateral (
  select sr.*
  from public.sla_rules sr
  where sr.is_active
    and (sr.bureau is null or sr.bureau = c.bureau)
    and (sr.category is null or sr.category = c.category)
    and (sr.priority is null or sr.priority = c.priority)
  order by (sr.bureau is not null)::int + (sr.category is not null)::int + (sr.priority is not null)::int desc
  limit 1
) r on true;

-- ------------------------------------------------------------
-- 4b. Grouped cross-bureau overview per institution
-- ------------------------------------------------------------
create or replace view public.v_institution_cross_bureau
with (security_invoker = true) as
select
  i.id                                   as institution_id,
  i.name                                 as institution_name,
  i.city                                 as institution_city,
  c.bureau                               as bureau,
  count(*)                               as total_cases,
  count(*) filter (where c.status not in ('Resolved', 'Closed')) as active_cases,
  count(*) filter (where c.due_date is not null and c.due_date < now()
                     and c.status not in ('Resolved', 'Closed')) as overdue_cases,
  min(c.date_received)                   as earliest_received,
  max(c.last_activity_at)                as last_activity,
  min(c.due_date) filter (where c.status not in ('Resolved', 'Closed')) as next_due_date
from public.institutions i
join public.complaints c on c.institution_id = i.id
group by i.id, i.name, i.city, c.bureau;

-- ------------------------------------------------------------
-- 4c. Institution overview (detail page roll-ups; counts follow
--     the caller's RLS so per-role numbers stay honest)
-- ------------------------------------------------------------
create or replace view public.v_institution_overview
with (security_invoker = true) as
select
  i.id,
  i.name,
  i.normalized_name,
  i.country,
  i.city,
  i.established_year,
  i.created_at,
  i.updated_at,
  (select count(*) from public.complaints c where c.institution_id = i.id) as complaint_count,
  (select count(*) from public.complaints c
    where c.institution_id = i.id and c.status not in ('Resolved', 'Closed')) as active_count,
  (select count(distinct c.bureau) from public.complaints c where c.institution_id = i.id) as bureau_count,
  (select count(*) from public.institution_identifiers ii where ii.institution_id = i.id) as identifier_count,
  (select count(*) from public.institution_identifiers ii
    where ii.institution_id = i.id and ii.verification_status = 'verified') as verified_identifier_count,
  (select count(*) from public.institution_identity_reviews r
    where r.institution_id = i.id and r.status = 'pending') as pending_match_reviews,
  (select max(c.last_activity_at) from public.complaints c where c.institution_id = i.id) as last_case_activity
from public.institutions i;

-- ------------------------------------------------------------
-- 4d. Role lookup helper (profiles RLS hides other users' rows
--     from reviewers, but assigning a reviewer must verify the
--     target's role — this exposes only the role enum)
-- ------------------------------------------------------------
create or replace function public.profile_role_of(p_user_id uuid)
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$ select role from public.profiles where id = p_user_id $$;

revoke all on function public.profile_role_of(uuid) from public;
grant execute on function public.profile_role_of(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4e. Refresh coordination flags — explainable signals only.
--     SECURITY DEFINER: flags must be generated from ALL bureaus'
--     cases (the caller's RLS would hide the others). Readable by
--     everyone; created only by admins/reviewers or the service role.
--     Dedupe: a pending or accepted flag of the same type blocks a
--     re-run; a dismissed flag may be re-raised when data changes.
-- ------------------------------------------------------------
create or replace function public.refresh_coordination_flags(p_lookback_days integer default 180)
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
    raise exception 'Only admins and reviewers can refresh coordination flags.' using errcode = '42501';
  end if;

  -- multiple_bureaus: anchor on the oldest active case
  insert into public.coordination_flags (complaint_id, flag_type, explanation, evidence, generated_at)
  with active as (
    select c.* from public.complaints c
    where c.institution_id is not null
      and c.status not in ('Resolved', 'Closed')
  ),
  grouped as (
    select a.institution_id,
           array_agg(distinct a.bureau) as bureaus,
           array_agg(a.complaint_reference order by a.date_received) as refs
    from active a
    group by a.institution_id
    having count(distinct a.bureau) >= 2
  ),
  anchor as (
    select distinct on (g.institution_id)
           g.institution_id, g.bureaus, g.refs, a.id as complaint_id
    from grouped g
    join active a on a.institution_id = g.institution_id
    order by g.institution_id, a.date_received asc, a.id asc
  )
  select
    an.complaint_id,
    'multiple_bureaus'::public.coordination_flag_type,
    format('Active cases at this institution span %s bureaus (%s). Review for coordinated handling.',
           array_length(an.bureaus, 1), array_to_string(an.bureaus, ', ')),
    jsonb_build_object('bureaus', to_jsonb(an.bureaus), 'complaint_refs', to_jsonb(an.refs)),
    now()
  from anchor an
  where not exists (
    select 1 from public.coordination_flags f
    where f.complaint_id = an.complaint_id
      and f.flag_type = 'multiple_bureaus'::public.coordination_flag_type
      and f.review_status in ('pending', 'accepted')
  );
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- overlapping_subjects: active, cross-bureau, similar subjects
  insert into public.coordination_flags (complaint_id, flag_type, explanation, evidence, generated_at)
  select
    b.id,
    'overlapping_subjects'::public.coordination_flag_type,
    format('Subject overlaps with %s (%s bureau) at the same institution — similarity %s.',
           a.complaint_reference, a.bureau,
           round(similarity(a.normalized_subject, b.normalized_subject)::numeric, 2)),
    jsonb_build_object(
      'related_refs', jsonb_build_array(a.complaint_reference),
      'related_bureau', a.bureau,
      'subject_similarity', round(similarity(a.normalized_subject, b.normalized_subject)::numeric, 3)
    ),
    now()
  from public.complaints a
  join public.complaints b
    on b.institution_id = a.institution_id
   and a.institution_id is not null
   and b.id <> a.id
   and a.id < b.id
   and a.bureau <> b.bureau
   and a.status not in ('Resolved', 'Closed')
   and b.status not in ('Resolved', 'Closed')
   and similarity(a.normalized_subject, b.normalized_subject) >= 0.5
  where not exists (
    select 1 from public.coordination_flags f
    where f.complaint_id = b.id
      and f.flag_type = 'overlapping_subjects'::public.coordination_flag_type
      and f.review_status in ('pending', 'accepted')
  );
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- repeated_reassignment: 2+ recorded reassignments on an open case
  insert into public.coordination_flags (complaint_id, flag_type, explanation, evidence, generated_at)
  select
    c.id,
    'repeated_reassignment'::public.coordination_flag_type,
    format('This case has been reassigned %s times — review whether ownership is stable.', n.reassignments),
    jsonb_build_object('reassignments', n.reassignments),
    now()
  from (
    select a.complaint_id, count(*) as reassignments
    from public.complaint_audit a
    where a.action = 'reassignment'
    group by a.complaint_id
    having count(*) >= 2
  ) n
  join public.complaints c on c.id = n.complaint_id
  where c.status not in ('Resolved', 'Closed')
    and not exists (
      select 1 from public.coordination_flags f
      where f.complaint_id = c.id
        and f.flag_type = 'repeated_reassignment'::public.coordination_flag_type
        and f.review_status in ('pending', 'accepted')
    );
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- inconsistent_status: related case resolved while this one is open
  insert into public.coordination_flags (complaint_id, flag_type, explanation, evidence, generated_at)
  select
    b.id,
    'inconsistent_status'::public.coordination_flag_type,
    format('Related case %s is "%s" while this case is "%s" — statuses may be out of step.',
           a.complaint_reference, a.status, b.status),
    jsonb_build_object(
      'related_refs', jsonb_build_array(a.complaint_reference),
      'related_status', a.status,
      'related_category', a.category
    ),
    now()
  from public.complaints a
  join public.complaints b
    on b.institution_id = a.institution_id
   and a.institution_id is not null
   and b.id <> a.id
   and a.status in ('Resolved', 'Closed')
   and b.status not in ('Resolved', 'Closed')
   and (a.category = b.category
        or similarity(a.normalized_subject, b.normalized_subject) >= 0.5)
  where not exists (
    select 1 from public.coordination_flags f
    where f.complaint_id = b.id
      and f.flag_type = 'inconsistent_status'::public.coordination_flag_type
      and f.review_status in ('pending', 'accepted')
  );
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- approaching_deadline / overdue: straight from the SQL attention state
  insert into public.coordination_flags (complaint_id, flag_type, explanation, evidence, generated_at)
  select
    s.id,
    'approaching_deadline'::public.coordination_flag_type,
    case
      when s.attention_state = 'Overdue'
        then format('Overdue — effective due date %s has passed (day %s of the case).',
                    s.effective_due_date::date, s.days_open)
      else format('Approaching deadline — effective due date %s (day %s of the case).',
                  s.effective_due_date::date, s.days_open)
    end,
    jsonb_build_object(
      'attention_state', s.attention_state,
      'effective_due_date', s.effective_due_date,
      'days_open', s.days_open,
      'sla_rule_id', s.sla_rule_id
    ),
    now()
  from public.v_complaint_sla s
  where s.status not in ('Resolved', 'Closed')
    and s.attention_state in ('Approaching Deadline', 'Overdue')
    and not exists (
      select 1 from public.coordination_flags f
      where f.complaint_id = s.id
        and f.flag_type = 'approaching_deadline'::public.coordination_flag_type
        and f.review_status in ('pending', 'accepted')
    );
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- stale_case: past the configured stale threshold (config absent -> no flag)
  insert into public.coordination_flags (complaint_id, flag_type, explanation, evidence, generated_at)
  select
    s.id,
    'stale_case'::public.coordination_flag_type,
    format('No activity for %s days (stale threshold %s days).',
           s.days_since_activity, s.sla_stale_days),
    jsonb_build_object(
      'days_since_activity', s.days_since_activity,
      'stale_threshold_days', s.sla_stale_days,
      'sla_rule_id', s.sla_rule_id
    ),
    now()
  from public.v_complaint_sla s
  where s.status not in ('Resolved', 'Closed')
    and s.sla_stale_days is not null
    and s.days_since_activity > s.sla_stale_days
    and not exists (
      select 1 from public.coordination_flags f
      where f.complaint_id = s.id
        and f.flag_type = 'stale_case'::public.coordination_flag_type
        and f.review_status in ('pending', 'accepted')
    );
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- p_lookback_days is reserved for time-boxed re-raising of
  -- dismissed flags; until data changes, dismissed stays dismissed.
  return v_total;
end;
$$;

-- ------------------------------------------------------------
-- 4f. Flag workflow: assign a reviewer, then decide — both audited
--     on the complaint timeline. Never auto-transfers a case.
-- ------------------------------------------------------------
create or replace function public.assign_coordination_flag(
  p_flag_id uuid,
  p_reviewer_id uuid
)
returns public.coordination_flags
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_target public.user_role;
  v_row public.coordination_flags;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'reviewer') then
    raise exception 'Only admins and reviewers can assign flag reviewers.' using errcode = '42501';
  end if;

  v_target := public.profile_role_of(p_reviewer_id);
  if v_target is null then
    raise exception 'That user does not exist.' using errcode = 'P0002';
  end if;
  if v_target not in ('reviewer', 'admin') then
    raise exception 'That user is not a reviewer, so they cannot be assigned a flag.' using errcode = '22023';
  end if;

  select * into v_row from public.coordination_flags where id = p_flag_id for update;
  if not found then
    raise exception 'Coordination flag not found.' using errcode = 'P0002';
  end if;

  update public.coordination_flags
  set assigned_to = p_reviewer_id
  where id = p_flag_id
  returning * into v_row;

  insert into public.complaint_audit (complaint_id, action, new_value, changed_by, notes)
  values (v_row.complaint_id, 'flag_assigned', p_reviewer_id::text, auth.uid(),
          format('%s flag assigned for review.', v_row.flag_type));

  return v_row;
end;
$$;

create or replace function public.decide_coordination_flag(
  p_flag_id uuid,
  p_decision text,
  p_notes text
)
returns public.coordination_flags
language plpgsql
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_row public.coordination_flags;
begin
  if v_role is null then
    raise exception 'You are signed out. Please sign in again.' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'reviewer') then
    raise exception 'Only admins and reviewers can decide coordination flags.' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'dismissed') then
    raise exception 'Decision must be "accepted" or "dismissed".' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Notes are required for every flag decision.' using errcode = '22023';
  end if;

  select * into v_row from public.coordination_flags where id = p_flag_id for update;
  if not found then
    raise exception 'Coordination flag not found.' using errcode = 'P0002';
  end if;
  if v_row.review_status <> 'pending' then
    raise exception 'This flag has already been decided.' using errcode = 'P0002';
  end if;

  update public.coordination_flags
  set review_status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      decision_notes = btrim(p_notes)
  where id = p_flag_id
  returning * into v_row;

  insert into public.complaint_audit (complaint_id, action, old_value, new_value, changed_by, notes)
  values (v_row.complaint_id, 'flag_decision', 'pending', p_decision, auth.uid(),
          format('%s: %s', v_row.flag_type, btrim(p_notes)));

  return v_row;
end;
$$;

-- ============================================================
-- 5. Grants + defence in depth
-- ============================================================
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Re-assert audit immutability (the blanket grant above re-granted it).
revoke update, truncate, delete on public.complaint_audit from authenticated, service_role;

grant execute on function public.find_institution_matches(text, text, text, text, integer) to authenticated, service_role;
grant execute on function public.propose_institution_matches(text, text, text, text, integer) to authenticated, service_role;
grant execute on function public.decide_identity_review(uuid, text, text) to authenticated, service_role;
grant execute on function public.get_duplicate_candidate_pairs(uuid, integer) to authenticated, service_role;
grant execute on function public.upsert_duplicate_review(uuid, uuid, text, text, jsonb, real) to authenticated, service_role;
grant execute on function public.decide_duplicate_review(uuid, text, text) to authenticated, service_role;
grant execute on function public.refresh_coordination_flags(integer) to authenticated, service_role;
grant execute on function public.assign_coordination_flag(uuid, uuid) to authenticated, service_role;
grant execute on function public.decide_coordination_flag(uuid, text, text) to authenticated, service_role;

grant select on public.v_institution_cross_bureau to authenticated, service_role;
grant select on public.v_institution_overview to authenticated, service_role;
