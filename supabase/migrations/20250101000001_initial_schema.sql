-- ============================================================
-- AICTE Nexus - Initial Schema Migration
-- ============================================================

-- Create enums
CREATE TYPE user_role AS ENUM ('admin', 'bureau_official', 'reviewer', 'read_only');
CREATE TYPE complaint_status AS ENUM ('Open', 'In Progress', 'Awaiting Information', 'Resolved', 'Closed');
CREATE TYPE complaint_priority AS ENUM ('Low', 'Medium', 'High', 'Urgent');
CREATE_TYPE coordination_flag_type AS ENUM ('multiple_bureaus', 'overlapping_subjects', 'repeated_reassignment', 'inconsistent_status', 'approaching_deadline', 'stale_case');
CREATE_TYPE import_job_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE_TYPE import_error_severity AS ENUM ('info', 'warning', 'error');

-- ============================================================
-- Profiles table - user roles and bureau affiliation
-- ============================================================
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'read_only',
  bureau VARCHAR(100), -- Bureau name/identifier
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for profiles
CREATE POLICY "Admin full access" ON profiles
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

CREATE POLICY "Bureau officials read own" ON profiles
  FOR SELECT TO authenticated USING (role = 'bureau_official' AND bureau = current_setting('app.bureau_id', true));

CREATE POLICY "Reviewers read own" ON profiles
  FOR SELECT TO authenticated USING (role = 'reviewer');

CREATE POLICY "Read only read own" ON profiles
  FOR SELECT TO authenticated USING (role = 'read_only');

-- Allow service_role full access (bypass RLS)
CREATE POLICY "Service role full access" ON profiles
  FOR ALL TO service_role USING (true WITH CHECK (true));

-- ============================================================
-- Institutions table - canonical institution list
-- ============================================================
CREATE TABLE institutions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) GENERATED ALWAYS AS (lower(trim(unaccent(name)))) STORED,
  country VARCHAR(100),
  city VARCHAR(100),
  established_year SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;

-- RLS policies - read only can view, admins/bureaus can CRUD
CREATE POLICY "Institutions read all" ON institutions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Institutions admin full access" ON institutions
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

-- ============================================================
-- Institution identifiers - source system mappings
-- ============================================================
CREATE TABLE institution_identifiers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID REFERENCES institutions ON DELETE CASCADE,
  source_system VARCHAR(100) NOT NULL, -- e.g., 'AICTE', 'UGC', 'manual'
  source_identifier VARCHAR(255) NOT NULL, -- e.g., institute code, AICTE ID
  verification_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, verified, disputed
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_identifier)
);

-- Enable RLS
ALTER TABLE institution_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Institution identifiers read all" ON institution_identifiers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Institution identifiers admin full access" ON institution_identifiers
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

-- ============================================================
-- Complaints table - main complaint records
-- ============================================================
CREATE TABLE complaints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  institution_id UUID REFERENCES institutions ON DELETE SET NULL,
  bureau VARCHAR(100) NOT NULL,
  complaint_reference VARCHAR(255) NOT NULL,
  source_system VARCHAR(100) NOT NULL, -- e.g., 'AICTE', 'UGC', 'manual'
  source_reference VARCHAR(255), -- external system reference
  category VARCHAR(100) NOT NULL,
  priority complaint_priority NOT NULL DEFAULT 'Medium',
  status complaint_status NOT NULL DEFAULT 'Open',
  subject TEXT NOT NULL,
  description TEXT,
  date_received TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Constraints
  UNIQUE (source_system, source_reference),
  CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  CHECK (status IN ('Open', 'In Progress', 'Awaiting Information', 'Resolved', 'Closed')),
  CHECK (due_date > date_received OR due_date IS NULL)
);

-- Enable RLS
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Complaints read by role" ON complaints
  FOR SELECT TO authenticated USING (
    role = 'admin' OR
    role = 'bureau_official' AND bureau = current_setting('app.bureau_id', true) OR
    role = 'reviewer' OR
    role = 'read_only'
  );

CREATE POLICY "Complaints insert by admin/bureau" ON complaints
  FOR INSERT TO authenticated WITH CHECK (
    role = 'admin' OR
    role = 'bureau_official'
  );

CREATE POLICY "Complaints update by admin/bureau" ON complaints
  FOR UPDATE TO authenticated USING (
    role = 'admin' OR
    (role = 'bureau_official' AND bureau = current_setting('app.bureau_id', true))
  )
  WITH CHECK (
    role = 'admin' OR
    (role = 'bureau_official' AND bureau = current_setting('app.bureau_id', true))
  );

-- ============================================================
-- Complaint audit table - insert-only for normal roles
-- ============================================================
CREATE TABLE complaint_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  complaint_id UUID REFERENCES complaints ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL, -- e.g., 'status_update', 'reassignment', 'priority_change'
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users ON DELETE SET NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  -- Constraints for insert-only
  CHECK (action IS NOT NULL)
);

-- Enable RLS
ALTER TABLE complaint_audit ENABLE ROW LEVEL SECURITY;

-- RLS policies - insert allowed for admin/bureau, select for all roles
CREATE POLICY "Audit insert admin/bureau" ON complaint_audit
  FOR INSERT TO authenticated WITH CHECK (
    role = 'admin' OR
    role = 'bureau_official'
  );

CREATE POLICY "Audit read all" ON complaint_audit
  FOR SELECT TO authenticated USING (true);

-- Create trigger for updated_at on complaints
CREATE OR REPLACE FUNCTION update_complaints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_complaints_updated_at_trigger
  BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION update_complaints_updated_at();

