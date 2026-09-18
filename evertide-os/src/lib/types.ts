// Hand-maintained row types for the EverTide OS schema (kept in sync with
// supabase/migrations). Only fields the app reads are typed.

export type MembershipRole = "org_admin" | "site_admin" | "member" | "viewer";
export type TaskStatus = "not_started" | "in_progress" | "blocked" | "done";
export type ProjectStatus = "not_started" | "in_progress" | "blocked" | "at_risk" | "done";
export type Priority = "low" | "normal" | "high" | "critical";
export type MilestoneStatus = "pending" | "at_risk" | "met" | "missed";
export type IssueStatus = "open" | "investigating" | "action_planned" | "resolved" | "closed";
export type RiskProbability = "low" | "medium" | "high";
export type RiskImpact = "low" | "medium" | "high" | "severe";
export type RiskStatus = "open" | "monitoring" | "mitigating" | "closed" | "occurred";
export type RiskDisposition = "avoided" | "mitigated" | "accepted" | "transferred" | "occurred";
export type DecisionStatus = "proposed" | "approved" | "implemented" | "superseded";
export type KpiCategory = "Financial" | "Operations" | "Clinical" | "Growth";
export type KpiDirection = "higher_is_better" | "lower_is_better" | "target_range";
export type KpiEntryStatus = "green" | "yellow" | "red" | "missing";
export type HuddleStatus = "draft" | "in_progress" | "completed";
export type CommitmentStatus = "open" | "done" | "carried_over" | "cancelled";
export type DocumentStatus = "draft" | "active" | "under_review" | "superseded" | "archived";
export type GoalStatus = "draft" | "active" | "at_risk" | "complete" | "archived";
export type GoalType = "annual" | "quarterly" | "objective";
export type PersonType = "employee" | "partner" | "physician" | "referral_partner" | "external_contact";
export type ReportType = "weekly" | "monthly";

export interface Profile {
  id: string;
  name: string;
  email: string;
  title: string | null;
  avatar_color: string;
}

