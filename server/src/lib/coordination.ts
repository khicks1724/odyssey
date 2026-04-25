import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { chat, getServerOpenAiCredential, getServerOpenAiPrimaryModel, isGenAiMilKey, type AIProviderSelection, type OpenAiProviderSelection, type ProviderCredentialOverride } from '../ai-providers.js';
import { decryptUserKey } from '../routes/user-ai-keys.js';
import { logAiTokenUsage } from '../routes/token-usage.js';
import { isServerFallbackPausedForUser } from './server-fallback-controls.js';
import { supabase } from './supabase.js';

const NODE_TYPES = ['person', 'task', 'document', 'repo', 'file', 'concept', 'deliverable'] as const;
const EDGE_TYPES = [
  'owns',
  'assigned_to',
  'depends_on',
  'mentions',
  'derived_from',
  'contributes_to',
  'expert_in',
  'blocked_by',
  'collaborates_with',
  'covers',
] as const;

const RECENT_HOURS_WINDOW_DAYS = 21;
const WORKLOAD_ACTIVITY_WINDOW_DAYS = 10;
const WORKLOAD_STALE_WINDOW_DAYS = 14;
const WORKLOAD_DEEP_STALE_WINDOW_DAYS = 30;
const MAX_EVENTS = 400;
const MAX_DOCUMENTS = 200;
const MAX_CONCEPTS = 36;

type CoordinationNodeType = (typeof NODE_TYPES)[number];
type CoordinationEdgeType = (typeof EDGE_TYPES)[number];
type ViewerRole = 'owner' | 'member';
type QueuePriority = 'critical' | 'high' | 'medium' | 'low';
type WorkloadState = 'light' | 'balanced' | 'heavy' | 'unknown';
type CoverageGapType = 'concept' | 'deliverable';
type Severity = 'high' | 'medium' | 'low';
type CoordinationTone = 'normal' | 'warning' | 'critical' | 'positive';
type GraphInferenceStatus = 'none' | 'available' | 'skipped' | 'error';

type JsonMap = Record<string, unknown>;

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  github_repo: string | null;
  github_repos: string[] | null;
}

interface ProjectMemberRow {
  user_id: string;
  role: string;
  joined_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

interface GoalRow {
  id: string;
  title: string;
  deadline: string | null;
  status: string;
  progress: number | null;
  assigned_to: string | null;
  assignees: string[] | null;
  category: string | null;
  loe: string | null;
  ai_guidance: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  completed_at: string | null;
}

interface GoalDependencyRow {
  goal_id: string;
  depends_on_goal_id: string;
}

interface GoalCommentRow {
  goal_id: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

interface TimeLogRow {
  goal_id: string;
  user_id: string | null;
  logged_hours: number;
  description: string | null;
  logged_at: string;
}

interface EventRow {
  id: string;
  actor_id: string | null;
  source: string;
  event_type: string;
  title: string | null;
  summary: string | null;
  metadata: JsonMap | null;
  occurred_at: string;
  created_at: string;
}

interface DocumentRow {
  id: string;
  actor_id: string | null;
  filename: string;
  content_preview: string | null;
  summary: string | null;
  keywords: string[] | null;
  readable: boolean;
  storage_path: string | null;
  created_at: string;
}

interface IntegrationRow {
  type: string;
  config: JsonMap | null;
}

interface ProjectAccess {
  allowed: boolean;
  isOwner: boolean;
  memberRole: string | null;
  projectOwnerId: string | null;
}

interface TeamMember {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string | null;
  avatarUrl: string | null;
  email: string | null;
}

interface CoordinationMetric {
  label: string;
  value: number;
  tone: CoordinationTone;
}

interface QueueItem {
  taskId: string;
  taskTitle: string;
  kind: 'assigned' | 'suggested_owner' | 'suggested_collaborator';
  priority: QueuePriority;
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
  items: QueueItem[];
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
  workloadState: WorkloadState;
  urgency: QueuePriority;
  status: string;
  dueDate: string | null;
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
  severity: Severity;
  reason: string;
  suggestedNextStep: string;
}

export interface CoverageGap {
  id: string;
  gapType: CoverageGapType;
  label: string;
  reason: string;
  linkedTaskIds: string[];
  linkedTaskTitles: string[];
  suggestedOwnerIds: string[];
  suggestedOwnerNames: string[];
}

interface WorkloadPerson {
  userId: string;
  displayName: string;
  role: string;
  activeTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  recentHours: number;
  loadScore: number;
  capacityStatus: WorkloadState;
}

interface KnowledgeCoverageEntry {
  label: string;
  taskCount: number;
  documentCount: number;
  expertCount: number;
  coverageScore: number;
  ownerNames: string[];
}

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodeTypeCounts: Record<CoordinationNodeType, number>;
  edgeTypeCounts: Record<CoordinationEdgeType, number>;
}

interface TeamCoordinationSection {
  summary: string[];
  metrics: CoordinationMetric[];
  ownerSuggestions: TaskOwnerSuggestion[];
  suggestedResponsibilities: TaskOwnerSuggestion[];
}

interface WorkloadBalanceSection {
  averageActiveTasks: number;
  averageRecentHours: number;
  people: WorkloadPerson[];
}

interface KnowledgeCoverageSection {
  coveredConcepts: KnowledgeCoverageEntry[];
  gaps: CoverageGap[];
}

interface CoordinationSnapshotData {
  projectId: string;
  generatedAt: string;
  teamCoordination: TeamCoordinationSection;
  needsOwner: TaskOwnerSuggestion[];
  blockedHandoffs: HandoffRisk[];
  workloadBalance: WorkloadBalanceSection;
  knowledgeCoverage: KnowledgeCoverageSection;
  contributionProfiles: ContributionProfile[];
  personQueues: PersonQueue[];
  ownerSuggestions: TaskOwnerSuggestion[];
  graphStats: GraphStats;
  graphInference: GraphInferenceSummary;
}

export interface CoordinationSnapshot extends CoordinationSnapshotData {
  status: 'ready' | 'missing' | 'stale' | 'error';
  viewerRole: ViewerRole;
  stale: boolean;
  myNextActions: PersonQueue | null;
  errorMessage?: string | null;
}

export interface CoordinationGraphNode {
  id: string;
  nodeType: CoordinationNodeType;
  externalId: string;
  label: string;
  metadata: JsonMap;
}

export interface CoordinationGraphEdge {
  id: string;
  edgeType: CoordinationEdgeType;
  fromNodeId: string;
  toNodeId: string;
  weight: number;
  metadata: JsonMap;
}

export interface CoordinationGraph {
  generatedAt: string;
  stale: boolean;
  nodes: CoordinationGraphNode[];
  edges: CoordinationGraphEdge[];
  inferredNodeIds: string[];
  inferredEdgeIds: string[];
  inference: GraphInferenceSummary;
}

export interface CoordinationBundle {
  snapshot: CoordinationSnapshot;
  graph: CoordinationGraph;
}

interface StoredSnapshotRow {
  project_id: string;
  snapshot: CoordinationSnapshotData | null;
  graph_stats: Partial<GraphStats> | null;
  generated_at: string;
  is_stale: boolean;
}

interface StoredGraphRow {
  generatedAt: string;
  stale: boolean;
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}

interface GraphNodeRecord {
  id: string;
  project_id: string;
  node_type: CoordinationNodeType;
  external_id: string;
  label: string;
  metadata: JsonMap;
}

interface GraphEdgeRecord {
  id: string;
  project_id: string;
  edge_type: CoordinationEdgeType;
  from_node_id: string;
  to_node_id: string;
  weight: number;
  metadata: JsonMap;
}

interface ConceptCandidate {
  label: string;
  weight: number;
  explicit: boolean;
}

interface GraphInferenceSummary {
  status: GraphInferenceStatus;
  provider: string | null;
  message: string | null;
  generatedAt: string | null;
  inferredNodeCount: number;
  inferredEdgeCount: number;
}

interface StoredAiKeyRow {
  provider: 'anthropic' | 'openai' | 'google' | 'google_ai' | 'nvidia' | 'gemma4';
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  config?: unknown;
}

interface InferredConceptDraft {
  label: string;
  connections: Array<{
    fromRef: string;
    edgeType: 'covers' | 'mentions' | 'expert_in';
    weight?: number;
    confidence?: number;
    reason?: string;
  }>;
}

interface InferredRelationDraft {
  fromRef: string;
  toRef: string;
  edgeType: 'covers' | 'mentions' | 'expert_in' | 'contributes_to' | 'collaborates_with';
  weight?: number;
  confidence?: number;
  reason?: string;
}

interface GraphInferenceDraft {
  concepts?: InferredConceptDraft[];
  relations?: InferredRelationDraft[];
}

interface WorkloadSummary {
  byUser: Map<string, WorkloadPerson>;
  averageActiveTasks: number;
  averageRecentHours: number;
}

interface UrgencyInfo {
  score: number;
  label: QueuePriority;
}

interface CandidateScore {
  userId: string;
  continuity: number;
  expertise: number;
  capacity: number;
  adjacency: number;
  urgencyFit: number;
  raw: number;
  confidence: number;
  workloadState: WorkloadState;
  evidence: string[];
}

interface SupabaseErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'about', 'after', 'before', 'during',
  'your', 'have', 'will', 'would', 'could', 'should', 'been', 'were', 'their', 'there', 'which',
  'what', 'when', 'where', 'while', 'team', 'project', 'projects', 'task', 'tasks', 'goal', 'goals',
  'owner', 'owners', 'member', 'members', 'work', 'working', 'notes', 'note', 'document', 'documents',
  'file', 'files', 'repo', 'repos', 'update', 'updates', 'status', 'progress', 'meeting', 'meetings',
  'comment', 'comments', 'summary', 'analysis', 'report', 'reports', 'data', 'code', 'odyssey',
]);

function createCountRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqStrings(value.filter((entry): entry is string => typeof entry === 'string'));
}

function asRecord(value: unknown): JsonMap | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonMap : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeConcept(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[_/]+/g, ' ')
      .replace(/[^a-z0-9.\- ]+/g, ' '),
  );
}

function isMeaningfulConcept(key: string): boolean {
  if (!key || key.length < 3 || key.length > 64) return false;
  if (STOP_WORDS.has(key)) return false;
  if (/^\d+$/.test(key)) return false;
  return true;
}

function extractTerms(text: string, limit = 20): string[] {
  const matches = text
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .match(/[a-z0-9][a-z0-9.-]{2,}/g) ?? [];

  const unique = new Set<string>();
  for (const token of matches) {
    const normalized = token.replace(/^[.\-]+|[.\-]+$/g, '');
    if (!isMeaningfulConcept(normalized)) continue;
    unique.add(normalized);
    if (unique.size >= limit) break;
  }
  return [...unique];
}

