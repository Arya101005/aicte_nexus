-- Idempotent notification seed: insert only when the referenced
-- review or import job exists, then mark them read so the unread
-- badge starts at zero for demo users.
insert into public.notifications (user_id, type, entity_type, entity_id, title, body, link, dedupe_key, read_at)
select
  p.id,
  'duplicate_review',
  'duplicate_review',
  dup.id,
  'Duplicate suggestion needs review',
  format('%s vs %s — %s', c1.complaint_reference, c2.complaint_reference, dup.reason),
  '/duplicates',
  'dup:' || dup.id,
  now()
from public.duplicate_reviews dup
join public.complaints c1 on c1.id = dup.complaint_id
join public.complaints c2 on c2.id = dup.candidate_id
cross join public.profiles p
where p.role in ('admin', 'reviewer')
  and dup.status = 'pending'
on conflict (user_id, dedupe_key) do nothing;

update public.notifications
set read_at = coalesce(read_at, now())
where type in ('duplicate_review', 'assignment', 'reassignment')
  and user_id in (select id from public.profiles where role in ('admin', 'reviewer'))
  and read_at is null;
