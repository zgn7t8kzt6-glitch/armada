// Zod schemas validating every server-action / route-handler payload (§11.3).
import { z } from "zod";

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const trimmed = (max = 2000) => z.string().trim().min(1).max(max);
const optionalText = (max = 10000) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const taskStatusSchema = z.enum(["not_started", "in_progress", "blocked", "done"]);
export const prioritySchema = z.enum(["low", "normal", "high", "critical"]);

export const taskCreateSchema = z.object({
  siteId: uuid,
  projectId: uuid.optional(),
  milestoneId: uuid.optional(),
  title: trimmed(500),
  description: optionalText(),
  ownerId: uuid,
  startDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  priority: prioritySchema.default("normal"),
  critical: z.coerce.boolean().default(false),
  phase: optionalText(200),
  workstream: optionalText(200),
});

export const taskStatusChangeSchema = z.object({
  taskId: uuid,
  status: taskStatusSchema,
  blockerReason: optionalText(1000),
  percentDone: z.coerce.number().int().min(0).max(100).optional(),
});

export const taskUpdateFieldsSchema = z.object({
  taskId: uuid,
  title: trimmed(500).optional(),
  description: optionalText(),
  notes: optionalText(),
  percentDone: z.coerce.number().int().min(0).max(100).optional(),
  priority: prioritySchema.optional(),
  critical: z.coerce.boolean().optional(),
  projectId: uuid.nullable().optional(),
  milestoneId: uuid.nullable().optional(),
});

// Admin-only (enforced again in DB triggers).
export const taskReassignSchema = z.object({
  taskId: uuid,
  ownerId: uuid.optional(),
  dueDate: isoDate.nullable().optional(),
  startDate: isoDate.nullable().optional(),
});

export const commentSchema = z.object({
  taskId: uuid,
  body: trimmed(4000),
});

export const helperSchema = z.object({
  taskId: uuid,
  userId: uuid,
});

export const dependencySchema = z.object({
  predecessorId: uuid,
  successorId: uuid,
  dependencyType: z.enum(["finish_to_start", "start_to_start", "finish_to_finish"]).default("finish_to_start"),
  lagDays: z.coerce.number().int().min(-365).max(365).default(0),
});

export const issueCreateSchema = z.object({
  siteId: uuid,
  title: trimmed(500),
  description: optionalText(),
  category: optionalText(100),
  priority: prioritySchema.default("normal"),
  ownerId: uuid,
  dueDate: isoDate.optional(),
  projectId: uuid.optional(),
  taskId: uuid.optional(),
});

export const issueUpdateSchema = z.object({
  issueId: uuid,
  status: z.enum(["open", "investigating", "action_planned", "resolved", "closed"]).optional(),
  priority: prioritySchema.optional(),
  ownerId: uuid.optional(),
  dueDate: isoDate.nullable().optional(),
  rootCause: optionalText(),
  correctiveAction: optionalText(),
  resolutionSummary: optionalText(),
  huddleRequired: z.coerce.boolean().optional(),
  relatedIssueId: uuid.nullable().optional(),
});

export const issueCommentSchema = z.object({
  issueId: uuid,
  body: trimmed(4000),
});

export const riskCreateSchema = z.object({
  siteId: uuid,
  title: trimmed(500),
  description: optionalText(),
  category: optionalText(100),
  probability: z.enum(["low", "medium", "high"]).default("medium"),
  impact: z.enum(["low", "medium", "high", "severe"]).default("medium"),
  ownerId: uuid,
  mitigationPlan: optionalText(),
  triggerCondition: optionalText(),
  reviewDate: isoDate.optional(),
});

export const riskUpdateSchema = z.object({
  riskId: uuid,
  title: trimmed(500).optional(),
  description: optionalText(),
  probability: z.enum(["low", "medium", "high"]).optional(),
  impact: z.enum(["low", "medium", "high", "severe"]).optional(),
  ownerId: uuid.optional(),
  mitigationPlan: optionalText(),
  triggerCondition: optionalText(),
  reviewDate: isoDate.nullable().optional(),
  status: z.enum(["open", "monitoring", "mitigating", "closed", "occurred"]).optional(),
  disposition: z.enum(["avoided", "mitigated", "accepted", "transferred", "occurred"]).optional(),
});

export const decisionCreateSchema = z.object({
  siteId: uuid.optional(),
  title: trimmed(500),
  context: optionalText(),
  decisionText: optionalText(),
  rationale: optionalText(),
  alternativesConsidered: optionalText(),
  decisionDate: isoDate,
  ownerId: uuid,
  reviewDate: isoDate.optional(),
  projectId: uuid.optional(),
});