-- Create trigger for updated_at on profiles
CREATE OR REPLACE FUNCTION update_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_profiles_updated_at();

-- Create trigger for audit on complaint updates
CREATE OR REPLACE FUNCTION audit_complaint_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO complaint_audit (complaint_id, action, old_value, new_value, changed_by, notes)
  VALUES (
    NEW.id,
    CASE
      WHEN OLD.status != NEW.status THEN 'status_update'
      WHEN OLD.priority != NEW.priority THEN 'priority_change'
      WHEN OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN 'reassignment'
      ELSE 'complaint_update'
    END,
    OLD.status::text,
    NEW.status::text,
    auth.uid(),
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create the trigger for status/priority/assigned_to changes
-- We'll use a rule that fires on relevant updates

-- ============================================================
-- SLA rules table - per Bureau/category/priority
-- ============================================================
CREATE TABLE sla_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bureau VARCHAR(100),
  category VARCHAR(100),
  priority complaint_priority,
  response_period INTEGER, -- days to respond
  resolution_period INTEGER, -- days to resolve
  warning_threshold INTEGER, -- days before warning
  escalation_threshold INTEGER, -- days before escalation
  stale_days INTEGER, -- days without activity before stale
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bureau, category, priority)
);

-- Enable RLS
ALTER TABLE sla_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SLA rules read all" ON sla_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "SLA rules admin full access" ON sla_rules
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_sla_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sla_rules_updated_at_trigger
  BEFORE UPDATE ON sla_rules
  FOR EACH ROW EXECUTE FUNCTION update_sla_rules_updated_at();

-- ============================================================
-- Import jobs table - CSV/JSON sync tracking
-- ============================================================
CREATE TABLE import_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  status import_job_status NOT NULL DEFAULT 'pending',
  total_rows INTEGER NOT NULL DEFAULT 0,
  created_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  unchanged_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Import jobs read all" ON import_jobs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Import jobs admin full access" ON import_jobs
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

-- Trigger
CREATE OR REPLACE FUNCTION update_import_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_import_jobs_updated_at_trigger
  BEFORE UPDATE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION update_import_jobs_updated_at();

-- ============================================================
-- Import errors table - row-level error tracking
-- ============================================================
CREATE TABLE import_errors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES import_jobs ON DELETE CASCADE,
  row INTEGER NOT NULL,
  field VARCHAR(100),
  reason TEXT NOT NULL,
  value TEXT, -- the raw value that caused the error
  neutralized_value TEXT, -- the formula-neutralized version
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE import_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Import errors read all" ON import_errors
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Import errors admin full access" ON import_errors
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

-- ============================================================
-- Coordination flags table - cross-bureau coordination
-- ============================================================
CREATE TABLE coordination_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  complaint_id UUID REFERENCES complaints ON DELETE CASCADE,
  flag_type coordination_flag_type NOT NULL,
  description TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_by UUID REFERENCES auth.users ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  decision TEXT, -- e.g., 'accepted', 'rejected', 'merged'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE coordination_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordination flags read all" ON coordination_flags
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Coordination flags admin full access" ON coordination_flags
  FOR ALL TO authenticated USING (role = 'admin' WITH CHECK (role = 'admin'));

-- Trigger
CREATE OR REPLACE FUNCTION update_coordination_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_coordination_flags_updated_at_trigger
  BEFORE UPDATE ON coordination_flags
  FOR EACH ROW EXECUTE FUNCTION update_coordination_flags_updated_at();

-- ============================================================
-- Indexes for performance
-- ============================================================

-- Institutions
CREATE INDEX idx_institutions_normalized_name ON institutions(normalized_name);
CREATE INDEX idx_institutions_name ON institutions(name);

-- Institution identifiers
CREATE INDEX idx_institution_identifiers_institution_id ON institution_identifiers(institution_id);
CREATE UNIQUE INDEX idx_institution_identifiers_uk ON institution_identifiers(source_system, source_identifier);

-- Complaints
CREATE INDEX idx_complaints_institution_id ON complaints(institution_id);
CREATE INDEX idx_complaints_bureau ON complaints(bureau);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_priority ON complaints(priority);
CREATE INDEX idx_complaints_due_date ON complaints(due_date);
CREATE INDEX idx_complaints_date_received ON complaints(date_received);
CREATE INDEX idx_complaints_assigned_to ON complaints(assigned_to);
CREATE INDEX idx_complaints_source ON complaints(source_system, source_reference);

-- Complaint audit
CREATE INDEX idx_complaint_audit_complaint_id ON complaint_audit(complaint_id);
CREATE INDEX idx_complaint_audit_changed_at ON complaint_audit(changed_at);

-- SLA rules
CREATE INDEX idx_sla_rules_bundle ON sla_rules(bureau, category, priority);

-- Import jobs
CREATE INDEX idx_import_jobs_status ON import_jobs(status);
CREATE INDEX idx_import_jobs_created_at ON import_jobs(created_at);

-- Import errors
CREATE INDEX idx_import_errors_job_id ON import_errors(job_id);

-- Coordination flags
CREATE INDEX idx_coordination_flags_complaint_id ON coordination_flags(complaint_id);
CREATE INDEX idx_coordination_flags_reviewed ON coordination_flags(reviewed, reviewed_at);

-- Profiles
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_bureau ON profiles(bureau);

-- Grant permissions to anon for public reads where needed
GRANT ALL ON ALL TABLES TO service_role;
GRANT SELECT ON ALL TABLES TO authenticated;