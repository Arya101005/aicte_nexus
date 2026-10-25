-- ============================================================
-- AICTE Nexus — SYNTHETIC DEMO SEED
-- ============================================================
-- EVERYTHING in this file is fabricated demo data. It does not
-- represent any real institution, complaint, official or outcome.
-- Demo login (local development only — never a production account):
--   admin@nexus.local / Demo123!        (admin)
--   aicte@nexus.local  / Demo123!       (bureau_official, AICTE)
--   ugc@nexus.local    / Demo123!       (bureau_official, UGC)
--   reviewer@nexus.local / Demo123!     (reviewer)
--   viewer@nexus.local / Demo123!       (read_only)
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Synthetic auth users (profiles are auto-provisioned as
--    read_only by the on_auth_user_created trigger)
-- ------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  u.email,
  crypt('Demo123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(),
  now()
from (values
  ('admin@nexus.local',   'Synthetic Admin'),
  ('aicte@nexus.local',   'Synthetic AICTE Official'),
  ('ugc@nexus.local',     'Synthetic UGC Official'),
  ('reviewer@nexus.local','Synthetic Reviewer'),
  ('viewer@nexus.local',  'Synthetic Viewer')
) as u(email, full_name)
where not exists (select 1 from auth.users e where e.email = u.email);

-- ------------------------------------------------------------
-- 2. Assign demo roles/bureaus
-- ------------------------------------------------------------
update public.profiles p set role = 'admin', bureau = null, full_name = 'Synthetic Admin'
  from auth.users u where u.id = p.id and u.email = 'admin@nexus.local';
update public.profiles p set role = 'bureau_official', bureau = 'AICTE', full_name = 'Synthetic AICTE Official'
  from auth.users u where u.id = p.id and u.email = 'aicte@nexus.local';
update public.profiles p set role = 'bureau_official', bureau = 'UGC', full_name = 'Synthetic UGC Official'
  from auth.users u where u.id = p.id and u.email = 'ugc@nexus.local';
update public.profiles p set role = 'reviewer', bureau = null, full_name = 'Synthetic Reviewer'
  from auth.users u where u.id = p.id and u.email = 'reviewer@nexus.local';
update public.profiles p set role = 'read_only', bureau = null, full_name = 'Synthetic Viewer'
  from auth.users u where u.id = p.id and u.email = 'viewer@nexus.local';

-- ------------------------------------------------------------
-- 3. Synthetic institutions
-- ------------------------------------------------------------
insert into public.institutions (id, name, country, city, established_year)
select * from (values
  ('11111111-1111-1111-1111-111111111101'::uuid, 'Suryagarh Institute of Technology', 'India', 'Jaipur', 1998),
  ('11111111-1111-1111-1111-111111111102'::uuid, 'Chandrika University', 'India', 'Kochi', 1965),
  ('11111111-1111-1111-1111-111111111103'::uuid, 'National Polytechnic Nagpur', 'India', 'Nagpur', 1984),
  ('11111111-1111-1111-1111-111111111104'::uuid, 'Deccan College of Engineering', 'India', 'Pune', 1854),
  ('11111111-1111-1111-1111-111111111105'::uuid, 'Vindhya Institute of Management', 'India', 'Bhopal', 2001)
) as v(id, name, country, city, established_year)
where not exists (select 1 from public.institutions where id = v.id);

-- ------------------------------------------------------------
-- 4. Synthetic source-system identifiers
-- ------------------------------------------------------------
insert into public.institution_identifiers
  (id, institution_id, source_system, source_identifier, verification_status, first_seen_at, last_seen_at)
select * from (values
  ('22211111-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, 'AICTE', 'SYN-AICTE-1998-001', 'verified'::public.verification_status, now() - interval '90 days', now() - interval '5 days'),
  ('22211111-1111-1111-1111-111111111102'::uuid, '11111111-1111-1111-1111-111111111102'::uuid, 'UGC',  'SYN-UGC-1965-042',   'verified'::public.verification_status, now() - interval '80 days', now() - interval '12 days'),
  ('22211111-1111-1111-1111-111111111103'::uuid, '11111111-1111-1111-1111-111111111103'::uuid, 'AICTE', 'SYN-AICTE-1984-113', 'pending'::public.verification_status,  now() - interval '30 days', now() - interval '30 days'),
  ('22211111-1111-1111-1111-111111111104'::uuid, '11111111-1111-1111-1111-111111111104'::uuid, 'AICTE', 'SYN-AICTE-1854-006', 'verified'::public.verification_status, now() - interval '60 days', now() - interval '2 days'),
  ('22211111-1111-1111-1111-111111111105'::uuid, '11111111-1111-1111-1111-111111111105'::uuid, 'AICTE', 'SYN-AICTE-2001-208', 'disputed'::public.verification_status, now() - interval '20 days', now() - interval '20 days')
) as v(id, institution_id, source_system, source_identifier, verification_status, first_seen_at, last_seen_at)
where not exists (select 1 from public.institution_identifiers where source_system = v.source_system and source_identifier = v.source_identifier);

-- ------------------------------------------------------------
-- 5. Synthetic complaints (mixed bureaus, statuses, ages)
-- ------------------------------------------------------------
insert into public.complaints (
  id, institution_id, bureau, complaint_reference, source_system, source_reference,
  category, priority, status, subject, description,
  date_received, due_date, resolved_at, assigned_to, last_activity_at
)
select * from (values
  ('33333333-1111-1111-1111-111111111101'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, 'AICTE', 'SYN-CMP-2026-001', 'AICTE', 'SYN-AICTE-REF-001',
   'Facilities', 'High'::public.complaint_priority, 'Open'::public.complaint_status, 'Hostel maintenance backlog',
   'Synthetic: reported delays in hostel repair work.',
   now() - interval '16 days', now() + interval '4 days', null, null::uuid, now() - interval '3 days'),
  ('33333333-1111-1111-1111-111111111102'::uuid, '11111111-1111-1111-1111-111111111102'::uuid, 'UGC', 'SYN-CMP-2026-002', 'UGC', 'SYN-UGC-REF-002',
   'Academic', 'Medium'::public.complaint_priority, 'In Progress'::public.complaint_status, 'Curriculum revision request',
   'Synthetic: request to review semester curriculum.',
   now() - interval '10 days', now() + interval '18 days', null, null::uuid, now() - interval '1 day'),
  ('33333333-1111-1111-1111-111111111103'::uuid, '11111111-1111-1111-1111-111111111103'::uuid, 'AICTE', 'SYN-CMP-2026-003', 'AICTE', 'SYN-AICTE-REF-003',
   'Placement', 'High'::public.complaint_priority, 'Awaiting Information'::public.complaint_status, 'Placement cell vacancy',
   'Synthetic: insufficient placement coordination.',
   now() - interval '50 days', now() - interval '35 days', null, null::uuid, now() - interval '25 days'),
  ('33333333-1111-1111-1111-111111111104'::uuid, '11111111-1111-1111-1111-111111111104'::uuid, 'AICTE', 'SYN-CMP-2026-004', 'AICTE', 'SYN-AICTE-REF-004',
   'Facilities', 'Urgent'::public.complaint_priority, 'Open'::public.complaint_status, 'Electrical safety inspection pending',
   'Synthetic: exposed wiring reported in main block.',
   now() - interval '2 days', now() + interval '1 day', null, null::uuid, now() - interval '2 hours'),
  ('33333333-1111-1111-1111-111111111105'::uuid, '11111111-1111-1111-1111-111111111105'::uuid, 'UGC', 'SYN-CMP-2026-005', 'UGC', 'SYN-UGC-REF-005',
   'Anti-ragging', 'Medium'::public.complaint_priority, 'Resolved'::public.complaint_status, 'Orientation programme follow-up',
   'Synthetic: resolved after committee review.',
   now() - interval '40 days', now() - interval '26 days', now() - interval '27 days', null::uuid, now() - interval '27 days'),
  ('33333333-1111-1111-1111-111111111106'::uuid, '11111111-1111-1111-1111-111111111101'::uuid, 'UGC', 'SYN-CMP-2026-006', 'UGC', 'SYN-UGC-REF-006',
   'Scholarships', 'Low'::public.complaint_priority, 'Open'::public.complaint_status, 'Scholarship disbursement delay',
   'Synthetic: disbursement cycle delayed for applicants.',
   now() - interval '20 days', now() + interval '10 days', null, null::uuid, now() - interval '15 days')
) as v(id, institution_id, bureau, complaint_reference, source_system, source_reference,
       category, priority, status, subject, description, date_received, due_date, resolved_at, assigned_to, last_activity_at)
where not exists (select 1 from public.complaints where complaint_reference = v.complaint_reference);

-- Assign one complaint to the synthetic AICTE official to show a real assignee.
update public.complaints c set assigned_to = u.id
  from auth.users u
  where u.email = 'aicte@nexus.local'
    and c.complaint_reference = 'SYN-CMP-2026-003'
    and c.assigned_to is null;

-- ------------------------------------------------------------
-- 6. Synthetic audit history (via the atomic RPC where possible)
-- ------------------------------------------------------------
insert into public.complaint_audit (complaint_id, action, old_value, new_value, changed_by, changed_at, notes)
select c.id, 'status_update', 'Open', 'In Progress', u.id, now() - interval '9 days',
       'Synthetic: triage completed.'
from public.complaints c, auth.users u
where c.complaint_reference = 'SYN-CMP-2026-002'
  and u.email = 'ugc@nexus.local'
  and not exists (select 1 from public.complaint_audit a where a.complaint_id = c.id);

-- ------------------------------------------------------------
-- 7. Synthetic SLA rules
-- ------------------------------------------------------------
insert into public.sla_rules (id, bureau, category, priority, response_period, resolution_period, warning_threshold, escalation_threshold, stale_days)
select * from (values
  ('44444444-1111-1111-1111-111111111101'::uuid, 'AICTE', 'Facilities', 'High'::public.complaint_priority, 3, 14, 7, 21, 14),
  ('44444444-1111-1111-1111-111111111102'::uuid, 'AICTE', 'Facilities', 'Urgent'::public.complaint_priority, 1, 7, 3, 10, 7),
  ('44444444-1111-1111-1111-111111111103'::uuid, 'UGC',  'Academic',  'Medium'::public.complaint_priority, 5, 30, 14, 45, 21),
  ('44444444-1111-1111-1111-111111111104'::uuid, null,   null,        null::public.complaint_priority,   5, 30, 14, 45, 30)
) as v(id, bureau, category, priority, response_period, resolution_period, warning_threshold, escalation_threshold, stale_days)
where not exists (select 1 from public.sla_rules where id = v.id);

-- ------------------------------------------------------------
-- 8. Synthetic coordination flags
-- ------------------------------------------------------------
insert into public.coordination_flags (id, complaint_id, flag_type, explanation, evidence, generated_at)
select
  gen_random_uuid(), c.id, 'approaching_deadline'::public.coordination_flag_type,
  'Synthetic: due date in 4 days with no recent action.',
  jsonb_build_object('due_date', c.due_date, 'days_left', 4),
  now() - interval '1 day'
from public.complaints c
where c.complaint_reference = 'SYN-CMP-2026-001'
  and not exists (
    select 1 from public.coordination_flags f
    where f.complaint_id = c.id and f.flag_type = 'approaching_deadline'
  );

insert into public.coordination_flags (id, complaint_id, flag_type, explanation, evidence, generated_at)
select
  gen_random_uuid(), c.id, 'stale_case'::public.coordination_flag_type,
  'Synthetic: no activity for 25 days on an open case.',
  jsonb_build_object('days_since_activity', 25),
  now() - interval '1 day'
from public.complaints c
where c.complaint_reference = 'SYN-CMP-2026-003'
  and not exists (
    select 1 from public.coordination_flags f
    where f.complaint_id = c.id and f.flag_type = 'stale_case'
  );