export const decisionEditSchema = z.object({
  decisionId: uuid,
  title: trimmed(500).optional(),
  context: optionalText(),
  decisionText: optionalText(),
  rationale: optionalText(),
  alternativesConsidered: optionalText(),
  reviewDate: isoDate.nullable().optional(),
  status: z.enum(["proposed", "approved", "implemented", "superseded"]).optional(),
  outcome: optionalText(),
});

export const kpiEntrySchema = z.object({
  kpiId: uuid,
  periodStart: isoDate,
  value: z.coerce.number().finite().nullable(),
  narrative: optionalText(2000),
});

export const kpiOverrideSchema = z.object({
  entryId: uuid,
  status: z.enum(["green", "yellow", "red"]),
  note: trimmed(1000),
});

export const kpiDefinitionSchema = z.object({
  kpiId: uuid.optional(),
  siteId: uuid,
  category: z.enum(["Financial", "Operations", "Clinical", "Growth"]),
  name: trimmed(200),
  description: optionalText(),
  unit: optionalText(50),
  frequency: z.enum(["weekly", "monthly"]),
  ownerId: uuid,
  direction: z.enum(["higher_is_better", "lower_is_better", "target_range"]),
  targetValue: z.coerce.number().finite().nullable().optional(),
  greenMin: z.coerce.number().finite().nullable().optional(),
  greenMax: z.coerce.number().finite().nullable().optional(),
  yellowMin: z.coerce.number().finite().nullable().optional(),
  yellowMax: z.coerce.number().finite().nullable().optional(),
  active: z.coerce.boolean().default(true),
});

export const huddleCreateSchema = z.object({
  siteId: uuid,
  huddleDate: isoDate,
  facilitatorId: uuid.optional(),
});

export const commitmentCreateSchema = z.object({
  huddleId: uuid,
  commitment: trimmed(1000),
  ownerId: uuid,
  dueDate: isoDate,
});

export const commitmentResolveSchema = z.object({
  commitmentId: uuid,
  action: z.enum(["done", "cancelled", "carry"]),
  note: optionalText(1000),
  newHuddleId: uuid.optional(),
  newDueDate: isoDate.optional(),
});

export const goalCreateSchema = z.object({
  siteId: uuid.optional(),
  parentGoalId: uuid.optional(),
  title: trimmed(500),
  description: optionalText(),
  goalType: z.enum(["annual", "quarterly", "objective"]),
  startDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  ownerId: uuid,
  successCriteria: optionalText(),
});

export const goalUpdateSchema = z.object({
  goalId: uuid,
  title: trimmed(500).optional(),
  description: optionalText(),
  status: z.enum(["draft", "active", "at_risk", "complete", "archived"]).optional(),
  progressPercent: z.coerce.number().int().min(0).max(100).optional(),
  successCriteria: optionalText(),
});

export const documentCreateSchema = z.object({
  folderId: uuid,
  siteId: uuid.optional(),
  title: trimmed(300),
  description: optionalText(),
  ownerId: uuid,
  documentType: optionalText(100),
  confidentiality: z.enum(["internal", "restricted"]).default("internal"),
  reviewDate: isoDate.optional(),
});

export const personSchema = z.object({
  personId: uuid.optional(),
  siteId: uuid.optional(),
  personType: z.enum(["employee", "partner", "physician", "referral_partner", "external_contact"]),
  firstName: trimmed(100),
  lastName: z.string().trim().max(100).default(""),
  organizationName: optionalText(200),
  title: optionalText(150),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: optionalText(50),
  ownerId: uuid,
  status: z.enum(["active", "inactive", "prospect"]).default("active"),
  notes: optionalText(),
});

export const vendorSchema = z.object({
  vendorId: uuid.optional(),
  siteId: uuid.optional(),
  name: trimmed(200),
  category: optionalText(100),
  primaryContactPersonId: uuid.optional(),
  ownerId: uuid,
  status: z.enum(["evaluating", "active", "inactive", "terminated"]).default("evaluating"),
  contractStart: isoDate.optional(),
  contractEnd: isoDate.optional(),
  renewalNoticeDate: isoDate.optional(),
  notes: optionalText(),
});

export const membershipSchema = z.object({
  userId: uuid,
  role: z.enum(["org_admin", "site_admin", "member", "viewer"]),
  active: z.coerce.boolean().default(true),
});

export const inviteUserSchema = z.object({
  email: z.string().trim().email(),
  name: trimmed(150),
  title: optionalText(150),
  role: z.enum(["org_admin", "site_admin", "member", "viewer"]),
});

export const archiveSchema = z.object({
  entity: z.enum([
    "tasks", "projects", "goals", "milestones", "issues", "risks", "decisions",
    "documents", "people", "vendors", "huddles", "huddle_commitments", "kpis", "document_folders",
  ]),
  id: uuid,
  restore: z.coerce.boolean().default(false),
});
