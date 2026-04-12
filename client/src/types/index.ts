export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  github_repo: string | null;
  github_repos: string[] | null;
  created_at: string;
  start_date: string | null;
  invite_code: string | null;
  is_private: boolean;
  image_url: string | null;
}

export interface JoinRequest {
  id: string;
  project_id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  updated_at: string;
  profile?: { display_name: string | null; avatar_url: string | null };
}

export interface Goal {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  deadline: string | null;
  status: 'not_started' | 'in_progress' | 'in_review' | 'complete' | 'active' | 'at_risk' | 'missed';
  risk_score: number | null;
  progress: number;
  estimated_hours?: number | null;
  completed_at: string | null;
  assigned_to: string | null;
  assignees: string[];
  category: string | null;
  loe: string | null;
  ai_guidance?: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  created_by?: string | null;
}

export interface OdysseyEvent {
  id: string;
  project_id: string;
  actor_id: string | null;
  source: 'github' | 'teams' | 'onedrive' | 'onenote' | 'local' | 'gitlab' | 'manual' | 'ai';
  event_type: 'commit' | 'message' | 'file_edit' | 'note' | 'meeting' | 'file_upload' | 'goal_progress_updated' | 'goal_risk_assessed' | 'time_logged' | 'comment_added' | string;
  title: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
}

export interface Integration {
  id: string;
  project_id: string;
  type: 'github' | 'teams' | 'onedrive';
  config: Record<string, unknown> | null;
  token_ref: string | null;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface UserConnection {
  id: string;
  user_id: string;
  provider: 'microsoft';
  ms_user_id: string | null;
  ms_email: string | null;
  ms_display_name: string | null;
  created_at: string;
  updated_at: string;
}

// Microsoft Graph API types (returned from backend)
export interface OneNoteNotebook {
  id: string;
  displayName: string;
  lastModifiedDateTime: string;
}

export interface OneNoteSection {
  id: string;
  displayName: string;
  lastModifiedDateTime: string;
}

export interface OneNotePage {
  id: string;
  title: string;
  lastModifiedDateTime: string;
}

export interface OneDriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime: string;
  webUrl?: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
}

export interface ProjectInsight {
  id: string;
  project_id: string;
  status: string;
  next_steps: string[];
  future_features: string[];
  provider: string;
  generated_at: string;
}

export interface GoalDependency {
  id: string;
  goal_id: string;
  depends_on_goal_id: string;
  project_id: string;
  created_at: string;
}

export interface TimeLog {
  id: string;
  goal_id: string;
  project_id: string;
  user_id: string | null;
  logged_hours: number;
  description: string | null;
  logged_at: string;
  created_at: string;
}

