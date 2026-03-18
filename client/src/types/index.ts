export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  github_repo: string | null;
  created_at: string;
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
  category: string | null;
  created_at: string;
}

export interface OdysseyEvent {
  id: string;
  project_id: string;
  actor_id: string | null;
  source: 'github' | 'teams' | 'onedrive' | 'onenote' | 'local' | 'gitlab' | 'manual';
  event_type: 'commit' | 'message' | 'file_edit' | 'note' | 'meeting';
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
