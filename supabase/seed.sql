-- ============================================================
-- AICTE Nexus - Seed Data (Synthetic, labelled)
-- ============================================================

-- Insert sample roles
INSERT INTO profiles (id, role, bureau, created_at, updated_at) VALUES
  (gen_random_uuid(), 'admin', NULL, now(), now()),
  (gen_random_uuid(), 'bureau_official', 'AICTE', now(), now()),
  (gen_random_uuid(), 'bureau_official', 'UGC', now(), now()),
  (gen_random_uuid(), 'reviewer', NULL, now(), now()),
  (gen_random_uuid(), 'read_only', NULL, now(), now());

-- Insert sample institutions
INSERT INTO institutions (id, name, country, city, established_year, created_at, updated_at) VALUES
  (gen_random_uuid(), 'Indian Institute of Technology Delhi', 'India', 'New Delhi', 1961, now(), now()),
  (gen_random_uuid(), 'University of Mumbai', 'India', 'Mumbai', 1857, now(), now()),
  (gen_random_uuid(), 'National Institute of Technology Trichy', 'India', 'Trichy', 1964, now(), now()),
  (gen_random_uuid(), 'College of Engineering Pune', 'India', 'Pune', 1854, now(), now()),
  (gen_random_uuid(), 'Visvesvaraya National Institute of Technology', 'India', 'Nagpur', 1984, now(), now());

-- Insert institution identifiers
INSERT INTO institution_identifiers (id, institution_id, source_system, source_identifier, verification_status, first_seen_at, last_seen_at) VALUES
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'Indian Institute of Technology Delhi'), 'AICTE', 'IIT-DL-1961', 'verified', now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'University of Mumbai'), 'AICTE', 'MU-2020', 'verified', now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'National Institute of Technology Trichy'), 'UGC', 'NIT-TRICHY-84', 'verified', now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'College of Engineering Pune'), 'AICTE', 'COEP-1854', 'pending', now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'Visvesvaraya National Institute of Technology'), 'AICTE', 'VNIT-84', 'verified', now(), now());

-- Insert sample complaints
INSERT INTO complaints (id, institution_id, bureau, complaint_reference, source_system, source_reference, category, priority, status, subject, description, date_received, due_date, assigned_to, created_at, updated_at) VALUES
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'Indian Institute of Technology Delhi'), 'AICTE', 'COMP-2024-001', 'AICTE', 'AICTE-REF-001', 'Facilities', 'High', 'Open', 'Hostel facility issues', 'Complaints about hostel maintenance and cleanliness', '2024-01-15 10:00:00', '2024-02-15 10:00:00', NULL, now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'University of Mumbai'), 'UGC', 'COMP-2024-002', 'UGC', 'UGC-REF-002', 'Academic', 'Medium', 'In Progress', 'Curriculum review', 'Request for curriculum revision', '2024-02-10 09:00:00', '2024-03-12 09:00:00', NULL, now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'National Institute of Technology Trichy'), 'AICTE', 'COMP-2024-003', 'AICTE', 'AICTE-REF-003', 'Placement', 'High', 'Awaiting Information', 'Placement cell vacancy', 'Insufficient placement opportunities', '2024-03-01 14:30:00', '2024-03-20 14:30:00', NULL, now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'College of Engineering Pune'), 'AICTE', 'COMP-2024-004', 'AICTE', 'AICTE-REF-004', 'Facilities', 'Urgent', 'Open', 'Electrical safety', 'Live wires exposed in main building', '2024-01-20 11:00:00', '2024-01-27 11:00:00', NULL, now(), now()),
  (gen_random_uuid(), (SELECT id FROM institutions WHERE name = 'Visvesvaraya National Institute of Technology'), 'AICTE', 'COMP-2024-005', 'AICTE', 'AICTE-REF-005', 'Anti-ragging', 'Medium', 'Resolved', 'Ragging incident', 'Reported ragging case, action taken', '2024-02-15 09:30:00', '2024-03-01 09:30:00', NULL, now(), now());

-- Insert SLA rules
INSERT INTO sla_rules (id, bureau, category, priority, response_period, resolution_period, warning_threshold, escalation_threshold, stale_days, is_active, created_at, updated_at) VALUES
  (gen_random_uuid(), 'AICTE', 'Facilities', 'High', 3, 14, 10, 21, 30, true, now(), now()),
  (gen_random_uuid(), 'AICTE', 'Academic', 'Medium', 5, 30, 20, 45, 60, true, now(), now()),
  (gen_random_uuid(), 'UGC', 'Academic', 'Medium', 5, 30, 20, 45, 60, true, now(), now()),
  (gen_random_uuid(), 'AICTE', 'Placement', 'High', 3, 14, 10, 21, 30, true, now(), now()),
  (gen_random_uuid(), 'AICTE', 'Anti-ragging', 'Medium', 3, 7, 5, 14, 21, true, now(), now());

-- Insert coordination flags (some sample flags)
INSERT INTO coordination_flags (id, complaint_id, flag_type, description, generated_at, reviewed, reviewed_by, reviewed_at, decision, notes) VALUES
  (gen_random_uuid(), (SELECT id FROM complaints WHERE complaint_reference = 'COMP-2024-001'), 'approaching_deadline', 'Case approaching due date (2024-02-15)', '2024-01-20 10:00:00', false, NULL, NULL, NULL, NULL),
  (gen_random_uuid(), (SELECT id FROM complaints WHERE complaint_reference = 'COMP-2024-003'), 'stale_case', 'No activity for 20+ days', '2024-03-10 14:30:00', false, NULL, NULL, NULL, NULL),
  (gen_random_uuid(), (SELECT id FROM complaints WHERE complaint_reference = 'COMP-2024-004'), 'approaching_deadline', 'Urgent case - due date 2024-01-27', '2024-01-22 11:00:00', false, NULL, NULL, NULL, NULL);

-- Grant necessary permissions
GRANT ALL ON ALL TABLES TO service_role;
GRANT SELECT ON ALL TABLES TO authenticated;