export interface GoalComment {
  id: string;
  goal_id: string;
  project_id: string;
  author_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TaskOwnerSuggestion {
  taskId: string;
  taskTitle: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  recommendedOwnerId: string | null;
  recommendedOwnerName: string | null;
  confidence: number;
  evidence: string[];
  suggestedCollaboratorIds: string[];
  suggestedCollaboratorNames: string[];
  workloadState: 'light' | 'balanced' | 'heavy' | 'unknown';
  urgency: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  dueDate: string | null;
}

export interface PersonQueueItem {
  taskId: string;
  taskTitle: string;
  kind: 'assigned' | 'suggested_owner' | 'suggested_collaborator';
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueDate: string | null;
  status: string;
  reason: string;
  confidence: number;
  blockedByTaskId: string | null;
  blockedByTaskTitle: string | null;
  suggestedAction: string;
}

export interface PersonQueue {
  userId: string;
  displayName: string;
  role: string;
  totalOpenTasks: number;
  totalBlockedTasks: number;
  recentHours: number;
  items: PersonQueueItem[];
}

export interface ContributionProfile {
  userId: string;
  displayName: string;
  role: string;
  activeTasks: number;
  completedTasks: number;
  recentHours: number;
  documentsContributed: number;
  commentsContributed: number;
  collaborationCount: number;
  topConcepts: Array<{ label: string; score: number }>;
}

export interface HandoffRisk {
  taskId: string;
  taskTitle: string;
  ownerId: string | null;
  ownerName: string | null;
  blockedByTaskId: string;
  blockedByTaskTitle: string;
  blockerOwnerId: string | null;
  blockerOwnerName: string | null;
  severity: 'high' | 'medium' | 'low';
  reason: string;
  suggestedNextStep: string;
}

export interface CoverageGap {
  id: string;
  gapType: 'concept' | 'deliverable';
  label: string;
  reason: string;
  linkedTaskIds: string[];
  linkedTaskTitles: string[];
  suggestedOwnerIds: string[];
  suggestedOwnerNames: string[];
}

export interface CoordinationMetric {
  label: string;
  value: number;
  tone: 'normal' | 'warning' | 'critical' | 'positive';
}

export interface CoordinationWorkloadPerson {
  userId: string;
  displayName: string;
  role: string;
  activeTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  recentHours: number;
  loadScore: number;
  capacityStatus: 'light' | 'balanced' | 'heavy' | 'unknown';
}

export interface KnowledgeCoverageEntry {
  label: string;
  taskCount: number;
  documentCount: number;
  expertCount: number;
  coverageScore: number;
  ownerNames: string[];
}

export interface CoordinationSnapshot {
  projectId: string;
  generatedAt: string;
  status: 'ready' | 'missing' | 'stale' | 'error';
  viewerRole: 'owner' | 'member';
  stale: boolean;
  myNextActions: PersonQueue | null;
  errorMessage?: string | null;
  teamCoordination: {
    summary: string[];
    metrics: CoordinationMetric[];
    ownerSuggestions: TaskOwnerSuggestion[];
    suggestedResponsibilities: TaskOwnerSuggestion[];
  };
  needsOwner: TaskOwnerSuggestion[];
  blockedHandoffs: HandoffRisk[];
  workloadBalance: {
    averageActiveTasks: number;
    averageRecentHours: number;
    people: CoordinationWorkloadPerson[];
  };
  knowledgeCoverage: {
    coveredConcepts: KnowledgeCoverageEntry[];
    gaps: CoverageGap[];
  };
  contributionProfiles: ContributionProfile[];
  personQueues: PersonQueue[];
  ownerSuggestions: TaskOwnerSuggestion[];
  graphStats: {
    nodeCount: number;
    edgeCount: number;
    nodeTypeCounts: Record<string, number>;
    edgeTypeCounts: Record<string, number>;
  };
  graphInference: {
    status: 'none' | 'available' | 'skipped' | 'error';
    provider: string | null;
    message: string | null;
    generatedAt: string | null;
    inferredNodeCount: number;
    inferredEdgeCount: number;
  };
}

export interface CoordinationGraphNode {
  id: string;
  nodeType: string;
  externalId: string;
  label: string;
  metadata: Record<string, unknown>;
}

export interface CoordinationGraphEdge {
  id: string;
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
  weight: number;
  metadata: Record<string, unknown>;
}

export interface CoordinationGraph {
  generatedAt: string;
  stale: boolean;
  nodes: CoordinationGraphNode[];
  edges: CoordinationGraphEdge[];
  inferredNodeIds: string[];
  inferredEdgeIds: string[];
  inference: {
    status: 'none' | 'available' | 'skipped' | 'error';
    provider: string | null;
    message: string | null;
    generatedAt: string | null;
    inferredNodeCount: number;
    inferredEdgeCount: number;
  };
}

export interface CoordinationBundle {
  snapshot: CoordinationSnapshot;
  graph: CoordinationGraph;
}

export interface RiskAssessment {
  goalId: string;
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
}

export interface NotificationItem {
  id: string;
  user_id: string;
  actor_id: string | null;
  project_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface ChatThread {
  id: string;
  kind: 'project' | 'direct';
  project_id: string | null;
  related_project_id: string | null;
  direct_key: string | null;
  title: string | null;
  ai_mode: boolean;
  ai_mode_by: string | null;
  ai_mode_started_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  thread_id: string;
  sender_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
