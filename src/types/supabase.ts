export type Role = 'admin' | 'bureau_official' | 'reviewer' | 'read_only';

export type ComplaintStatus = 'Open' | 'In Progress' | 'Awaiting Information' | 'Resolved' | 'Closed';
export type ComplaintPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export interface Institution {
  id: string;
  name: string;
  normalized_name: string;
  country?: string;
  city?: string;
  established_year?: number;
  created_at: string;
  updated_at: string;
}

export interface InstitutionIdentifier {
  id: string;
  institution_id: string;
  source_system: string;
  source_identifier: string;
  verification_status: 'pending' | 'verified' | 'disputed';
  first_seen_at: string;
  last_seen_at: string;
}

export interface Complaint {
  id: string;
  institution_id: string | null;
  bureau: string;
  complaint_reference: string;
  source_system: string;
  source_reference?: string;
  category: string;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  subject: string;
  description?: string;
  date_received: string;
  due_date?: string;
  resolved_at?: string;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

export interface ComplaintAudit {
  id: string;
  complaint_id: string;
  action: string;
  old_value?: string;
  new_value?: string;
  changed_by: string;
  changed_at: string;
  notes?: string;
}

export interface SlaRule {
  id: string;
  bureau?: string;
  category?: string;
  priority?: ComplaintPriority;
  response_period: number;
  resolution_period: number;
  warning_threshold: number;
  escalation_threshold: number;
  stale_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  role: Role;
  bureau?: string;
  created_at: string;
  updated_at: string;
}

export interface ImportJob {
  id: string;
  filename: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_rows: number;
  created_rows: number;
  updated_rows: number;
  unchanged_rows: number;
  rejected_rows: number;
  failed_rows: number;
  started_at?: string;
  completed_at?: string;
  error_summary?: string;
  created_at: string;
  updated_at: string;
}

export interface ImportError {
  id: string;
  job_id: string;
  row: number;
  field: string;
  reason: string;
  value?: string;
  neutralized_value?: string;
  created_at: string;
}

export interface CoordinationFlag {
  id: string;
  complaint_id: string;
  flag_type: 'multiple_bureaus' | 'overlapping_subjects' | 'repeated_reassignment' | 'inconsistent_status' | 'approaching_deadline' | 'stale_case';
  description: string;
  generated_at: string;
  reviewed: boolean;
  reviewed_by?: string;
  reviewed_at?: string;
  decision?: string;
  notes?: string;
}