export interface Site {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  timezone: string;
  target_opening_date: string | null;
  status: string;
  opening_risk_declared: boolean;
  opening_risk_reason: string | null;
  max_upload_mb: number;
  no_phi_warning: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface Task {
  id: string;
  organization_id: string;
  site_id: string;
  project_id: string | null;
  milestone_id: string | null;
  legacy_id: number | null;
  phase: string | null;
  workstream: string | null;
  title: string;
  description: string | null;
  owner_id: string;
  start_date: string | null;
  due_date: string | null;
  status: TaskStatus;
  percent_done: number;
  priority: Priority;
  critical: boolean;
  blocker_reason: string | null;
  sort_order: number;
  notes: string | null;
  last_meaningful_update_at: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  owner?: Profile;
}

export interface Project {
  id: string;
  name: string;
  phase: string | null;
  workstream: string | null;
  owner_id: string;
  status: ProjectStatus;
  percent_done: number;
  priority: Priority;
  critical_path: boolean;
  start_date: string | null;
  due_date: string | null;
  archived_at: string | null;
  owner?: Profile;
}

export interface Milestone {
  id: string;
  title: string;
  target_date: string;
  gate_criteria: string | null;
  owner_id: string;
  status: MilestoneStatus;
  met_at: string | null;
  notes: string | null;
  archived_at: string | null;
  owner?: Profile;
}

export interface Issue {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: Priority;
  status: IssueStatus;
  owner_id: string;
  reported_by: string | null;
  reported_at: string;
  due_date: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  huddle_required: boolean;
  related_issue_id: string | null;
  archived_at: string | null;
  owner?: Profile;
}

export interface Risk {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  probability: RiskProbability;
  impact: RiskImpact;
  score: number;
  owner_id: string;
  mitigation_plan: string | null;
  trigger_condition: string | null;
  review_date: string | null;
  status: RiskStatus;
  disposition: RiskDisposition | null;
  converted_issue_id: string | null;
  archived_at: string | null;
  owner?: Profile;
}

export interface Decision {
  id: string;
  title: string;
  context: string | null;
  decision_text: string | null;
  rationale: string | null;
  alternatives_considered: string | null;
  decision_date: string;
  owner_id: string;
  approved_by_id: string | null;
  status: DecisionStatus;
  effective_date: string | null;
  review_date: string | null;
  outcome: string | null;
  outcome_recorded_at: string | null;
  supersedes_decision_id: string | null;
  archived_at: string | null;
  owner?: Profile;
}

export interface Kpi {
  id: string;
  category: KpiCategory;
  name: string;
  description: string | null;
  unit: string | null;
  frequency: "weekly" | "monthly";
  owner_id: string;
  direction: KpiDirection;
  target_value: number | null;
  green_min: number | null;
  green_max: number | null;
  yellow_min: number | null;
  yellow_max: number | null;
  active: boolean;
  sort_order: number;
  archived_at: string | null;
  owner?: Profile;
}

export interface KpiEntry {
  id: string;
  kpi_id: string;
  period_start: string;
  period_end: string;
  value: number | null;
  status: KpiEntryStatus;
  narrative: string | null;
  status_override_note: string | null;
  entered_by: string | null;
  entered_at: string | null;
}

export interface Huddle {
  id: string;
  site_id: string;
  huddle_date: string;
  started_at: string | null;
  ended_at: string | null;
  facilitator_id: string | null;
  status: HuddleStatus;
  wins: string | null;
  notes: string | null;
  agenda_snapshot: AgendaItemSnapshot[] | null;
}

export interface AgendaItemSnapshot {
  item_type: string;
  linked_id: string | null;
  title: string;
  sort_order: number;
  disposition: string | null;
}

export interface HuddleAgendaItem {
  id: string;
  huddle_id: string;
  item_type: string;
  linked_id: string | null;
  title: string;
  sort_order: number;
  disposition: string | null;
}

export interface Commitment {
  id: string;
  huddle_id: string;
  source_commitment_id: string | null;
  commitment: string;
  owner_id: string;
  due_date: string;
  status: CommitmentStatus;
  carry_count: number;
  completed_at: string | null;
  completion_note: string | null;
  owner?: Profile;
}

export interface Goal {
  id: string;
  parent_goal_id: string | null;
  title: string;
  description: string | null;
  goal_type: GoalType;
  start_date: string | null;
  due_date: string | null;
  owner_id: string;
  status: GoalStatus;
  progress_percent: number;
  success_criteria: string | null;
  archived_at: string | null;
  owner?: Profile;
}

export interface DocumentRow {
  id: string;
  folder_id: string;
  title: string;
  description: string | null;
  owner_id: string;
  document_type: string | null;
  status: DocumentStatus;
  current_version_id: string | null;
  review_date: string | null;
  confidentiality: "internal" | "restricted";
  source_of_truth: boolean;
  archived_at: string | null;
  owner?: Profile;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  change_summary: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface DocumentFolder {
  id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number;
  archived_at: string | null;
}

export interface Person {
  id: string;
  person_type: PersonType;
  first_name: string;
  last_name: string;
  organization_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string;
  status: "active" | "inactive" | "prospect";
  notes: string | null;
  archived_at: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  category: string | null;
  primary_contact_person_id: string | null;
  owner_id: string;
  status: "evaluating" | "active" | "inactive" | "terminated";
  contract_start: string | null;
  contract_end: string | null;
  renewal_notice_date: string | null;
  notes: string | null;
  archived_at: string | null;
}

export interface Report {
  id: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  generated_at: string;
  snapshot: Record<string, unknown>;
  narrative: string | null;
  status: "generated" | "final";
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linked_type: string | null;
  linked_id: string | null;
  read_at: string | null;
  created_at: string;
}