function extractFileReferences(text: string, limit = 8): string[] {
  const matches = text.match(/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}/g) ?? [];
  const unique = new Set<string>();
  for (const candidate of matches) {
    if (candidate.startsWith('http')) continue;
    if (candidate.length > 160) continue;
    unique.add(candidate.replace(/^\.?\//, ''));
    if (unique.size >= limit) break;
  }
  return [...unique];
}

function getGoalAssigneeIds(goal: GoalRow): string[] {
  return uniqStrings([goal.assigned_to, ...safeStringArray(goal.assignees)]);
}

function getGoalPrimaryOwnerId(goal: GoalRow): string | null {
  return getGoalAssigneeIds(goal)[0] ?? null;
}

function isGoalOpen(goal: GoalRow): boolean {
  return goal.status !== 'complete';
}

function goalDeadlineToDate(goal: GoalRow): Date | null {
  if (!goal.deadline) return null;
  const value = new Date(`${goal.deadline}T23:59:59Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.floor((date.getTime() - now.getTime()) / 86_400_000);
}

function daysSince(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

function getUrgency(goal: GoalRow, now: Date, dependentCount: number): UrgencyInfo {
  const deadline = goalDeadlineToDate(goal);
  const remaining = daysUntil(deadline, now);

  let score = 1;
  if (remaining !== null) {
    if (remaining < 0) score = 4;
    else if (remaining <= 3) score = 3;
    else if (remaining <= 7) score = 2;
  }
  if (dependentCount > 0) score = Math.min(4, score + 1);

  if (score >= 4) return { score, label: 'critical' };
  if (score === 3) return { score, label: 'high' };
  if (score === 2) return { score, label: 'medium' };
  return { score, label: 'low' };
}

function getWorkloadCapacity(
  loadScore: number,
  avgLoadScore: number,
  activeTasks: number,
  avgActiveTasks: number,
  overdueTasks: number,
  blockedTasks: number,
  staleTasks: number,
  recentActivityTasks: number,
): WorkloadState {
  if (!Number.isFinite(loadScore) || !Number.isFinite(avgLoadScore)) return 'unknown';
  if (avgLoadScore <= 0) return 'balanced';

  const relativeHeavyThreshold = Math.max(7.25, avgLoadScore * 1.35);
  const relativeLightThreshold = Math.min(1.75, avgLoadScore * 0.7);
  const hasClearPressure = overdueTasks > 0 || blockedTasks >= 2 || staleTasks >= 2;
  const sustainedMomentum = recentActivityTasks >= Math.min(activeTasks, 3);

  if (activeTasks <= 2 && overdueTasks === 0 && blockedTasks === 0 && staleTasks === 0) return 'balanced';
  if (loadScore >= 9.5) return 'heavy';
  if (activeTasks >= 12 && (hasClearPressure || !sustainedMomentum)) return 'heavy';
  if (loadScore >= relativeHeavyThreshold && activeTasks >= Math.max(6, Math.ceil(avgActiveTasks + 2))) return 'heavy';
  if (activeTasks <= 1 && loadScore <= relativeLightThreshold) return 'light';
  if (activeTasks === 0 && overdueTasks === 0 && blockedTasks === 0) return 'light';

  return 'balanced';
}

function bumpCounter(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function bumpNestedCounter(map: Map<string, Map<string, number>>, outerKey: string, innerKey: string, amount = 1): void {
  const inner = map.get(outerKey) ?? new Map<string, number>();
  inner.set(innerKey, (inner.get(innerKey) ?? 0) + amount);
  map.set(outerKey, inner);
}

function getGoalWorkloadWeight(goal: GoalRow, now: Date, isBlocked: boolean): number {
  const progress = clamp((goal.progress ?? 0) / 100, 0, 1);
  const remainingDays = daysUntil(goalDeadlineToDate(goal), now);
  const updatedDaysAgo = daysSince(goal.updated_at, now);

  const statusWeight = goal.status === 'in_progress'
    ? 1.2
    : goal.status === 'in_review'
      ? 0.95
      : 0.8;
  const progressWeight = 1.1 - progress * 0.45;
  const deadlinePressure = remainingDays === null
    ? 0
    : remainingDays < 0
      ? 0.95
      : remainingDays <= 3
        ? 0.6
        : remainingDays <= 7
          ? 0.35
          : 0;
  const stalePressure = updatedDaysAgo === null
    ? 0
    : updatedDaysAgo > WORKLOAD_DEEP_STALE_WINDOW_DAYS
      ? 0.75
      : updatedDaysAgo > WORKLOAD_STALE_WINDOW_DAYS
        ? 0.45
        : 0;
  const blockedPressure = isBlocked ? 0.35 : 0;

  return clamp(statusWeight * progressWeight + deadlinePressure + stalePressure + blockedPressure, 0.35, 3.2);
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function getNestedValue(map: Map<string, Map<string, number>>, outerKey: string, innerKey: string): number {
  return map.get(outerKey)?.get(innerKey) ?? 0;
}

function getGitHubRepos(project: ProjectRow): string[] {
  return uniqStrings([project.github_repo, ...(project.github_repos ?? [])]);
}

function getGitLabRepos(integrations: IntegrationRow[]): string[] {
  const urls: string[] = [];
  for (const integration of integrations) {
    if (integration.type !== 'gitlab') continue;
    const config = integration.config ?? {};
    urls.push(
      ...uniqStrings([
        readString(config.repoPath),
        readString(config.repo),
        ...safeStringArray(config.repos),
      ]),
    );
  }
  return [...new Set(urls)];
}

function buildDisplayName(profile: ProfileRow | undefined, fallbackId: string): string {
  return profile?.display_name?.trim() || profile?.email?.trim() || fallbackId;
}

function pickTopEntries(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function createEmptyGraphStats(): GraphStats {
  return {
    nodeCount: 0,
    edgeCount: 0,
    nodeTypeCounts: createCountRecord(NODE_TYPES),
    edgeTypeCounts: createCountRecord(EDGE_TYPES),
  };
}

function createGraphInferenceSummary(overrides: Partial<GraphInferenceSummary> = {}): GraphInferenceSummary {
  return {
    status: 'none',
    provider: null,
    message: null,
    generatedAt: null,
    inferredNodeCount: 0,
    inferredEdgeCount: 0,
    ...overrides,
  };
}

function computeGraphStats(nodes: GraphNodeRecord[], edges: GraphEdgeRecord[]): GraphStats {
  const graphStats: GraphStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypeCounts: createCountRecord(NODE_TYPES),
    edgeTypeCounts: createCountRecord(EDGE_TYPES),
  };
  for (const node of nodes) graphStats.nodeTypeCounts[node.node_type] += 1;
  for (const edge of edges) graphStats.edgeTypeCounts[edge.edge_type] += 1;
  return graphStats;
}

function isOpenAiProviderSelection(provider: string): provider is OpenAiProviderSelection {
  return provider.startsWith('openai:');
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function extractJsonPayload(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  let raw = fenced ? fenced[1].trim() : text.trim();

  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  const start = firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);
  if (start > 0) raw = raw.slice(start);

  const lastBrace = raw.lastIndexOf('}');
  const lastBracket = raw.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end >= 0 && end < raw.length - 1) raw = raw.slice(0, end + 1);

  return raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .trim();
}

function trimForPrompt(value: string | null | undefined, limit: number): string {
  if (!value) return '';
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

async function resolveGraphInferenceProvider(userId: string | null): Promise<{ provider: AIProviderSelection; credential: ProviderCredentialOverride } | null> {
  if (!userId) {
    const serverOpenAiCredential = getServerOpenAiCredential();
    return serverOpenAiCredential
      ? { provider: `openai:${getServerOpenAiPrimaryModel('gpt-4o')}`, credential: serverOpenAiCredential }
      : null;
  }

  const { data, error } = await supabase
    .from('user_ai_keys')
    .select('provider, encrypted_key, iv, auth_tag, config')
    .eq('user_id', userId)
    .in('provider', ['openai', 'anthropic', 'google_ai', 'google']);

  if (error || !data) return null;

  const rows = (data ?? []) as StoredAiKeyRow[];
  const rowMap = new Map(rows.map((row) => [row.provider, row]));

  const openAiRow = rowMap.get('openai');
  if (openAiRow) {
    try {
      const apiKey = decryptUserKey(openAiRow.encrypted_key, openAiRow.iv, openAiRow.auth_tag);
      const config = asRecord(openAiRow.config) ?? {};
      const preferredModel = readString(config.preferredModel) ?? safeStringArray(config.enabledModels)[0] ?? 'gpt-4o';
      if (readString(config.mode) === 'azure_openai') {
        const endpoint = readString(config.endpoint);
        if (endpoint && preferredModel) {
          return {
            provider: `openai:${preferredModel}`,
            credential: {
              apiKey,
              baseURL: normalizeEndpoint(endpoint),
              authMode: 'api-key',
            },
          };
        }
      }
      return {
        provider: preferredModel === 'gpt-4o' ? 'gpt-4o' : `openai:${preferredModel}`,
        credential: apiKey,
      };
    } catch {
      // Fall through to the next configured provider.
    }
  }

  const anthropicRow = rowMap.get('anthropic');
  if (anthropicRow) {
    try {
      return {
        provider: 'claude-sonnet',
        credential: decryptUserKey(anthropicRow.encrypted_key, anthropicRow.iv, anthropicRow.auth_tag),
      };
    } catch {
      // Fall through.
    }
  }

  const googleAiRow = rowMap.get('google_ai');
  if (googleAiRow) {
    try {
      return {
        provider: 'gemini-pro',
        credential: decryptUserKey(googleAiRow.encrypted_key, googleAiRow.iv, googleAiRow.auth_tag),
      };
    } catch {
      // Fall through.
    }
  }

  const googleRow = rowMap.get('google');
  if (googleRow) {
    try {
      const credential = decryptUserKey(googleRow.encrypted_key, googleRow.iv, googleRow.auth_tag);
      if (isGenAiMilKey(credential)) {
        return {
          provider: 'genai-mil',
          credential,
        };
      }
    } catch {
      // No usable fallback provider.
    }
  }

  const serverOpenAiCredential = getServerOpenAiCredential();
  if (serverOpenAiCredential && !(await isServerFallbackPausedForUser(userId))) {
    return {
      provider: `openai:${getServerOpenAiPrimaryModel('gpt-4o')}`,
      credential: serverOpenAiCredential,
    };
  }

  return null;
}

function isMissingCoordinationStorageError(error: SupabaseErrorLike | null | undefined): boolean {
  const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || (
      (details.includes('schema cache') || details.includes('does not exist') || details.includes('relation'))
      && (
        details.includes('project_coordination_snapshots')
        || details.includes('project_graph_nodes')
        || details.includes('project_graph_edges')
      )
    )
  );
}

function createEmptySnapshot(projectId: string, viewerRole: ViewerRole, status: CoordinationSnapshot['status'], generatedAt: string | null, stale: boolean, errorMessage?: string | null): CoordinationSnapshot {
  const summaryMessage = status === 'error'
    ? 'Coordination data could not be loaded.'
    : status === 'missing'
      ? 'No coordination snapshot has been generated for this project yet.'
      : stale
        ? 'Coordination data is stale. Recompute to refresh ownership and handoff guidance.'
        : 'Coordination data is ready.';

  const emptyData: CoordinationSnapshotData = {
    projectId,
    generatedAt: generatedAt ?? new Date(0).toISOString(),
    teamCoordination: {
      summary: [summaryMessage],
      metrics: [],
      ownerSuggestions: [],
      suggestedResponsibilities: [],
    },
    needsOwner: [],
    blockedHandoffs: [],
    workloadBalance: {
      averageActiveTasks: 0,
      averageRecentHours: 0,
      people: [],
    },
    knowledgeCoverage: {
      coveredConcepts: [],
      gaps: [],
    },
    contributionProfiles: [],
    personQueues: [],
    ownerSuggestions: [],
    graphStats: createEmptyGraphStats(),
    graphInference: createGraphInferenceSummary({
      status: status === 'error' ? 'error' : 'none',
      message: errorMessage ?? null,
    }),
  };

  return {
    ...emptyData,
    generatedAt: generatedAt ?? '',
    status,
    viewerRole,
    stale,
    myNextActions: null,
    errorMessage: errorMessage ?? null,
  };
}

function toCoordinationGraphNode(node: GraphNodeRecord): CoordinationGraphNode {
  return {
    id: node.id,
    nodeType: node.node_type,
    externalId: node.external_id,
    label: node.label,
    metadata: node.metadata,
  };
}

function toCoordinationGraphEdge(edge: GraphEdgeRecord): CoordinationGraphEdge {
  return {
    id: edge.id,
    edgeType: edge.edge_type,
    fromNodeId: edge.from_node_id,
    toNodeId: edge.to_node_id,
    weight: edge.weight,
    metadata: edge.metadata,
  };
}

function createCoordinationGraph(
  generatedAt: string | null,
  stale: boolean,
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  inference?: Partial<GraphInferenceSummary> | null,
): CoordinationGraph {
  const inferredNodeIds = nodes
    .filter((node) => readString(asRecord(node.metadata)?.layer) === 'ai_inferred')
    .map((node) => node.id);
  const inferredEdgeIds = edges
    .filter((edge) => readString(asRecord(edge.metadata)?.layer) === 'ai_inferred')
    .map((edge) => edge.id);

  return {
    generatedAt: generatedAt ?? '',
    stale,
    nodes: nodes.map(toCoordinationGraphNode),
    edges: edges.map(toCoordinationGraphEdge),
    inferredNodeIds,
    inferredEdgeIds,
    inference: createGraphInferenceSummary({
      ...(inference ?? {}),
      inferredNodeCount: inferredNodeIds.length,
      inferredEdgeCount: inferredEdgeIds.length,
    }),
  };
}

function isStoredSnapshotData(value: unknown): value is CoordinationSnapshotData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CoordinationSnapshotData>;
  return Array.isArray(candidate.needsOwner)
    && Array.isArray(candidate.blockedHandoffs)
    && Array.isArray(candidate.contributionProfiles)
    && Array.isArray(candidate.personQueues)
    && Array.isArray(candidate.ownerSuggestions)
    && !!candidate.teamCoordination
    && !!candidate.workloadBalance
    && !!candidate.knowledgeCoverage
    && !!candidate.graphStats;
}

function getRelevantSuggestionsForViewer(snapshot: CoordinationSnapshotData, viewerUserId: string): TaskOwnerSuggestion[] {
  return snapshot.ownerSuggestions.filter((suggestion) =>
    suggestion.recommendedOwnerId === viewerUserId
    || suggestion.currentOwnerId === viewerUserId
    || suggestion.suggestedCollaboratorIds.includes(viewerUserId),
  );
}

async function loadCurrentProjectUserIds(projectId: string): Promise<Set<string>> {
  const [projectRes, membersRes] = await Promise.all([
    supabase.from('projects').select('owner_id').eq('id', projectId).maybeSingle(),
    supabase.from('project_members').select('user_id').eq('project_id', projectId),
  ]);

  if (projectRes.error) throw projectRes.error;
  if (membersRes.error) throw membersRes.error;

  const memberUserIds = uniqStrings((membersRes.data ?? []).map((row) => readString(row.user_id)));
  if (memberUserIds.length > 0) return new Set(memberUserIds);

  return new Set(uniqStrings([
    readString(projectRes.data?.owner_id),
  ]));
}

function sanitizeTaskOwnerSuggestion(suggestion: TaskOwnerSuggestion, activeUserIds: Set<string>): TaskOwnerSuggestion {
  const suggestedCollaborators = suggestion.suggestedCollaboratorIds.reduce<Array<{ id: string; name: string }>>((acc, userId, index) => {
    if (!activeUserIds.has(userId)) return acc;
    acc.push({ id: userId, name: suggestion.suggestedCollaboratorNames[index] ?? userId });
    return acc;
  }, []);

  const currentOwnerId = suggestion.currentOwnerId && activeUserIds.has(suggestion.currentOwnerId)
    ? suggestion.currentOwnerId
    : null;
  const recommendedOwnerId = suggestion.recommendedOwnerId && activeUserIds.has(suggestion.recommendedOwnerId)
    ? suggestion.recommendedOwnerId
    : null;

  return {
    ...suggestion,
    currentOwnerId,
    currentOwnerName: currentOwnerId ? suggestion.currentOwnerName : null,
    recommendedOwnerId,
    recommendedOwnerName: recommendedOwnerId ? suggestion.recommendedOwnerName : null,
    suggestedCollaboratorIds: suggestedCollaborators.map((entry) => entry.id),
    suggestedCollaboratorNames: suggestedCollaborators.map((entry) => entry.name),
  };
}

function sanitizeHandoffRisk(risk: HandoffRisk, activeUserIds: Set<string>): HandoffRisk {
  const ownerId = risk.ownerId && activeUserIds.has(risk.ownerId) ? risk.ownerId : null;
  const blockerOwnerId = risk.blockerOwnerId && activeUserIds.has(risk.blockerOwnerId) ? risk.blockerOwnerId : null;
  return {
    ...risk,
    ownerId,
    ownerName: ownerId ? risk.ownerName : null,
    blockerOwnerId,
    blockerOwnerName: blockerOwnerId ? risk.blockerOwnerName : null,
  };
}

function sanitizeCoverageGap(gap: CoverageGap, activeUserIds: Set<string>): CoverageGap {
  const suggestedOwners = gap.suggestedOwnerIds.reduce<Array<{ id: string; name: string }>>((acc, userId, index) => {
    if (!activeUserIds.has(userId)) return acc;
    acc.push({ id: userId, name: gap.suggestedOwnerNames[index] ?? userId });
    return acc;
  }, []);

  return {
    ...gap,
    suggestedOwnerIds: suggestedOwners.map((entry) => entry.id),
    suggestedOwnerNames: suggestedOwners.map((entry) => entry.name),
  };
}

function sanitizeSnapshotForActiveMembers(snapshot: CoordinationSnapshotData, activeUserIds: Set<string>): CoordinationSnapshotData {
  const ownerSuggestions = snapshot.ownerSuggestions.map((suggestion) => sanitizeTaskOwnerSuggestion(suggestion, activeUserIds));
  const teamOwnerSuggestions = snapshot.teamCoordination.ownerSuggestions.map((suggestion) => sanitizeTaskOwnerSuggestion(suggestion, activeUserIds));
  const teamSuggestedResponsibilities = snapshot.teamCoordination.suggestedResponsibilities.map((suggestion) => sanitizeTaskOwnerSuggestion(suggestion, activeUserIds));
  const visibleWorkloadPeople = snapshot.workloadBalance.people.filter((person) => activeUserIds.has(person.userId));
  const averageActiveTasks = visibleWorkloadPeople.length
    ? roundNumber(visibleWorkloadPeople.reduce((sum, person) => sum + person.activeTasks, 0) / visibleWorkloadPeople.length)
    : 0;
  const averageRecentHours = visibleWorkloadPeople.length
    ? roundNumber(visibleWorkloadPeople.reduce((sum, person) => sum + person.recentHours, 0) / visibleWorkloadPeople.length)
    : 0;

  return {
    ...snapshot,
    teamCoordination: {
      ...snapshot.teamCoordination,
      ownerSuggestions: teamOwnerSuggestions,
      suggestedResponsibilities: teamSuggestedResponsibilities,
    },
    needsOwner: snapshot.needsOwner.map((suggestion) => sanitizeTaskOwnerSuggestion(suggestion, activeUserIds)),
    blockedHandoffs: snapshot.blockedHandoffs.map((risk) => sanitizeHandoffRisk(risk, activeUserIds)),
    workloadBalance: {
      ...snapshot.workloadBalance,
      averageActiveTasks,
      averageRecentHours,
      people: visibleWorkloadPeople,
    },
    knowledgeCoverage: {
      ...snapshot.knowledgeCoverage,
      gaps: snapshot.knowledgeCoverage.gaps.map((gap) => sanitizeCoverageGap(gap, activeUserIds)),
    },
    contributionProfiles: snapshot.contributionProfiles.filter((profile) => activeUserIds.has(profile.userId)),
    personQueues: snapshot.personQueues.filter((queue) => activeUserIds.has(queue.userId)),
    ownerSuggestions,
  };
}

function sanitizeStoredGraphForActiveMembers(graph: StoredGraphRow, activeUserIds: Set<string>): StoredGraphRow {
  const nodes = graph.nodes.filter((node) => node.node_type !== 'person' || activeUserIds.has(node.external_id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from_node_id) && nodeIds.has(edge.to_node_id));
  return { ...graph, nodes, edges };
}

function shapeSnapshotForViewer(snapshot: CoordinationSnapshotData, viewerUserId: string, viewerRole: ViewerRole, stale: boolean): CoordinationSnapshot {
  const myNextActions = snapshot.personQueues.find((queue) => queue.userId === viewerUserId) ?? null;
  if (viewerRole === 'owner') {
    return {
      ...snapshot,
      teamCoordination: {
        ...snapshot.teamCoordination,
        suggestedResponsibilities: snapshot.teamCoordination.ownerSuggestions.slice(0, 8),
      },
      status: stale ? 'stale' : 'ready',
      viewerRole,
      stale,
      myNextActions,
      errorMessage: null,
    };
  }

  const relevantSuggestions = getRelevantSuggestionsForViewer(snapshot, viewerUserId).slice(0, 10);
  const relevantBlocked = snapshot.blockedHandoffs.filter((risk) =>
    risk.ownerId === viewerUserId || risk.blockerOwnerId === viewerUserId || risk.taskId === myNextActions?.items[0]?.taskId,
  );

  return {
    ...snapshot,
    teamCoordination: {
      ...snapshot.teamCoordination,
      ownerSuggestions: [],
      suggestedResponsibilities: relevantSuggestions,
      summary: myNextActions?.items.length
        ? [`${myNextActions.items.length} coordination items are queued for you.`]
        : ['No direct coordination assignments were detected for you yet.'],
    },
    needsOwner: relevantSuggestions.filter((suggestion) => !suggestion.currentOwnerId),
    blockedHandoffs: relevantBlocked,
    workloadBalance: {
      ...snapshot.workloadBalance,
      people: snapshot.workloadBalance.people.filter((person) => person.userId === viewerUserId),
    },
    contributionProfiles: snapshot.contributionProfiles.filter((profile) => profile.userId === viewerUserId),
    personQueues: myNextActions ? [myNextActions] : [],
    ownerSuggestions: relevantSuggestions,
    status: stale ? 'stale' : 'ready',
    viewerRole,
    stale,
    myNextActions,
    errorMessage: null,
  };
}

export function materializeCoordinationSnapshotForViewer(
  projectId: string,
  stored: StoredSnapshotRow | null,
  viewerUserId: string,
  viewerRole: ViewerRole,
): CoordinationSnapshot {
  if (!stored || !stored.snapshot) {
    return createEmptySnapshot(projectId, viewerRole, 'missing', stored?.generated_at ?? null, true);
  }

  const snapshot = shapeSnapshotForViewer(stored.snapshot, viewerUserId, viewerRole, stored.is_stale);
  snapshot.generatedAt = stored.generated_at;
  snapshot.graphStats = {
    ...snapshot.graphStats,
    ...(stored.graph_stats ?? {}),
    nodeTypeCounts: {
      ...snapshot.graphStats.nodeTypeCounts,
      ...(stored.graph_stats?.nodeTypeCounts as Record<CoordinationNodeType, number> | undefined),
    },
    edgeTypeCounts: {
      ...snapshot.graphStats.edgeTypeCounts,
      ...(stored.graph_stats?.edgeTypeCounts as Record<CoordinationEdgeType, number> | undefined),
    },
  };
  snapshot.graphInference = createGraphInferenceSummary(snapshot.graphInference);
  return snapshot;
}

function scoreToPriority(score: number): QueuePriority {
  if (score >= 18) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 7) return 'medium';
  return 'low';
}

async function loadSourceData(projectId: string): Promise<{
  project: ProjectRow;
  members: TeamMember[];
  goals: GoalRow[];
  dependencies: GoalDependencyRow[];
  comments: GoalCommentRow[];
  timeLogs: TimeLogRow[];
  events: EventRow[];
  documents: DocumentRow[];
  integrations: IntegrationRow[];
}> {
  const [
    projectRes,
    membersRes,
    goalsRes,
    dependenciesRes,
    commentsRes,
    timeLogsRes,
    eventsRes,
    documentsRes,
    integrationsRes,
  ] = await Promise.all([
    supabase.from('projects').select('id, name, description, owner_id, github_repo, github_repos').eq('id', projectId).single(),
    supabase.from('project_members').select('user_id, role, joined_at').eq('project_id', projectId),
    supabase.from('goals').select('id, title, deadline, status, progress, assigned_to, assignees, category, loe, ai_guidance, created_at, updated_at, created_by, completed_at').eq('project_id', projectId),
    supabase.from('goal_dependencies').select('goal_id, depends_on_goal_id').eq('project_id', projectId),
    supabase.from('goal_comments').select('goal_id, author_id, content, created_at').eq('project_id', projectId),
    supabase.from('time_logs').select('goal_id, user_id, logged_hours, description, logged_at').eq('project_id', projectId),
    supabase.from('events').select('id, actor_id, source, event_type, title, summary, metadata, occurred_at, created_at').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(MAX_EVENTS),
    supabase.from('project_documents').select('id, actor_id, filename, content_preview, summary, keywords, readable, storage_path, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(MAX_DOCUMENTS),
    supabase.from('integrations').select('type, config').eq('project_id', projectId),
  ]);

  if (projectRes.error || !projectRes.data) {
    throw projectRes.error ?? new Error('Project not found');
  }

  const memberRows = (membersRes.data ?? []) as ProjectMemberRow[];
  const memberUserIds = uniqStrings(memberRows.map((row) => row.user_id));
  const fallbackOwnerId = memberUserIds.length === 0 ? projectRes.data.owner_id : null;
  const allUserIds = uniqStrings([fallbackOwnerId, ...memberUserIds]);
  const profilesRes = allUserIds.length
    ? await supabase.from('profiles').select('id, display_name, avatar_url, email').in('id', allUserIds)
    : { data: [], error: null };

  if (profilesRes.error) {
    throw profilesRes.error;
  }

  const profileMap = new Map((profilesRes.data ?? []).map((profile) => [profile.id, profile as ProfileRow]));
  const members = new Map<string, TeamMember>();

  for (const row of memberRows) {
    const profile = profileMap.get(row.user_id);
    members.set(row.user_id, {
      userId: row.user_id,
      displayName: buildDisplayName(profile, row.user_id),
      role: row.role || 'member',
      joinedAt: row.joined_at,
      avatarUrl: profile?.avatar_url ?? null,
      email: profile?.email ?? null,
    });
  }

  if (fallbackOwnerId && !members.has(fallbackOwnerId)) {
    const profile = profileMap.get(fallbackOwnerId);
    members.set(fallbackOwnerId, {
      userId: fallbackOwnerId,
      displayName: buildDisplayName(profile, projectRes.data.owner_id),
      role: 'owner',
      joinedAt: null,
      avatarUrl: profile?.avatar_url ?? null,
      email: profile?.email ?? null,
    });
  } else if (projectRes.data.owner_id) {
    const owner = members.get(projectRes.data.owner_id);
    if (owner) owner.role = 'owner';
  }

  return {
    project: projectRes.data as ProjectRow,
    members: [...members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    goals: (goalsRes.data ?? []) as GoalRow[],
    dependencies: (dependenciesRes.data ?? []) as GoalDependencyRow[],
    comments: (commentsRes.data ?? []) as GoalCommentRow[],
    timeLogs: (timeLogsRes.data ?? []) as TimeLogRow[],
    events: ((eventsRes.data ?? []) as Array<Omit<EventRow, 'metadata'> & { metadata: unknown }>).map((event) => ({
      ...event,
      metadata: asRecord(event.metadata),
    })),
    documents: (documentsRes.data ?? []) as DocumentRow[],
    integrations: (integrationsRes.data ?? []) as IntegrationRow[],
  };
}

function buildConceptRegistry(project: ProjectRow, goals: GoalRow[], documents: DocumentRow[], events: EventRow[], repoRefs: string[]): Map<string, ConceptCandidate> {
  const candidates = new Map<string, ConceptCandidate>();

  const registerConcept = (rawValue: string | null | undefined, weight: number, explicit = false) => {
    if (!rawValue) return;
    const normalized = normalizeConcept(rawValue);
    if (!isMeaningfulConcept(normalized)) return;
    const existing = candidates.get(normalized);
    candidates.set(normalized, {
      label: existing?.label ?? normalizeWhitespace(rawValue),
      weight: (existing?.weight ?? 0) + weight,
      explicit: explicit || existing?.explicit || false,
    });
  };

  const registerTerms = (text: string | null | undefined, weight: number) => {
    if (!text) return;
    for (const term of extractTerms(text, 18)) registerConcept(term, weight, false);
  };

  registerTerms(project.description, 0.6);

  for (const goal of goals) {
    registerConcept(goal.category, 6, true);
    registerConcept(goal.loe, 5, true);
    registerTerms(goal.title, 1.8);
    registerTerms(goal.ai_guidance, 0.8);
  }

  for (const document of documents) {
    for (const keyword of document.keywords ?? []) registerConcept(keyword, 4, true);
    registerTerms(document.filename, 1.2);
    registerTerms(document.summary, 1.0);
    registerTerms(document.content_preview, 0.6);
  }

  for (const repo of repoRefs) {
    const repoName = repo.split('/').pop() ?? repo;
    registerConcept(repoName, 2, true);
    registerTerms(repo.replace(/[/:]/g, ' '), 1);
  }

  for (const event of events) {
    registerTerms(event.title, 0.4);
    registerTerms(event.summary, 0.3);
  }

  const selected = [...candidates.entries()]
    .sort((a, b) => {
      if (a[1].explicit !== b[1].explicit) return a[1].explicit ? -1 : 1;
      return b[1].weight - a[1].weight || a[0].localeCompare(b[0]);
    })
    .slice(0, MAX_CONCEPTS);

  return new Map(selected);
}

function findConceptMatches(textParts: Array<string | null | undefined>, registry: Map<string, ConceptCandidate>): string[] {
  const text = normalizeConcept(textParts.filter(Boolean).join(' '));
  if (!text) return [];
  const tokens = new Set(extractTerms(text, 64));
  const matches: string[] = [];
  for (const conceptKey of registry.keys()) {
    if (conceptKey.includes(' ')) {
      if (text.includes(conceptKey)) matches.push(conceptKey);
      continue;
    }
    if (tokens.has(conceptKey)) matches.push(conceptKey);
  }
  return [...new Set(matches)];
}

function mergeEvidence(parts: Array<string | null | undefined>): string[] {
  return [...new Set(parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0))].slice(0, 4);
}

function buildWorkloadSummary(members: TeamMember[], goals: GoalRow[], blockedTaskIds: Set<string>, recentHoursByUser: Map<string, number>): WorkloadSummary {
  const now = new Date();
  const overdueCounts = new Map<string, number>();
  const activeCounts = new Map<string, number>();
  const blockedCounts = new Map<string, number>();
  const staleCounts = new Map<string, number>();
  const recentActivityCounts = new Map<string, number>();
  const weightedLoadByUser = new Map<string, number>();

  for (const goal of goals) {
    if (!isGoalOpen(goal)) continue;
    const assignees = getGoalAssigneeIds(goal);
    if (assignees.length === 0) continue;

    const deadline = goalDeadlineToDate(goal);
    const isOverdue = !!deadline && deadline.getTime() < now.getTime();
    const updatedDaysAgo = daysSince(goal.updated_at, now);
    const isStale = updatedDaysAgo !== null && updatedDaysAgo > WORKLOAD_STALE_WINDOW_DAYS;
    const hasRecentActivity = updatedDaysAgo !== null && updatedDaysAgo <= WORKLOAD_ACTIVITY_WINDOW_DAYS;
    const taskWeight = getGoalWorkloadWeight(goal, now, blockedTaskIds.has(goal.id));
    for (const userId of assignees) {
      bumpCounter(activeCounts, userId, 1);
      if (blockedTaskIds.has(goal.id)) bumpCounter(blockedCounts, userId, 1);
      if (isOverdue) bumpCounter(overdueCounts, userId, 1);
      if (isStale) bumpCounter(staleCounts, userId, 1);
      if (hasRecentActivity) bumpCounter(recentActivityCounts, userId, 1);
      bumpCounter(weightedLoadByUser, userId, taskWeight);
    }
  }

  const activeTaskValues = members.map((member) => activeCounts.get(member.userId) ?? 0);
  const recentHourValues = members.map((member) => recentHoursByUser.get(member.userId) ?? 0);
  const averageActiveTasks = activeTaskValues.length ? activeTaskValues.reduce((sum, value) => sum + value, 0) / activeTaskValues.length : 0;
  const averageRecentHours = recentHourValues.length ? recentHourValues.reduce((sum, value) => sum + value, 0) / recentHourValues.length : 0;

  const rawLoadScores = members.map((member) => {
    const activeTasks = activeCounts.get(member.userId) ?? 0;
    const blockedTasks = blockedCounts.get(member.userId) ?? 0;
    const overdueTasks = overdueCounts.get(member.userId) ?? 0;
    const recentHours = recentHoursByUser.get(member.userId) ?? 0;
    const staleTasks = staleCounts.get(member.userId) ?? 0;
    const recentActivityTasks = recentActivityCounts.get(member.userId) ?? 0;
    const weightedTaskLoad = weightedLoadByUser.get(member.userId) ?? 0;
    const momentumRelief = Math.min(recentActivityTasks * 0.18 + recentHours / 18, Math.max(0.75, weightedTaskLoad * 0.22));
    return Math.max(0, weightedTaskLoad + overdueTasks * 0.85 + blockedTasks * 0.35 + staleTasks * 0.4 - momentumRelief);
  });
  const avgLoadScore = rawLoadScores.length ? rawLoadScores.reduce((sum, value) => sum + value, 0) / rawLoadScores.length : 0;

  const byUser = new Map<string, WorkloadPerson>();
  members.forEach((member, index) => {
    const activeTasks = activeCounts.get(member.userId) ?? 0;
    const blockedTasks = blockedCounts.get(member.userId) ?? 0;
    const overdueTasks = overdueCounts.get(member.userId) ?? 0;
    const recentHours = recentHoursByUser.get(member.userId) ?? 0;
    const staleTasks = staleCounts.get(member.userId) ?? 0;
    const recentActivityTasks = recentActivityCounts.get(member.userId) ?? 0;
    const loadScore = rawLoadScores[index] ?? 0;

    byUser.set(member.userId, {
      userId: member.userId,
      displayName: member.displayName,
      role: member.role,
      activeTasks,
      blockedTasks,
      overdueTasks,
      recentHours: roundNumber(recentHours),
      loadScore: roundNumber(loadScore),
      capacityStatus: getWorkloadCapacity(
        loadScore,
        avgLoadScore,
        activeTasks,
        averageActiveTasks,
        overdueTasks,
        blockedTasks,
        staleTasks,
        recentActivityTasks,
      ),
    });
  });

  return {
    byUser,
    averageActiveTasks: roundNumber(averageActiveTasks),
    averageRecentHours: roundNumber(averageRecentHours),
  };
}

function calculateConfidence(top: CandidateScore, second: CandidateScore | undefined): number {
  const gap = top.raw - (second?.raw ?? 0);
  const base = top.raw / 44;
  const evidenceBonus = (top.continuity >= 2 ? 0.08 : 0) + (top.expertise >= 1.8 ? 0.08 : 0);
  const gapBonus = clamp(gap / 14, 0, 0.18);
  return roundNumber(clamp(base * 0.7 + evidenceBonus + gapBonus, 0, 0.99), 2);
}

function createQueueReason(kind: QueueItem['kind'], suggestion: TaskOwnerSuggestion | null, blockedByTitle: string | null, goal: GoalRow): string {
  if (kind === 'suggested_owner' && suggestion?.recommendedOwnerName) {
    return `Recommended owner based on continuity, expertise, and current capacity.`;
  }
  if (kind === 'suggested_collaborator') {
    return `Suggested collaborator because you already intersect with the related work.`;
  }
  if (blockedByTitle) return `Blocked by ${blockedByTitle}.`;
  if (goal.progress && goal.progress > 0) return `Task is in flight at ${goal.progress}% progress.`;
  return 'Assigned work needs a clear next action.';
}

function createSuggestedAction(kind: QueueItem['kind'], blockedByTitle: string | null, goal: GoalRow): string {
  if (kind === 'suggested_owner') return 'Review the ownership suggestion and either accept or delegate it.';
  if (kind === 'suggested_collaborator') return 'Coordinate with the suggested owner and unblock the shared work.';
  if (blockedByTitle) return `Resolve the dependency on ${blockedByTitle}.`;
  if (goal.progress && goal.progress > 0) return 'Advance the next concrete milestone on this task.';
  return 'Scope the first concrete step and move the task into active work.';
}

function buildGraphData(input: {
  projectId: string;
  members: TeamMember[];
  goals: GoalRow[];
  documents: DocumentRow[];
  repoRefs: Array<{ id: string; label: string; provider: 'github' | 'gitlab'; concepts: string[] }>;
  conceptRegistry: Map<string, ConceptCandidate>;
  taskConcepts: Map<string, string[]>;
  documentConcepts: Map<string, string[]>;
  personConceptScores: Map<string, Map<string, number>>;
  taskParticipants: Map<string, Set<string>>;
  collaborationScores: Map<string, Map<string, number>>;
  blockedTaskPairs: Array<{ taskId: string; blockerId: string }>;
}): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[]; graphStats: GraphStats } {
  const nodes = new Map<string, GraphNodeRecord>();
  const edges = new Map<string, GraphEdgeRecord>();

  const ensureNode = (nodeType: CoordinationNodeType, externalId: string, label: string, metadata: JsonMap = {}) => {
    const key = `${nodeType}:${externalId}`;
    const existing = nodes.get(key);
    if (existing) {
      existing.metadata = { ...existing.metadata, ...metadata };
      return existing;
    }
    const created: GraphNodeRecord = {
      id: randomUUID(),
      project_id: input.projectId,
      node_type: nodeType,
      external_id: externalId,
      label,
      metadata,
    };
    nodes.set(key, created);
    return created;
  };

  const addEdge = (edgeType: CoordinationEdgeType, from: GraphNodeRecord, to: GraphNodeRecord, weight = 1, metadata: JsonMap = {}) => {
    const key = `${edgeType}:${from.id}:${to.id}`;
    const existing = edges.get(key);
    if (existing) {
      existing.weight = roundNumber(existing.weight + weight, 2);
      existing.metadata = { ...existing.metadata, ...metadata };
      return;
    }
    edges.set(key, {
      id: randomUUID(),
      project_id: input.projectId,
      edge_type: edgeType,
      from_node_id: from.id,
      to_node_id: to.id,
      weight: roundNumber(weight, 2),
      metadata,
    });
  };

  const memberMap = new Map(input.members.map((member) => [member.userId, member]));
  const goalMap = new Map(input.goals.map((goal) => [goal.id, goal]));

  for (const member of input.members) {
    ensureNode('person', member.userId, member.displayName, { role: member.role, joinedAt: member.joinedAt });
  }

  for (const [conceptKey, concept] of input.conceptRegistry.entries()) {
    ensureNode('concept', conceptKey, concept.label, { weight: roundNumber(concept.weight) });
  }

  for (const goal of input.goals) {
    const taskNode = ensureNode('task', goal.id, goal.title, {
      status: goal.status,
      progress: goal.progress ?? 0,
      deadline: goal.deadline,
      category: goal.category,
      loe: goal.loe,
    });
    const deliverableNode = ensureNode('deliverable', goal.id, goal.title, {
      taskId: goal.id,
      status: goal.status,
      deadline: goal.deadline,
    });
    addEdge('derived_from', deliverableNode, taskNode, 1, { source: 'goal' });
    addEdge('contributes_to', taskNode, deliverableNode, 1, { source: 'goal' });

    for (const assigneeId of getGoalAssigneeIds(goal)) {
      const person = memberMap.get(assigneeId);
      if (!person) continue;
      const personNode = ensureNode('person', person.userId, person.displayName, { role: person.role, joinedAt: person.joinedAt });
      addEdge('assigned_to', taskNode, personNode, 1, { source: 'goal.assignees' });
      if (assigneeId === getGoalPrimaryOwnerId(goal)) {
        addEdge('owns', personNode, deliverableNode, 1, { source: 'goal.assigned_to' });
      }
    }

    for (const conceptKey of input.taskConcepts.get(goal.id) ?? []) {
      const concept = input.conceptRegistry.get(conceptKey);
      if (!concept) continue;
      const conceptNode = ensureNode('concept', conceptKey, concept.label, { weight: roundNumber(concept.weight) });
      addEdge('covers', taskNode, conceptNode, 1, { source: 'task_concepts' });
      addEdge('covers', deliverableNode, conceptNode, 1, { source: 'deliverable_concepts' });
      addEdge('mentions', taskNode, conceptNode, 0.7, { source: 'task_text' });
    }

    const relatedPeople = input.taskParticipants.get(goal.id) ?? new Set<string>();
    for (const userId of relatedPeople) {
      const person = memberMap.get(userId);
      if (!person) continue;
      const personNode = ensureNode('person', person.userId, person.displayName, { role: person.role, joinedAt: person.joinedAt });
      addEdge('contributes_to', personNode, taskNode, 1, { source: 'task_activity' });
    }
  }

  for (const document of input.documents) {
    const documentNode = ensureNode('document', document.id, document.filename, {
      readable: document.readable,
      createdAt: document.created_at,
    });
    const fileNode = ensureNode('file', document.storage_path ?? document.filename, document.filename, {
      source: 'project_document',
    });
    addEdge('derived_from', documentNode, fileNode, 1, { source: 'project_documents' });

    for (const conceptKey of input.documentConcepts.get(document.id) ?? []) {
      const concept = input.conceptRegistry.get(conceptKey);
      if (!concept) continue;
      const conceptNode = ensureNode('concept', conceptKey, concept.label, { weight: roundNumber(concept.weight) });
      addEdge('covers', documentNode, conceptNode, 1, { source: 'document_keywords' });
      addEdge('mentions', documentNode, conceptNode, 0.8, { source: 'document_summary' });
    }

    if (document.actor_id && memberMap.has(document.actor_id)) {
      const member = memberMap.get(document.actor_id)!;
      const personNode = ensureNode('person', member.userId, member.displayName, { role: member.role, joinedAt: member.joinedAt });
      addEdge('contributes_to', personNode, documentNode, 1, { source: 'document_upload' });
    }
  }

  for (const repoRef of input.repoRefs) {
    const repoNode = ensureNode('repo', repoRef.id, repoRef.label, { provider: repoRef.provider });
    for (const conceptKey of repoRef.concepts) {
      const concept = input.conceptRegistry.get(conceptKey);
      if (!concept) continue;
      const conceptNode = ensureNode('concept', conceptKey, concept.label, { weight: roundNumber(concept.weight) });
      addEdge('covers', repoNode, conceptNode, 0.9, { source: 'repo_name' });
    }
  }

  for (const [userId, conceptScores] of input.personConceptScores.entries()) {
    const person = memberMap.get(userId);
    if (!person) continue;
    const personNode = ensureNode('person', person.userId, person.displayName, { role: person.role, joinedAt: person.joinedAt });
    for (const [conceptKey, score] of pickTopEntries(conceptScores, 10)) {
      const concept = input.conceptRegistry.get(conceptKey);
      if (!concept) continue;
      const conceptNode = ensureNode('concept', conceptKey, concept.label, { weight: roundNumber(concept.weight) });
      addEdge('expert_in', personNode, conceptNode, Math.min(4, roundNumber(score)), { source: 'activity_signals' });
    }
  }

  for (const [userId, peerScores] of input.collaborationScores.entries()) {
    const person = memberMap.get(userId);
    if (!person) continue;
    const personNode = ensureNode('person', person.userId, person.displayName, { role: person.role, joinedAt: person.joinedAt });
    for (const [peerId, score] of peerScores.entries()) {
      if (userId >= peerId || score <= 0) continue;
      const peer = memberMap.get(peerId);
      if (!peer) continue;
      const peerNode = ensureNode('person', peer.userId, peer.displayName, { role: peer.role, joinedAt: peer.joinedAt });
      addEdge('collaborates_with', personNode, peerNode, roundNumber(score), { source: 'shared_work' });
      addEdge('collaborates_with', peerNode, personNode, roundNumber(score), { source: 'shared_work' });
    }
  }

  for (const pair of input.blockedTaskPairs) {
    const task = goalMap.get(pair.taskId);
    const blocker = goalMap.get(pair.blockerId);
    if (!task || !blocker) continue;
    const taskNode = ensureNode('task', task.id, task.title);
    const blockerNode = ensureNode('task', blocker.id, blocker.title);
    addEdge('depends_on', taskNode, blockerNode, 1, { source: 'goal_dependencies' });
    addEdge('blocked_by', taskNode, blockerNode, 1, { source: 'goal_dependencies' });
  }

  const graphStats = computeGraphStats([...nodes.values()], [...edges.values()]);

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    graphStats,
  };
}

function isAllowedInferredEdge(edgeType: CoordinationEdgeType, fromType: CoordinationNodeType, toType: CoordinationNodeType): boolean {
  if (edgeType === 'expert_in') return fromType === 'person' && toType === 'concept';
  if (edgeType === 'collaborates_with') return fromType === 'person' && toType === 'person';
  if (edgeType === 'contributes_to') return fromType === 'person' && (toType === 'task' || toType === 'document' || toType === 'deliverable');
  if (edgeType === 'covers' || edgeType === 'mentions') {
    return toType === 'concept' && ['task', 'document', 'repo', 'deliverable', 'file'].includes(fromType);
  }
  return false;
}

async function inferGraphEnhancements(input: {
  project: ProjectRow;
  members: TeamMember[];
  goals: GoalRow[];
  documents: DocumentRow[];
  repoRefs: Array<{ id: string; label: string; provider: 'github' | 'gitlab'; concepts: string[] }>;
  conceptRegistry: Map<string, ConceptCandidate>;
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  generatedBy: string | null;
  generatedAt: string;
}): Promise<{
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  inference: GraphInferenceSummary;
}> {
  if (!input.generatedBy) {
    return {
      nodes: input.nodes,
      edges: input.edges,
      inference: createGraphInferenceSummary({
        status: 'skipped',
        message: 'AI enrichment runs only for user-triggered snapshot generation.',
      }),
    };
  }

  const providerSelection = await resolveGraphInferenceProvider(input.generatedBy);
  if (!providerSelection) {
    return {
      nodes: input.nodes,
      edges: input.edges,
      inference: createGraphInferenceSummary({
        status: 'skipped',
        message: 'No personal AI provider is configured for graph enrichment.',
      }),
    };
  }

  const refCatalog = [
    ...input.members.slice(0, 16).map((member) => ({
      ref: `person:${member.userId}`,
      label: member.displayName,
      type: 'person',
      detail: trimForPrompt(`${member.role}`, 80),
    })),
    ...input.goals.slice(0, 28).map((goal) => ({
      ref: `task:${goal.id}`,
      label: goal.title,
      type: 'task',
      detail: trimForPrompt([goal.category, goal.loe, goal.ai_guidance].filter(Boolean).join(' | '), 180),
    })),
    ...input.documents.slice(0, 16).map((document) => ({
      ref: `document:${document.id}`,
      label: document.filename,
      type: 'document',
      detail: trimForPrompt([document.summary, ...(document.keywords ?? [])].filter(Boolean).join(' | '), 180),
    })),
    ...input.repoRefs.slice(0, 12).map((repo) => ({
      ref: `repo:${repo.id}`,
      label: repo.label,
      type: 'repo',
      detail: trimForPrompt(`${repo.provider} repository`, 80),
    })),
    ...[...input.conceptRegistry.entries()].slice(0, 24).map(([conceptKey, concept]) => ({
      ref: `concept:${conceptKey}`,
      label: concept.label,
      type: 'concept',
      detail: trimForPrompt(`weight ${roundNumber(concept.weight)}`, 40),
    })),
  ];

  const system = [
    'You enrich a project coordination knowledge graph.',
    'Return strict JSON only. No markdown.',
    'Use only the provided refs. Do not invent people, repos, documents, or tasks.',
    'You may propose new concepts only when they are clearly implied by multiple project signals.',
    'Prefer precise, sparse links over speculative ones.',
  ].join(' ');

  const user = JSON.stringify({
    project: {
      name: input.project.name,
      description: trimForPrompt(input.project.description, 260),
    },
    instructions: {
      goals: [
        'Propose up to 10 new concept nodes with concise labels.',
        'Propose up to 20 inferred relations using only these edge types: covers, mentions, expert_in, contributes_to, collaborates_with.',
        'Only return high-confidence additions that improve project understanding.',
      ],
      outputSchema: {
        concepts: [
          {
            label: 'string',
            connections: [
              {
                fromRef: 'one of the provided refs',
                edgeType: 'covers | mentions | expert_in',
                weight: '0.6 to 4',
                confidence: '0 to 1',
                reason: 'short string',
              },
            ],
          },
        ],
        relations: [
          {
            fromRef: 'one of the provided refs',
            toRef: 'one of the provided refs',
            edgeType: 'covers | mentions | expert_in | contributes_to | collaborates_with',
            weight: '0.6 to 4',
            confidence: '0 to 1',
            reason: 'short string',
          },
        ],
      },
    },
    refs: refCatalog,
  });

  try {
    const result = await chat(
      providerSelection.provider,
      {
        system,
        user,
        maxTokens: 1800,
        jsonMode: isOpenAiProviderSelection(providerSelection.provider) || providerSelection.provider === 'gpt-4o',
      },
      providerSelection.credential,
    );
    try {
      await logAiTokenUsage({
        authHeader: undefined,
        result,
        feature: 'coordination_graph_enrichment',
        routePath: '/api/projects/:projectId/coordination/recompute',
        projectId: input.project.id,
        knownUserId: input.generatedBy,
      });
    } catch {
      // Coordination generation should not fail if usage auditing fails.
    }

    const parsed = JSON.parse(extractJsonPayload(result.text)) as GraphInferenceDraft;
    const nodes = [...input.nodes];
    const edges = [...input.edges];
    const existingNodeKeys = new Map(input.nodes.map((node) => [`${node.node_type}:${node.external_id}`, node]));
    const edgeKeys = new Set(input.edges.map((edge) => `${edge.edge_type}:${edge.from_node_id}:${edge.to_node_id}`));
    const resolveRef = (ref: string): GraphNodeRecord | null => {
      const [nodeType, ...rest] = ref.split(':');
      const externalId = rest.join(':');
      if (!nodeType || !externalId) return null;
      return existingNodeKeys.get(`${nodeType}:${externalId}`) ?? null;
    };

    const ensureInferredConceptNode = (label: string, reason: string, confidence: number): GraphNodeRecord | null => {
      const normalized = normalizeConcept(label);
      if (!isMeaningfulConcept(normalized)) return null;

      const existingConcept = existingNodeKeys.get(`concept:${normalized}`);
      if (existingConcept) return existingConcept;

      const existingInferred = existingNodeKeys.get(`concept:ai:${normalized}`);
      if (existingInferred) return existingInferred;

      const created: GraphNodeRecord = {
        id: randomUUID(),
        project_id: input.project.id,
        node_type: 'concept',
        external_id: `ai:${normalized}`,
        label: normalizeWhitespace(label),
        metadata: {
          layer: 'ai_inferred',
          reason,
          confidence: roundNumber(confidence, 2),
          provider: result.provider,
          generatedAt: input.generatedAt,
        },
      };
      existingNodeKeys.set(`concept:ai:${normalized}`, created);
      nodes.push(created);
      return created;
    };

    for (const concept of (parsed.concepts ?? []).slice(0, 10)) {
      if (!concept?.label || !Array.isArray(concept.connections) || concept.connections.length === 0) continue;
      const conceptNode = ensureInferredConceptNode(
        concept.label,
        concept.connections[0]?.reason ?? 'AI-inferred concept connection',
        concept.connections[0]?.confidence ?? 0.7,
      );
      if (!conceptNode) continue;

      for (const connection of concept.connections.slice(0, 8)) {
        const fromNode = resolveRef(connection.fromRef);
        if (!fromNode) continue;
        if (!isAllowedInferredEdge(connection.edgeType, fromNode.node_type, conceptNode.node_type)) continue;

        const key = `${connection.edgeType}:${fromNode.id}:${conceptNode.id}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({
          id: randomUUID(),
          project_id: input.project.id,
          edge_type: connection.edgeType,
          from_node_id: fromNode.id,
          to_node_id: conceptNode.id,
          weight: roundNumber(clamp(connection.weight ?? 0.9, 0.6, 4), 2),
          metadata: {
            layer: 'ai_inferred',
            reason: trimForPrompt(connection.reason, 180),
            confidence: roundNumber(clamp(connection.confidence ?? 0.7, 0, 1), 2),
            provider: result.provider,
            generatedAt: input.generatedAt,
          },
        });
      }
    }

    for (const relation of (parsed.relations ?? []).slice(0, 20)) {
      const fromNode = resolveRef(relation.fromRef);
      const toNode = resolveRef(relation.toRef);
      if (!fromNode || !toNode) continue;
      if (!isAllowedInferredEdge(relation.edgeType, fromNode.node_type, toNode.node_type)) continue;

      const key = `${relation.edgeType}:${fromNode.id}:${toNode.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({
        id: randomUUID(),
        project_id: input.project.id,
        edge_type: relation.edgeType,
        from_node_id: fromNode.id,
        to_node_id: toNode.id,
        weight: roundNumber(clamp(relation.weight ?? 0.9, 0.6, 4), 2),
        metadata: {
          layer: 'ai_inferred',
          reason: trimForPrompt(relation.reason, 180),
          confidence: roundNumber(clamp(relation.confidence ?? 0.7, 0, 1), 2),
          provider: result.provider,
          generatedAt: input.generatedAt,
        },
      });
    }

    const inferredNodeCount = nodes.filter((node) => readString(asRecord(node.metadata)?.layer) === 'ai_inferred').length;
    const inferredEdgeCount = edges.filter((edge) => readString(asRecord(edge.metadata)?.layer) === 'ai_inferred').length;

    return {
      nodes,
      edges,
      inference: createGraphInferenceSummary({
        status: inferredNodeCount || inferredEdgeCount ? 'available' : 'skipped',
        provider: result.provider,
        message: inferredNodeCount || inferredEdgeCount
          ? 'AI enrichment added inferred concepts and relations.'
          : 'AI enrichment did not find high-confidence additions.',
        generatedAt: input.generatedAt,
        inferredNodeCount,
        inferredEdgeCount,
      }),
    };
  } catch (error: any) {
    return {
      nodes: input.nodes,
      edges: input.edges,
      inference: createGraphInferenceSummary({
        status: 'error',
        provider: providerSelection.provider,
        message: error?.message ?? 'AI enrichment failed.',
        generatedAt: input.generatedAt,
      }),
    };
  }
}

async function buildSnapshot(projectId: string, generatedBy: string | null): Promise<{ snapshot: CoordinationSnapshotData; nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] }> {
  const source = await loadSourceData(projectId);
  const now = new Date();
  const generatedAt = new Date().toISOString();
  const memberMap = new Map(source.members.map((member) => [member.userId, member]));
  const goalMap = new Map(source.goals.map((goal) => [goal.id, goal]));

  const repoRefs = [
    ...getGitHubRepos(source.project).map((repo) => ({ id: `github:${repo}`, label: repo, provider: 'github' as const })),
    ...getGitLabRepos(source.integrations).map((repo) => ({ id: `gitlab:${repo}`, label: repo, provider: 'gitlab' as const })),
  ];

  const conceptRegistry = buildConceptRegistry(source.project, source.goals, source.documents, source.events, repoRefs.map((repo) => repo.label));

  const taskConcepts = new Map<string, string[]>();
  const documentConcepts = new Map<string, string[]>();
  const repoConcepts = new Map<string, string[]>();

  for (const goal of source.goals) {
    taskConcepts.set(goal.id, findConceptMatches([goal.title, goal.category, goal.loe, goal.ai_guidance], conceptRegistry));
  }
  for (const document of source.documents) {
    documentConcepts.set(document.id, findConceptMatches([document.filename, document.summary, document.content_preview, ...(document.keywords ?? [])], conceptRegistry));
  }
  for (const repoRef of repoRefs) {
    repoConcepts.set(repoRef.id, findConceptMatches([repoRef.label], conceptRegistry));
  }

  const dependencyMap = new Map<string, string[]>();
  const reverseDependencyMap = new Map<string, string[]>();
  for (const dependency of source.dependencies) {
    const existing = dependencyMap.get(dependency.goal_id) ?? [];
    existing.push(dependency.depends_on_goal_id);
    dependencyMap.set(dependency.goal_id, existing);

    const reverseExisting = reverseDependencyMap.get(dependency.depends_on_goal_id) ?? [];
    reverseExisting.push(dependency.goal_id);
    reverseDependencyMap.set(dependency.depends_on_goal_id, reverseExisting);
  }

  const blockedTaskPairs: Array<{ taskId: string; blockerId: string }> = [];
  const blockedTaskIds = new Set<string>();
  for (const goal of source.goals) {
    const blockers = dependencyMap.get(goal.id) ?? [];
    for (const blockerId of blockers) {
      const blocker = goalMap.get(blockerId);
      if (!blocker || blocker.status === 'complete') continue;
      blockedTaskIds.add(goal.id);
      blockedTaskPairs.push({ taskId: goal.id, blockerId });
    }
  }

  const personConceptScores = new Map<string, Map<string, number>>();
  const taskContinuity = new Map<string, Map<string, number>>();
  const taskCommentCounts = new Map<string, Map<string, number>>();
  const taskTimeHours = new Map<string, Map<string, number>>();
  const taskEventCounts = new Map<string, Map<string, number>>();
  const taskParticipants = new Map<string, Set<string>>();
  const recentHoursByUser = new Map<string, number>();
  const documentsContributed = new Map<string, number>();
  const commentsContributed = new Map<string, number>();
  const collaborationScores = new Map<string, Map<string, number>>();
  const taskFileRefs = new Map<string, Set<string>>();
  const documentFileRefs = new Map<string, Set<string>>();

  const addConceptScore = (userId: string, conceptKey: string, amount: number) => {
    const conceptScores = personConceptScores.get(userId) ?? new Map<string, number>();
    conceptScores.set(conceptKey, (conceptScores.get(conceptKey) ?? 0) + amount);
    personConceptScores.set(userId, conceptScores);
  };

  const addTaskParticipant = (taskId: string, userId: string) => {
    if (!memberMap.has(userId)) return;
    addToSetMap(taskParticipants, taskId, userId);
  };

  for (const goal of source.goals) {
    const conceptKeys = taskConcepts.get(goal.id) ?? [];
    const assignees = getGoalAssigneeIds(goal);
    const primaryOwnerId = getGoalPrimaryOwnerId(goal);

    if (goal.created_by && memberMap.has(goal.created_by)) {
      addTaskParticipant(goal.id, goal.created_by);
      bumpNestedCounter(taskContinuity, goal.id, goal.created_by, 1.5);
      for (const conceptKey of conceptKeys) addConceptScore(goal.created_by, conceptKey, 0.7);
    }

    assignees.forEach((userId, index) => {
      if (!memberMap.has(userId)) return;
      addTaskParticipant(goal.id, userId);
      bumpNestedCounter(taskContinuity, goal.id, userId, index === 0 ? 5 : 4);
      for (const conceptKey of conceptKeys) addConceptScore(userId, conceptKey, isGoalOpen(goal) ? 1.2 : 0.7);
    });

    for (const fileRef of extractFileReferences([goal.title, goal.ai_guidance].filter(Boolean).join(' '), 6)) {
      addToSetMap(taskFileRefs, goal.id, fileRef);
    }

    const goalEvents = source.events.filter((event) => readString(event.metadata?.goal_id) === goal.id);
    for (const event of goalEvents) {
      if (!event.actor_id || !memberMap.has(event.actor_id)) continue;
      addTaskParticipant(goal.id, event.actor_id);
      bumpNestedCounter(taskContinuity, goal.id, event.actor_id, 1.1);
      bumpNestedCounter(taskEventCounts, goal.id, event.actor_id, 1);
      for (const conceptKey of conceptKeys) addConceptScore(event.actor_id, conceptKey, 0.5);
    }
  }

  for (const comment of source.comments) {
    if (!comment.author_id || !memberMap.has(comment.author_id) || !goalMap.has(comment.goal_id)) continue;
    addTaskParticipant(comment.goal_id, comment.author_id);
    bumpNestedCounter(taskContinuity, comment.goal_id, comment.author_id, 1.3);
    bumpNestedCounter(taskCommentCounts, comment.goal_id, comment.author_id, 1);
    bumpCounter(commentsContributed, comment.author_id, 1);
    for (const conceptKey of taskConcepts.get(comment.goal_id) ?? []) addConceptScore(comment.author_id, conceptKey, 0.8);
    for (const fileRef of extractFileReferences(comment.content, 5)) addToSetMap(taskFileRefs, comment.goal_id, fileRef);
  }

  const recentWindowStart = new Date(now.getTime() - RECENT_HOURS_WINDOW_DAYS * 86_400_000);
  for (const log of source.timeLogs) {
    if (!log.user_id || !memberMap.has(log.user_id) || !goalMap.has(log.goal_id)) continue;
    addTaskParticipant(log.goal_id, log.user_id);
    const continuityBoost = Math.min(4, log.logged_hours * 0.75);
    bumpNestedCounter(taskContinuity, log.goal_id, log.user_id, continuityBoost);
    bumpNestedCounter(taskTimeHours, log.goal_id, log.user_id, log.logged_hours);
    for (const conceptKey of taskConcepts.get(log.goal_id) ?? []) addConceptScore(log.user_id, conceptKey, Math.min(3, log.logged_hours * 0.5));
    const loggedAt = new Date(log.logged_at);
    if (!Number.isNaN(loggedAt.getTime()) && loggedAt >= recentWindowStart) {
      bumpCounter(recentHoursByUser, log.user_id, log.logged_hours);
    }
  }

  for (const document of source.documents) {
    const fileRefs = new Set<string>([
      ...(document.storage_path ? [document.storage_path] : []),
      document.filename,
      ...extractFileReferences([document.summary, document.content_preview].filter(Boolean).join(' '), 5),
    ]);
    documentFileRefs.set(document.id, fileRefs);

    if (document.actor_id && memberMap.has(document.actor_id)) {
      bumpCounter(documentsContributed, document.actor_id, 1);
      for (const conceptKey of documentConcepts.get(document.id) ?? []) addConceptScore(document.actor_id, conceptKey, 1.4);
    }
  }

  for (const event of source.events) {
    if (!event.actor_id || !memberMap.has(event.actor_id)) continue;
    const eventConcepts = findConceptMatches([event.title, event.summary], conceptRegistry);
    for (const conceptKey of eventConcepts) addConceptScore(event.actor_id, conceptKey, 0.35);
  }

  const taskDocumentLinks = new Map<string, Set<string>>();
  for (const goal of source.goals) {
    const goalConceptSet = new Set(taskConcepts.get(goal.id) ?? []);
    if (goalConceptSet.size === 0) continue;
    for (const document of source.documents) {
      const overlap = (documentConcepts.get(document.id) ?? []).filter((concept) => goalConceptSet.has(concept));
      if (overlap.length === 0) continue;
      addToSetMap(taskDocumentLinks, goal.id, document.id);
      if (document.actor_id && memberMap.has(document.actor_id)) {
        addTaskParticipant(goal.id, document.actor_id);
        bumpNestedCounter(taskContinuity, goal.id, document.actor_id, Math.min(1.5, overlap.length * 0.5));
      }
    }
  }

  for (const [taskId, participants] of taskParticipants.entries()) {
    const memberIds = [...participants];
    for (let index = 0; index < memberIds.length; index += 1) {
      for (let inner = index + 1; inner < memberIds.length; inner += 1) {
        const a = memberIds[index];
        const b = memberIds[inner];
        bumpNestedCounter(collaborationScores, a, b, 1);
        bumpNestedCounter(collaborationScores, b, a, 1);
      }
    }
  }

  const workload = buildWorkloadSummary(source.members, source.goals, blockedTaskIds, recentHoursByUser);
  const workloadPeople = [...workload.byUser.values()].sort((a, b) => b.loadScore - a.loadScore || a.displayName.localeCompare(b.displayName));
  const avgLoadScore = workloadPeople.length ? workloadPeople.reduce((sum, person) => sum + person.loadScore, 0) / workloadPeople.length : 0;

  const conceptExperts = new Map<string, Array<{ userId: string; score: number }>>();
  for (const member of source.members) {
    const conceptScores = personConceptScores.get(member.userId) ?? new Map<string, number>();
    for (const [conceptKey, score] of conceptScores.entries()) {
      const entries = conceptExperts.get(conceptKey) ?? [];
      entries.push({ userId: member.userId, score });
      conceptExperts.set(conceptKey, entries);
    }
  }
  for (const entries of conceptExperts.values()) {
    entries.sort((a, b) => b.score - a.score);
  }

  const suggestions: TaskOwnerSuggestion[] = [];
  for (const goal of source.goals.filter(isGoalOpen)) {
    const goalConcepts = taskConcepts.get(goal.id) ?? [];
    const urgency = getUrgency(goal, now, (reverseDependencyMap.get(goal.id) ?? []).length);
    const relatedPeople = new Set(taskParticipants.get(goal.id) ?? []);
    const blockers = (dependencyMap.get(goal.id) ?? []).filter((blockerId) => goalMap.get(blockerId)?.status !== 'complete');
    for (const blockerId of blockers) {
      const blocker = goalMap.get(blockerId);
      for (const assignee of blocker ? getGoalAssigneeIds(blocker) : []) relatedPeople.add(assignee);
    }

    const currentOwnerId = getGoalPrimaryOwnerId(goal);
    const currentOwner = currentOwnerId ? memberMap.get(currentOwnerId) : undefined;
    const candidates: CandidateScore[] = source.members.map((member) => {
      const continuity = Math.min(5, getNestedValue(taskContinuity, goal.id, member.userId));
      const expertiseScores = goalConcepts.map((conceptKey) => Math.min(4, personConceptScores.get(member.userId)?.get(conceptKey) ?? 0));
      const expertise = expertiseScores.length
        ? Math.min(4, expertiseScores.reduce((sum, value) => sum + value, 0) / expertiseScores.length)
        : 0;
      const workloadEntry = workload.byUser.get(member.userId);
      const capacity = workloadEntry?.capacityStatus === 'light'
        ? 2.5
        : workloadEntry?.capacityStatus === 'balanced'
          ? 1.5
          : workloadEntry?.capacityStatus === 'heavy'
            ? (continuity >= 3 ? 0.9 : 0.4)
            : 1;

      let adjacency = 0;
      for (const relatedUserId of relatedPeople) {
        if (relatedUserId === member.userId) continue;
        adjacency += (collaborationScores.get(member.userId)?.get(relatedUserId) ?? 0) * 0.6;
      }
      adjacency = Math.min(3, adjacency);

      const urgencyFit = urgency.score >= 3
        ? continuity >= 2
          ? 1.5
          : expertise >= 1.6
            ? 1.0
            : capacity >= 2
              ? 0.5
              : 0
        : continuity >= 1.5
          ? 0.6
          : 0.2;

      const raw = continuity * 4 + expertise * 3 + capacity * 2 + adjacency + urgencyFit * 1.5;
      const commentCount = getNestedValue(taskCommentCounts, goal.id, member.userId);
      const loggedHours = getNestedValue(taskTimeHours, goal.id, member.userId);
      const eventCount = getNestedValue(taskEventCounts, goal.id, member.userId);
      const overlapConceptLabels = goalConcepts
        .filter((conceptKey) => (personConceptScores.get(member.userId)?.get(conceptKey) ?? 0) > 0.8)
        .slice(0, 2)
        .map((conceptKey) => conceptRegistry.get(conceptKey)?.label ?? conceptKey);

      const evidence = mergeEvidence([
        currentOwnerId === member.userId ? 'Already owns the active work stream for this task.' : null,
        goal.created_by === member.userId ? 'Created the task and already has local context.' : null,
        loggedHours > 0 ? `Logged ${roundNumber(loggedHours)}h on this task.` : null,
        commentCount > 0 ? `Added ${commentCount} task comments.` : null,
        eventCount > 0 ? 'Has touched recent lifecycle activity on this task.' : null,
        overlapConceptLabels.length ? `Strongest expertise match: ${overlapConceptLabels.join(', ')}.` : null,
        workloadEntry?.capacityStatus === 'light' ? 'Current workload is below the team average.' : null,
        adjacency >= 1 ? 'Frequently collaborates with the people already linked to this work.' : null,
      ]);

      return {
        userId: member.userId,
        continuity: roundNumber(continuity),
        expertise: roundNumber(expertise),
        capacity: roundNumber(capacity),
        adjacency: roundNumber(adjacency),
        urgencyFit: roundNumber(urgencyFit),
        raw: roundNumber(raw),
        confidence: 0,
        workloadState: workloadEntry?.capacityStatus ?? 'unknown',
        evidence,
      };
    }).sort((a, b) => b.raw - a.raw || a.userId.localeCompare(b.userId));

    const top = candidates[0];
    const second = candidates[1];
    if (top) top.confidence = calculateConfidence(top, second);

    const noRecommendation = !top
      || top.confidence < 0.55
      || (top.continuity < 2 && top.expertise < 1.8)
      || (!!second && (top.raw - second.raw < 2.2) && top.confidence < 0.75);

    const collaboratorCandidates = candidates
      .filter((candidate) =>
        candidate.userId !== top?.userId
        && (candidate.expertise >= 1.3 || candidate.adjacency >= 1.2)
        && candidate.workloadState !== 'heavy',
      )
      .slice(0, 2);

    suggestions.push({
      taskId: goal.id,
      taskTitle: goal.title,
      currentOwnerId,
      currentOwnerName: currentOwner?.displayName ?? currentOwnerId,
      recommendedOwnerId: noRecommendation ? null : top.userId,
      recommendedOwnerName: noRecommendation ? null : (memberMap.get(top.userId)?.displayName ?? top.userId),
      confidence: noRecommendation ? roundNumber(top?.confidence ?? 0) : top.confidence,
      evidence: noRecommendation
        ? mergeEvidence([
          top?.evidence[0] ?? null,
          'Signals are too weak or too ambiguous to force an owner recommendation.',
        ])
        : top.evidence,
      suggestedCollaboratorIds: collaboratorCandidates.map((candidate) => candidate.userId),
      suggestedCollaboratorNames: collaboratorCandidates.map((candidate) => memberMap.get(candidate.userId)?.displayName ?? candidate.userId),
      workloadState: noRecommendation ? 'unknown' : top.workloadState,
      urgency: urgency.label,
      status: goal.status,
      dueDate: goal.deadline,
    });
  }

  suggestions.sort((a, b) => {
    const urgencyRank: Record<QueuePriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const urgencyDiff = urgencyRank[b.urgency] - urgencyRank[a.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.confidence - a.confidence || a.taskTitle.localeCompare(b.taskTitle);
  });

  const needsOwner = suggestions.filter((suggestion) => !suggestion.currentOwnerId);

  const blockedHandoffs: HandoffRisk[] = blockedTaskPairs.map(({ taskId, blockerId }) => {
    const task = goalMap.get(taskId)!;
    const blocker = goalMap.get(blockerId)!;
    const ownerId = getGoalPrimaryOwnerId(task);
    const blockerOwnerId = getGoalPrimaryOwnerId(blocker);
    const ownerName = ownerId ? memberMap.get(ownerId)?.displayName ?? ownerId : null;
    const blockerOwnerName = blockerOwnerId ? memberMap.get(blockerOwnerId)?.displayName ?? blockerOwnerId : null;
    const severity: Severity = !blockerOwnerId || !ownerId
      ? 'high'
      : blocker.deadline && new Date(`${blocker.deadline}T23:59:59Z`).getTime() < now.getTime()
        ? 'high'
        : 'medium';
    return {
      taskId: task.id,
      taskTitle: task.title,
      ownerId,
      ownerName,
      blockedByTaskId: blocker.id,
      blockedByTaskTitle: blocker.title,
      blockerOwnerId,
      blockerOwnerName,
      severity,
      reason: blockerOwnerId
        ? `${task.title} is waiting on ${blocker.title}, which is still incomplete.`
        : `${task.title} is blocked by ${blocker.title}, and the blocker does not have an active owner.`,
      suggestedNextStep: blockerOwnerName
        ? `Coordinate the handoff with ${blockerOwnerName} and close the blocker first.`
        : 'Assign an owner to the blocker before continuing downstream work.',
    };
  }).sort((a, b) => {
    const severityRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
    return severityRank[b.severity] - severityRank[a.severity] || a.taskTitle.localeCompare(b.taskTitle);
  });

  const contributionProfiles: ContributionProfile[] = source.members.map((member) => {
    const conceptScores = personConceptScores.get(member.userId) ?? new Map<string, number>();
    const completedTasks = source.goals.filter((goal) => goal.status === 'complete' && getGoalAssigneeIds(goal).includes(member.userId)).length;
    return {
      userId: member.userId,
      displayName: member.displayName,
      role: member.role,
      activeTasks: workload.byUser.get(member.userId)?.activeTasks ?? 0,
      completedTasks,
      recentHours: roundNumber(recentHoursByUser.get(member.userId) ?? 0),
      documentsContributed: documentsContributed.get(member.userId) ?? 0,
      commentsContributed: commentsContributed.get(member.userId) ?? 0,
      collaborationCount: (collaborationScores.get(member.userId)?.size ?? 0),
      topConcepts: pickTopEntries(conceptScores, 5).map(([conceptKey, score]) => ({
        label: conceptRegistry.get(conceptKey)?.label ?? conceptKey,
        score: roundNumber(score),
      })),
    };
  }).sort((a, b) => b.activeTasks - a.activeTasks || b.recentHours - a.recentHours || a.displayName.localeCompare(b.displayName));

  const knowledgeCoverageEntries: KnowledgeCoverageEntry[] = [...conceptRegistry.entries()].map(([conceptKey, concept]) => {
    const linkedTasks = source.goals.filter((goal) => (taskConcepts.get(goal.id) ?? []).includes(conceptKey));
    const linkedDocuments = source.documents.filter((document) => (documentConcepts.get(document.id) ?? []).includes(conceptKey));
    const experts = (conceptExperts.get(conceptKey) ?? []).filter((entry) => entry.score >= 1.5);
    return {
      label: concept.label,
      taskCount: linkedTasks.length,
      documentCount: linkedDocuments.length,
      expertCount: experts.length,
      coverageScore: roundNumber(linkedTasks.length * 2 + linkedDocuments.length * 1.25 + experts.length * 1.5),
      ownerNames: experts.slice(0, 3).map((entry) => memberMap.get(entry.userId)?.displayName ?? entry.userId),
    };
  }).sort((a, b) => b.coverageScore - a.coverageScore || a.label.localeCompare(b.label)).slice(0, 12);

  const coverageGaps: CoverageGap[] = [];
  for (const [conceptKey, concept] of conceptRegistry.entries()) {
    const linkedTasks = source.goals.filter((goal) => (taskConcepts.get(goal.id) ?? []).includes(conceptKey) && isGoalOpen(goal));
    if (linkedTasks.length === 0) continue;
    const experts = (conceptExperts.get(conceptKey) ?? []).filter((entry) => entry.score >= 1.2);
    const linkedDocuments = source.documents.filter((document) => (documentConcepts.get(document.id) ?? []).includes(conceptKey));
    if (experts.length === 0 || linkedDocuments.length === 0) {
      coverageGaps.push({
        id: `concept:${conceptKey}`,
        gapType: 'concept',
        label: concept.label,
        reason: experts.length === 0
          ? `Open work depends on ${concept.label}, but nobody has strong demonstrated coverage yet.`
          : `${concept.label} is active in open work, but there is no supporting project document coverage yet.`,
        linkedTaskIds: linkedTasks.map((goal) => goal.id),
        linkedTaskTitles: linkedTasks.map((goal) => goal.title),
        suggestedOwnerIds: experts.slice(0, 2).map((entry) => entry.userId),
        suggestedOwnerNames: experts.slice(0, 2).map((entry) => memberMap.get(entry.userId)?.displayName ?? entry.userId),
      });
    }
  }

  for (const suggestion of needsOwner) {
    if (!suggestion.recommendedOwnerId && suggestion.confidence < 0.55) {
      coverageGaps.push({
        id: `deliverable:${suggestion.taskId}`,
        gapType: 'deliverable',
        label: suggestion.taskTitle,
        reason: 'This deliverable has no current owner and the evidence is too ambiguous to auto-recommend one.',
        linkedTaskIds: [suggestion.taskId],
        linkedTaskTitles: [suggestion.taskTitle],
        suggestedOwnerIds: [],
        suggestedOwnerNames: [],
      });
      continue;
    }

    coverageGaps.push({
      id: `deliverable:${suggestion.taskId}`,
      gapType: 'deliverable',
      label: suggestion.taskTitle,
      reason: 'This deliverable is still missing an accepted owner.',
      linkedTaskIds: [suggestion.taskId],
      linkedTaskTitles: [suggestion.taskTitle],
      suggestedOwnerIds: suggestion.recommendedOwnerId ? [suggestion.recommendedOwnerId] : [],
      suggestedOwnerNames: suggestion.recommendedOwnerName ? [suggestion.recommendedOwnerName] : [],
    });
  }

  const personQueues: PersonQueue[] = source.members.map((member) => {
    const memberSuggestions = suggestions.filter((suggestion) =>
      suggestion.recommendedOwnerId === member.userId || suggestion.suggestedCollaboratorIds.includes(member.userId),
    );

    const assignedGoals = source.goals.filter((goal) => isGoalOpen(goal) && getGoalAssigneeIds(goal).includes(member.userId));
    const queueItems: QueueItem[] = [];

    for (const goal of assignedGoals) {
      const blockers = blockedTaskPairs.filter((pair) => pair.taskId === goal.id).map((pair) => goalMap.get(pair.blockerId)?.title ?? null).filter(Boolean);
      const priorityScore = (blockedTaskIds.has(goal.id) ? 9 : 0) + getUrgency(goal, now, (reverseDependencyMap.get(goal.id) ?? []).length).score * 3;
      queueItems.push({
        taskId: goal.id,
        taskTitle: goal.title,
        kind: 'assigned',
        priority: scoreToPriority(priorityScore),
        dueDate: goal.deadline,
        status: goal.status,
        reason: createQueueReason('assigned', null, blockers[0] ?? null, goal),
        confidence: 1,
        blockedByTaskId: blockedTaskPairs.find((pair) => pair.taskId === goal.id)?.blockerId ?? null,
        blockedByTaskTitle: blockers[0] ?? null,
        suggestedAction: createSuggestedAction('assigned', blockers[0] ?? null, goal),
      });
    }

    for (const suggestion of memberSuggestions) {
      if (queueItems.some((item) => item.taskId === suggestion.taskId && item.kind === 'assigned')) continue;
      const goal = goalMap.get(suggestion.taskId);
      if (!goal) continue;
      const kind: QueueItem['kind'] = suggestion.recommendedOwnerId === member.userId ? 'suggested_owner' : 'suggested_collaborator';
      const blockerPair = blockedTaskPairs.find((pair) => pair.taskId === goal.id);
      const blockerTitle = blockerPair ? goalMap.get(blockerPair.blockerId)?.title ?? null : null;
      const priorityBase = kind === 'suggested_owner' ? 8 : 5;
      const urgency = getUrgency(goal, now, (reverseDependencyMap.get(goal.id) ?? []).length);
      queueItems.push({
        taskId: goal.id,
        taskTitle: goal.title,
        kind,
        priority: scoreToPriority(priorityBase + urgency.score * 3),
        dueDate: goal.deadline,
        status: goal.status,
        reason: createQueueReason(kind, suggestion, blockerTitle, goal),
        confidence: suggestion.confidence,
        blockedByTaskId: blockerPair?.blockerId ?? null,
        blockedByTaskTitle: blockerTitle,
        suggestedAction: createSuggestedAction(kind, blockerTitle, goal),
      });
    }

    queueItems.sort((a, b) => {
      const priorityRank: Record<QueuePriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityRank[b.priority] - priorityRank[a.priority] || b.confidence - a.confidence || a.taskTitle.localeCompare(b.taskTitle);
    });

    return {
      userId: member.userId,
      displayName: member.displayName,
      role: member.role,
      totalOpenTasks: workload.byUser.get(member.userId)?.activeTasks ?? 0,
      totalBlockedTasks: workload.byUser.get(member.userId)?.blockedTasks ?? 0,
      recentHours: roundNumber(recentHoursByUser.get(member.userId) ?? 0),
      items: queueItems.slice(0, 8),
    };
  }).sort((a, b) => b.items.length - a.items.length || a.displayName.localeCompare(b.displayName));

  const heavyLoadCount = workloadPeople.filter((person) => person.capacityStatus === 'heavy').length;
  const teamOwnerSuggestions = suggestions.filter((suggestion) => suggestion.recommendedOwnerId && suggestion.recommendedOwnerId !== suggestion.currentOwnerId).slice(0, 12);
  const snapshot: CoordinationSnapshotData = {
    projectId,
    generatedAt,
    teamCoordination: {
      summary: [
        `${source.goals.filter(isGoalOpen).length} open tasks are being coordinated across the project.`,
        `${needsOwner.length} open tasks still need an accepted owner.`,
        `${blockedHandoffs.length} handoffs are currently blocked by incomplete dependencies.`,
        `${heavyLoadCount} team ${heavyLoadCount === 1 ? 'member is' : 'members are'} above the balanced workload range.`,
      ],
      metrics: [
        { label: 'Open Tasks', value: source.goals.filter(isGoalOpen).length, tone: 'normal' },
        { label: 'Needs Owner', value: needsOwner.length, tone: needsOwner.length ? 'warning' : 'positive' },
        { label: 'Blocked Handoffs', value: blockedHandoffs.length, tone: blockedHandoffs.length ? 'critical' : 'positive' },
        { label: 'Heavy Load', value: heavyLoadCount, tone: heavyLoadCount ? 'warning' : 'positive' },
      ],
      ownerSuggestions: teamOwnerSuggestions,
      suggestedResponsibilities: [],
    },
    needsOwner: needsOwner.slice(0, 16),
    blockedHandoffs: blockedHandoffs.slice(0, 16),
    workloadBalance: {
      averageActiveTasks: workload.averageActiveTasks,
      averageRecentHours: workload.averageRecentHours,
      people: workloadPeople,
    },
    knowledgeCoverage: {
      coveredConcepts: knowledgeCoverageEntries,
      gaps: coverageGaps.slice(0, 16),
    },
    contributionProfiles,
    personQueues,
    ownerSuggestions: suggestions,
    graphStats: createEmptyGraphStats(),
    graphInference: createGraphInferenceSummary(),
  };

  const graphData = buildGraphData({
    projectId,
    members: source.members,
    goals: source.goals,
    documents: source.documents,
    repoRefs: repoRefs.map((repo) => ({ ...repo, concepts: repoConcepts.get(repo.id) ?? [] })),
    conceptRegistry,
    taskConcepts,
    documentConcepts,
    personConceptScores,
    taskParticipants,
    collaborationScores,
    blockedTaskPairs,
  });

  const inferredGraph = await inferGraphEnhancements({
    project: source.project,
    members: source.members,
    goals: source.goals,
    documents: source.documents,
    repoRefs: repoRefs.map((repo) => ({ ...repo, concepts: repoConcepts.get(repo.id) ?? [] })),
    conceptRegistry,
    nodes: graphData.nodes,
    edges: graphData.edges,
    generatedBy,
    generatedAt,
  });

  snapshot.graphStats = computeGraphStats(inferredGraph.nodes, inferredGraph.edges);
  snapshot.graphInference = inferredGraph.inference;
  return {
    snapshot,
    nodes: inferredGraph.nodes,
    edges: inferredGraph.edges,
  };
}

async function insertChunked(table: 'project_graph_nodes' | 'project_graph_edges', rows: Array<Record<string, unknown>>, size = 250): Promise<void> {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    const { error } = await supabase.from(table).insert(chunk as never[]);
    if (error) throw error;
  }
}

async function loadStoredSnapshot(projectId: string): Promise<StoredSnapshotRow | null> {
  const { data, error } = await supabase
    .from('project_coordination_snapshots')
    .select('project_id, snapshot, graph_stats, generated_at, is_stale')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    if (isMissingCoordinationStorageError(error)) return null;
    throw error;
  }
  if (!data) return null;

  return {
    project_id: data.project_id as string,
    snapshot: isStoredSnapshotData(data.snapshot) ? data.snapshot : null,
    graph_stats: asRecord(data.graph_stats) as Partial<GraphStats> | null,
    generated_at: data.generated_at as string,
    is_stale: Boolean(data.is_stale),
  };
}

async function loadStoredGraph(projectId: string, storedSnapshot: StoredSnapshotRow | null): Promise<StoredGraphRow | null> {
  try {
    const [nodesRes, edgesRes] = await Promise.all([
      supabase
        .from('project_graph_nodes')
        .select('id, project_id, node_type, external_id, label, metadata')
        .eq('project_id', projectId),
      supabase
        .from('project_graph_edges')
        .select('id, project_id, edge_type, from_node_id, to_node_id, weight, metadata')
        .eq('project_id', projectId),
    ]);

    if (nodesRes.error) {
      if (isMissingCoordinationStorageError(nodesRes.error)) return null;
      throw nodesRes.error;
    }
    if (edgesRes.error) {
      if (isMissingCoordinationStorageError(edgesRes.error)) return null;
      throw edgesRes.error;
    }

    return {
      generatedAt: storedSnapshot?.generated_at ?? '',
      stale: Boolean(storedSnapshot?.is_stale),
      nodes: (nodesRes.data ?? []) as GraphNodeRecord[],
      edges: (edgesRes.data ?? []) as GraphEdgeRecord[],
    };
  } catch (error) {
    if (isMissingCoordinationStorageError(error as SupabaseErrorLike)) return null;
    throw error;
  }
}

export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess> {
  const [projectRes, membershipRes] = await Promise.all([
    supabase.from('projects').select('owner_id').eq('id', projectId).maybeSingle(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
  ]);

  const ownerId = readString(projectRes.data?.owner_id);
  const memberRole = readString(membershipRes.data?.role);
  const isOwner = ownerId === userId || memberRole === 'owner';
  return {
    allowed: isOwner || !!memberRole,
    isOwner,
    memberRole,
    projectOwnerId: ownerId,
  };
}

export async function getCoordinationSnapshotForViewer(projectId: string, viewerUserId: string, viewerRole: ViewerRole): Promise<CoordinationSnapshot> {
  const stored = await loadStoredSnapshot(projectId);
  if (!stored?.snapshot) return materializeCoordinationSnapshotForViewer(projectId, stored, viewerUserId, viewerRole);

  const activeUserIds = await loadCurrentProjectUserIds(projectId);
  return materializeCoordinationSnapshotForViewer(projectId, {
    ...stored,
    snapshot: sanitizeSnapshotForActiveMembers(stored.snapshot, activeUserIds),
  }, viewerUserId, viewerRole);
}

export async function getCoordinationBundleForViewer(projectId: string, viewerUserId: string, viewerRole: ViewerRole): Promise<CoordinationBundle> {
  const stored = await loadStoredSnapshot(projectId);
  const activeUserIds = stored?.snapshot ? await loadCurrentProjectUserIds(projectId) : null;
  const sanitizedStored = stored?.snapshot && activeUserIds
    ? {
      ...stored,
      snapshot: sanitizeSnapshotForActiveMembers(stored.snapshot, activeUserIds),
    }
    : stored;
  const snapshot = materializeCoordinationSnapshotForViewer(projectId, sanitizedStored, viewerUserId, viewerRole);
  const storedGraph = await loadStoredGraph(projectId, stored);
  const sanitizedGraph = storedGraph && activeUserIds ? sanitizeStoredGraphForActiveMembers(storedGraph, activeUserIds) : storedGraph;
  if (sanitizedGraph) {
    snapshot.graphStats = computeGraphStats(sanitizedGraph.nodes, sanitizedGraph.edges);
  }
  return {
    snapshot,
    graph: sanitizedGraph
      ? createCoordinationGraph(sanitizedGraph.generatedAt, sanitizedGraph.stale, sanitizedGraph.nodes, sanitizedGraph.edges, snapshot.graphInference)
      : createCoordinationGraph(stored?.generated_at ?? snapshot.generatedAt, snapshot.stale, [], [], snapshot.graphInference),
  };
}

export async function recomputeProjectCoordination(projectId: string, generatedBy: string | null): Promise<{ stored: StoredSnapshotRow; graph: CoordinationGraph }> {
  const { snapshot, nodes, edges } = await buildSnapshot(projectId, generatedBy);
  const graph = createCoordinationGraph(snapshot.generatedAt, false, nodes, edges, snapshot.graphInference);

  const row = {
    project_id: projectId,
    generated_by: generatedBy,
    snapshot,
    graph_stats: snapshot.graphStats,
    generated_at: snapshot.generatedAt,
    is_stale: false,
  };

  try {
    const { error: deleteEdgesError } = await supabase.from('project_graph_edges').delete().eq('project_id', projectId);
    if (deleteEdgesError) throw deleteEdgesError;

    const { error: deleteNodesError } = await supabase.from('project_graph_nodes').delete().eq('project_id', projectId);
    if (deleteNodesError) throw deleteNodesError;

    if (nodes.length > 0) await insertChunked('project_graph_nodes', nodes as unknown as Array<Record<string, unknown>>);
    if (edges.length > 0) await insertChunked('project_graph_edges', edges as unknown as Array<Record<string, unknown>>);

    const { data, error } = await supabase
      .from('project_coordination_snapshots')
      .upsert(row, { onConflict: 'project_id' })
      .select('project_id, snapshot, graph_stats, generated_at, is_stale')
      .single();

    if (error || !data) throw error ?? new Error('Failed to store coordination snapshot');

    return {
      stored: {
        project_id: data.project_id as string,
        snapshot: isStoredSnapshotData(data.snapshot) ? data.snapshot : snapshot,
        graph_stats: asRecord(data.graph_stats) as Partial<GraphStats> | null,
        generated_at: data.generated_at as string,
        is_stale: Boolean(data.is_stale),
      },
      graph: {
        ...graph,
        generatedAt: data.generated_at as string,
        stale: Boolean(data.is_stale),
      },
    };
  } catch (error) {
    if (!isMissingCoordinationStorageError(error as SupabaseErrorLike)) throw error;

    return {
      stored: {
        project_id: row.project_id,
        snapshot,
        graph_stats: row.graph_stats,
        generated_at: row.generated_at,
        is_stale: false,
      },
      graph,
    };
  }
}

export function resolveAcceptedSuggestion(snapshot: CoordinationSnapshotData, taskId: string): TaskOwnerSuggestion | null {
  return snapshot.ownerSuggestions.find((suggestion) => suggestion.taskId === taskId) ?? null;
}

export function startNightlyCoordinationRebuild(logger: Pick<FastifyBaseLogger, 'info' | 'error' | 'warn'>): void {
  if (process.env.COORDINATION_NIGHTLY_REBUILD === 'false') {
    logger.info('Nightly coordination rebuild disabled by COORDINATION_NIGHTLY_REBUILD=false');
    return;
  }

  const scheduleNextRun = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(2, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);

    const delay = next.getTime() - now.getTime();
    const timer = setTimeout(async () => {
      try {
        logger.info('Starting nightly coordination snapshot rebuild');
        const { data: projects, error } = await supabase.from('projects').select('id');
        if (error) throw error;

        for (const project of projects ?? []) {
          const projectId = readString((project as JsonMap).id);
          if (!projectId) continue;
          try {
            await recomputeProjectCoordination(projectId, null);
          } catch (projectError) {
            logger.error({ projectId, err: projectError }, 'Failed nightly coordination rebuild for project');
          }
        }

        logger.info({ projectCount: projects?.length ?? 0 }, 'Nightly coordination snapshot rebuild complete');
      } catch (err) {
        logger.error({ err }, 'Nightly coordination snapshot rebuild failed');
      } finally {
        scheduleNextRun();
      }
    }, delay);

    if (typeof timer.unref === 'function') timer.unref();
    logger.info({ nextRunAt: next.toISOString() }, 'Scheduled nightly coordination snapshot rebuild');
  };

  scheduleNextRun();
}
