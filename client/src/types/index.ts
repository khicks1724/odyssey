export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  github_repo: string | null;
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
  deadline: string | null;
  status: 'not_started' | 'in_progress' | 'in_review' | 'complete';
  risk_score: number | null;
  progress: number;
  completed_at: string | null;
  assigned_to: string | null;
  assignees: string[];
  category: string | null;
  loe: string | null;
  ai_guidance: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
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
