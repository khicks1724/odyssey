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
  status: 'not_started' | 'active' | 'in_progress' | 'at_risk' | 'complete' | 'missed';
  risk_score: number | null;
  progress: number;
}

export interface OdysseyEvent {
  id: string;
  project_id: string;
  actor_id: string | null;
  source: 'github' | 'teams' | 'onedrive' | 'onenote' | 'manual';
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
