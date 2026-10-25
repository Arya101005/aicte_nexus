-- ============================================================
-- AICTE Nexus — 0002: atomic complaint updates + attention states
-- ============================================================

-- ------------------------------------------------------------
-- 1. Atomic complaint update + audit entry.
--    SECURITY INVOKER: the caller's RLS applies to both statements,
--    and the function body runs as a single transaction — either the
--    complaint AND its audit row are written, or neither is.
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
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_bureau text := public.current_user_bureau();
  v_old public.complaints;
  v_new public.complaints;
  v_action text;
  v_old_value text;
  v_new_value text;
begin
  -- Friendly, explicit authorization errors (no stack traces leak).
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

  -- Derive what actually changed for a human-readable audit row.
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
  values (p_complaint_id, v_action, v_old_value, v_new_value, auth.uid(), p_notes);

  return next v_new;
end;
$$;

revoke all on function public.update_complaint_with_audit(uuid, public.complaint_status, public.complaint_priority, uuid, text) from public;
-- anon may execute it only so a signed-out caller gets the friendly
-- "You are signed out" message instead of a raw permission error; the
-- function raises before touching any row, and RLS still applies.
grant execute on function public.update_complaint_with_audit(uuid, public.complaint_status, public.complaint_priority, uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. Attention state — computed in SQL, never in the browser.
--    Precedence (documented in docs/DECISIONS.md):
--      resolved/closed -> Normal
--      no matching SLA rule -> Normal (age is shown instead; never "Overdue")
--      age > escalation_threshold       -> Escalation Review Required
--      past effective due date          -> Overdue
--      no activity for stale_days       -> Stale
--      within warning_threshold of due  -> Approaching Deadline
--      otherwise                        -> Normal
-- ------------------------------------------------------------
create or replace function public.complaint_attention_state(
  p_status public.complaint_status,
  p_date_received timestamptz,
  p_due_date timestamptz,
  p_last_activity timestamptz,
  p_warning_threshold integer,
  p_escalation_threshold integer,
  p_resolution_period integer,
  p_stale_days integer
)
returns text
language sql
stable
as $$
  select case
    when p_status in ('Resolved', 'Closed') then 'Normal'
    when p_warning_threshold is null then 'Normal'
    when now() - p_date_received > make_interval(days => p_escalation_threshold)
      then 'Escalation Review Required'
    when now() > coalesce(p_due_date, p_date_received + make_interval(days => p_resolution_period))
      then 'Overdue'
    when now() - p_last_activity > make_interval(days => p_stale_days)
      then 'Stale'
    when now() >= coalesce(p_due_date, p_date_received + make_interval(days => p_resolution_period))
             - make_interval(days => p_warning_threshold)
      then 'Approaching Deadline'
    else 'Normal'
  end;
$$;

-- ------------------------------------------------------------
-- 3. SLA view — joins the most specific active rule and exposes
--    attention state, effective due date and case age.
--    security_invoker => caller's RLS applies to the underlying rows.
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
  ) as attention_state
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

grant select on public.v_complaint_sla to authenticated, service_role;