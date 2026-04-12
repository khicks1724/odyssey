import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  AlertTriangle,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Scale,
  Search,
  Share2,
  Target,
  Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  CoordinationBundle,
  CoordinationGraph,
  CoordinationGraphEdge,
  CoordinationGraphNode,
  ContributionProfile,
  CoordinationSnapshot,
  PersonQueue,
} from '../../types';

const API_BASE = '/api';

interface CoordinationTabProps {
  projectId: string;
  isOwner: boolean;
}

type WorkloadPerson = CoordinationSnapshot['workloadBalance']['people'][number];

const GRAPH_TYPE_ORDER = ['person', 'task', 'deliverable', 'concept', 'document', 'repo', 'file'] as const;
const GRAPH_TYPE_LABELS: Record<string, string> = {
  person: 'People',
  task: 'Tasks',
  deliverable: 'Deliverables',
  concept: 'Concepts',
  document: 'Documents',
  repo: 'Repos',
  file: 'Files',
};
const GRAPH_TYPE_COLORS: Record<string, string> = {
  person: '#6fb7ff',
  task: '#7ce3b2',
  deliverable: '#f5c66a',
  concept: '#f08ca0',
  document: '#b9a1ff',
  repo: '#8bd0f6',
  file: '#8b95a7',
};
const GRAPH_VIEWBOX = { width: 1200, height: 560 };
const GRAPH_INFOBOX = {
  minWidth: 260,
  maxWidth: 420,
  minHeight: 72,
  lineHeight: 18,
  charsPerLine: 30,
  headerHeight: 22,
  paddingY: 22,
};
const CONTRIBUTION_CHART = {
  size: 152,
  radius: 50,
  innerRadius: 22,
};
const CONTRIBUTION_SLICE_COLORS = ['#6fb7ff', '#7ce3b2', '#f5c66a', '#f08ca0', '#b9a1ff', '#8bd0f6'];

type VisibleGraphNode = CoordinationGraphNode & {
  degree: number;
  x: number;
  y: number;
  radius: number;
  dimmed: boolean;
  matched: boolean;
  displayLabel: string;
  showCard: boolean;
  cardWidth: number;
  cardHeight: number;
};

type KnowledgeGraphStyle = 'odyssey' | 'rowboat';

type GraphClusterAnchor = {
  nodeType: string;
  x: number;
  y: number;
  radius: number;
};

function formatDateTime(value: string): string {
  if (!value) return 'Not generated yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function formatDueDate(value: string | null): string {
  if (!value) return 'No deadline';
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(parsed);
}

function clampGraphCoordinate(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function estimateWrappedLineCount(text: string, charsPerLine: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  let lines = 1;
  let currentLength = 0;

  for (const word of words) {
    const wordLength = word.length;
    if (wordLength >= charsPerLine) {
      if (currentLength > 0) {
        lines += 1;
        currentLength = 0;
      }
      lines += Math.ceil(wordLength / charsPerLine) - 1;
      currentLength = wordLength % charsPerLine;
      continue;
    }

    const nextLength = currentLength === 0 ? wordLength : currentLength + 1 + wordLength;
    if (nextLength > charsPerLine) {
      lines += 1;
      currentLength = wordLength;
    } else {
      currentLength = nextLength;
    }
  }

  return lines;
}

function getGraphInfoBoxSize(label: string): { width: number; height: number } {
  const normalized = label.trim();
  const longestToken = normalized.split(/\s+/).reduce((max, token) => Math.max(max, token.length), 0);
  const preferredWidth = normalized.length > 84
    ? GRAPH_INFOBOX.maxWidth
    : normalized.length > 56 || longestToken > 24
      ? 360
      : normalized.length > 32
        ? 320
        : GRAPH_INFOBOX.minWidth;
  const width = clampGraphCoordinate(preferredWidth, GRAPH_INFOBOX.minWidth, GRAPH_INFOBOX.maxWidth);
  const widthScale = width / GRAPH_INFOBOX.maxWidth;
  const effectiveCharsPerLine = Math.max(18, Math.round(GRAPH_INFOBOX.charsPerLine * widthScale));
  const lineCount = estimateWrappedLineCount(normalized, effectiveCharsPerLine);
  const height = Math.max(
    GRAPH_INFOBOX.minHeight,
    GRAPH_INFOBOX.headerHeight + GRAPH_INFOBOX.paddingY + lineCount * GRAPH_INFOBOX.lineHeight,
  );
  return { width, height };
}

function getGraphInfoBoxPosition(
  node: { x: number; y: number; radius: number },
  box: { width: number; height: number },
): { x: number; y: number } {
  const verticalGap = 16;
  const horizontalPadding = 12;
  const topY = node.y - node.radius - box.height - verticalGap;
  const bottomY = node.y + node.radius + verticalGap;
  const prefersTop = topY >= 12 || bottomY + box.height > GRAPH_VIEWBOX.height - 12;

  return {
    x: clampGraphCoordinate(node.x - box.width / 2, horizontalPadding, GRAPH_VIEWBOX.width - box.width - horizontalPadding),
    y: clampGraphCoordinate(
      prefersTop ? topY : bottomY,
      12,
      GRAPH_VIEWBOX.height - box.height - 12,
    ),
  };
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeDonutSlice(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

function getSliceMidpoint(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) {
  return polarToCartesian(centerX, centerY, radius, (startAngle + endAngle) / 2);
}

function priorityClasses(priority: PersonQueue['items'][number]['priority']): string {
  switch (priority) {
    case 'critical':
      return 'border-danger/40 bg-danger/10 text-danger';
    case 'high':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    case 'medium':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
    default:
      return 'border-border bg-surface2 text-muted';
  }
}

function workloadClasses(state: ContributionProfile['role'] | string): string {
  if (state === 'heavy') return 'text-danger';
  if (state === 'light') return 'text-emerald-200';
  if (state === 'balanced') return 'text-heading';
  return 'text-muted';
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  const Icon = icon;
  return (
    <section className="border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-accent" />
          <h2 className="text-sm font-semibold text-heading">{title}</h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

function getSummaryTone(text: string): 'bad' | 'neutral' | 'good' {
  const count = Number(text.match(/\d+/)?.[0] ?? 0);
  if (/above the balanced workload range/i.test(text)) return count > 0 ? 'bad' : 'good';
  if (/blocked/i.test(text) || /incomplete dependencies/i.test(text)) return count > 0 ? 'bad' : 'good';
  if (/accepted owner/i.test(text) || /need an accepted owner/i.test(text)) return count > 0 ? 'bad' : 'good';
  return 'neutral';
}

function summaryToneClasses(tone: 'bad' | 'neutral' | 'good'): {
  row: string;
  badge: string;
} {
  switch (tone) {
    case 'bad':
      return {
        row: 'border-danger/25 bg-danger/6',
        badge: 'border-danger/35 bg-danger/10 text-heading',
      };
    case 'good':
      return {
        row: 'border-emerald-500/25 bg-emerald-500/6',
        badge: 'border-emerald-500/35 bg-emerald-500/10 text-heading',
      };
    default:
      return {
        row: 'border-accent/20 bg-accent/5',
        badge: 'border-accent/30 bg-accent/10 text-heading',
      };
  }
}

function SummaryLine({ text }: { text: string }) {
  const tone = getSummaryTone(text);
  const classes = summaryToneClasses(tone);
  const count = text.match(/^\d+/)?.[0] ?? null;

  return (
    <div className={`flex items-start gap-3 border px-4 py-3 ${classes.row}`}>
      {count ? (
        <span className={`inline-flex min-w-9 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${classes.badge}`}>
          {count}
        </span>
      ) : (
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${tone === 'bad' ? 'bg-danger/60' : tone === 'good' ? 'bg-emerald-300/70' : 'bg-accent/60'}`} />
      )}
      <p className="text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}

function QueueCard({ queue }: { queue: PersonQueue | null }) {
  const itemListRef = useRef<HTMLDivElement | null>(null);
  const [visibleListHeight, setVisibleListHeight] = useState<number | null>(null);

  useEffect(() => {
    const container = itemListRef.current;
    if (!container || !queue || queue.items.length <= 3) {
      setVisibleListHeight(null);
      return;
    }

    const updateVisibleListHeight = () => {
      const items = Array.from(container.children).slice(0, 3) as HTMLDivElement[];
      if (!items.length) {
        setVisibleListHeight(null);
        return;
      }

      const styles = window.getComputedStyle(container);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
      const totalHeight = items.reduce((sum, item) => sum + item.offsetHeight, 0) + gap * (items.length - 1);
      setVisibleListHeight(totalHeight);
    };

    updateVisibleListHeight();

    const resizeObserver = new ResizeObserver(updateVisibleListHeight);
    resizeObserver.observe(container);
    Array.from(container.children).slice(0, 3).forEach((item) => resizeObserver.observe(item));

    return () => {
      resizeObserver.disconnect();
    };
  }, [queue]);

  if (!queue || queue.items.length === 0) {
    return <EmptyState text="No queued coordination actions yet." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded-full border border-border bg-surface2 px-3 py-1">
          {queue.totalOpenTasks} open tasks
        </span>
        <span className="rounded-full border border-border bg-surface2 px-3 py-1">
          {queue.totalBlockedTasks} blocked
        </span>
        <span className="rounded-full border border-border bg-surface2 px-3 py-1">
          {queue.recentHours}h logged recently
        </span>
      </div>

      <div
        ref={itemListRef}
        className={queue.items.length > 3 ? 'space-y-3 overflow-y-auto pr-1' : 'space-y-3'}
        style={queue.items.length > 3 && visibleListHeight ? { maxHeight: `${visibleListHeight}px` } : undefined}
      >
        {queue.items.map((item) => (
          <div key={`${item.kind}-${item.taskId}`} className="border border-border bg-surface2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-heading">{item.taskTitle}</p>
                <p className="mt-1 text-xs text-muted">{item.reason}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${priorityClasses(item.priority)}`}>
                  {item.priority}
                </span>
                <span className="rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-muted">
                  {item.kind.replace('_', ' ')}
                </span>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-muted md:grid-cols-2">
              <p>Due: <span className="text-heading">{formatDueDate(item.dueDate)}</span></p>
              <p>Status: <span className="text-heading">{item.status.replaceAll('_', ' ')}</span></p>
              {item.blockedByTaskTitle && (
                <p className="md:col-span-2">
                  Blocked by: <span className="text-heading">{item.blockedByTaskTitle}</span>
                </p>
              )}
            </div>

            <p className="mt-3 text-xs text-accent">{item.suggestedAction}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributionCard({ profile, workload }: { profile: ContributionProfile; workload?: WorkloadPerson | null }) {
  const [hoveredConceptIndex, setHoveredConceptIndex] = useState<number | null>(null);
  const totalConceptWeight = profile.topConcepts.reduce((sum, concept) => sum + concept.score, 0);
  const conceptSlices = profile.topConcepts.map((concept, index) => {
    const previousWeight = profile.topConcepts.slice(0, index).reduce((sum, entry) => sum + entry.score, 0);
    const startAngle = totalConceptWeight > 0 ? (previousWeight / totalConceptWeight) * 360 : 0;
    const endAngle = totalConceptWeight > 0 ? ((previousWeight + concept.score) / totalConceptWeight) * 360 : 0;
    const midpoint = getSliceMidpoint(
      CONTRIBUTION_CHART.size / 2,
      CONTRIBUTION_CHART.size / 2,
      (CONTRIBUTION_CHART.radius + CONTRIBUTION_CHART.innerRadius) / 2,
      startAngle,
      endAngle,
    );
    const share = totalConceptWeight > 0 ? (concept.score / totalConceptWeight) * 100 : 0;

    return {
      concept,
      color: CONTRIBUTION_SLICE_COLORS[index % CONTRIBUTION_SLICE_COLORS.length],
      path: describeDonutSlice(
        CONTRIBUTION_CHART.size / 2,
        CONTRIBUTION_CHART.size / 2,
        CONTRIBUTION_CHART.radius,
        CONTRIBUTION_CHART.innerRadius,
        startAngle,
        endAngle,
      ),
      share,
    };
  });
  const hoveredConcept = hoveredConceptIndex !== null ? conceptSlices[hoveredConceptIndex] ?? null : null;
  const statusLabel = workload?.capacityStatus?.toUpperCase() ?? 'BALANCED';
  const statusClasses = workloadClasses(workload?.capacityStatus ?? 'balanced');

  return (
    <div className="border border-border bg-surface2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">{profile.displayName}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">{profile.role}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
            <p>Active: <span className="text-heading">{workload?.activeTasks ?? profile.activeTasks}</span></p>
            <p>Blocked: <span className="text-heading">{workload?.blockedTasks ?? 0}</span></p>
            <p>Overdue: <span className="text-heading">{workload?.overdueTasks ?? 0}</span></p>
            <p>Recent hours: <span className="text-heading">{workload?.recentHours ?? profile.recentHours}</span></p>
            <p>Completed: <span className="text-heading">{profile.completedTasks}</span></p>
            <p>Collaborators: <span className="text-heading">{profile.collaborationCount}</span></p>
          </div>
        </div>
        <div className="ml-auto text-right text-xs text-muted">
          <p className={`text-xs uppercase tracking-[0.18em] ${statusClasses}`}>{statusLabel}</p>
          <p className="mt-2">Load score: <span className="text-heading">{workload?.loadScore ?? 0}</span></p>
        </div>
      </div>

      {conceptSlices.length > 0 && (
        <div className="mt-4 flex items-start gap-4">
          <div className="relative shrink-0">
            <svg
              viewBox={`0 0 ${CONTRIBUTION_CHART.size} ${CONTRIBUTION_CHART.size}`}
              className="h-36 w-36 overflow-visible"
            >
              <circle
                cx={CONTRIBUTION_CHART.size / 2}
                cy={CONTRIBUTION_CHART.size / 2}
                r={CONTRIBUTION_CHART.radius}
                style={{
                  fill: 'color-mix(in srgb, var(--color-surface2) 80%, var(--color-accent2) 20%)',
                  stroke: 'color-mix(in srgb, var(--color-border) 72%, var(--color-accent) 28%)',
                }}
                strokeWidth={CONTRIBUTION_CHART.radius - CONTRIBUTION_CHART.innerRadius}
              />
              {conceptSlices.map((slice, index) => (
                <path
                  key={`${profile.userId}-${slice.concept.label}`}
                  d={slice.path}
                  fill={slice.color}
                  opacity={hoveredConceptIndex === null || hoveredConceptIndex === index ? 0.94 : 0.35}
                  stroke={hoveredConceptIndex === index ? 'rgba(248, 250, 252, 0.95)' : 'rgba(15, 23, 42, 0.55)'}
                  strokeWidth={hoveredConceptIndex === index ? 2.2 : 1.2}
                  onMouseEnter={() => setHoveredConceptIndex(index)}
                  onMouseLeave={() => setHoveredConceptIndex((current) => (current === index ? null : current))}
                />
              ))}
              <circle
                cx={CONTRIBUTION_CHART.size / 2}
                cy={CONTRIBUTION_CHART.size / 2}
                r={CONTRIBUTION_CHART.innerRadius - 1}
                style={{
                  fill: 'color-mix(in srgb, var(--color-surface) 88%, var(--color-accent2) 12%)',
                  stroke: 'color-mix(in srgb, var(--color-border) 58%, var(--color-accent2) 42%)',
                }}
                strokeWidth="1"
              />
              <text
                x={CONTRIBUTION_CHART.size / 2}
                y={CONTRIBUTION_CHART.size / 2 - 2}
                textAnchor="middle"
                fill="#f8fafc"
                fontSize="15"
                fontWeight="700"
              >
                {profile.topConcepts.length}
              </text>
              <text
                x={CONTRIBUTION_CHART.size / 2}
                y={CONTRIBUTION_CHART.size / 2 + 12}
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.9)"
                fontSize="8"
                letterSpacing="1.6"
              >
                TERMS
              </text>
            </svg>

          </div>

          <div className="min-w-0 flex-1 space-y-1.5 pt-1">
            {conceptSlices.map((slice, index) => (
              <div
                key={`${profile.userId}-legend-${slice.concept.label}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] transition-colors ${
                  hoveredConceptIndex === index ? 'border-accent/35 bg-surface text-heading' : 'border-border/70 bg-surface/55 text-muted'
                }`}
                onMouseEnter={() => setHoveredConceptIndex(index)}
                onMouseLeave={() => setHoveredConceptIndex((current) => (current === index ? null : current))}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 flex-1 truncate uppercase tracking-[0.14em]">{slice.concept.label}</span>
                <span className="text-heading">{slice.concept.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildDegreeMap(graph: CoordinationGraph | null, showInferred: boolean): Map<string, number> {
  const degreeMap = new Map<string, number>();
  const inferredEdgeIds = new Set(graph?.inferredEdgeIds ?? []);
  for (const edge of graph?.edges ?? []) {
    if (!showInferred && inferredEdgeIds.has(edge.id)) continue;
    degreeMap.set(edge.fromNodeId, (degreeMap.get(edge.fromNodeId) ?? 0) + 1);
    degreeMap.set(edge.toNodeId, (degreeMap.get(edge.toNodeId) ?? 0) + 1);
  }
  return degreeMap;
}

function getSharedPrefix(values: string[]): string {
  if (values.length < 2) return '';

  let prefix = values[0] ?? '';
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix) break;
  }

  return prefix.replace(/[-_/.:\\\s]+$/, '');
}

function trimRepoLabel(label: string, sharedPrefix: string): string {
  if (!sharedPrefix) return label;
  const trimmed = label.slice(sharedPrefix.length).replace(/^[-_/.:\\\s]+/, '').trim();
  return trimmed || label;
}

function getGraphNodeCardWidth(label: string) {
  return Math.min(190, Math.max(118, 84 + label.length * 3.1));
}

function hashGraphString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function buildRowboatLayout(
  nodes: VisibleGraphNode[],
  edges: CoordinationGraphEdge[],
  focusNodeId: string | null,
  selectedNodeId: string | null,
): {
  nodes: VisibleGraphNode[];
  edges: CoordinationGraphEdge[];
  anchors: GraphClusterAnchor[];
} {
  const centerX = GRAPH_VIEWBOX.width / 2 - 12;
  const centerY = GRAPH_VIEWBOX.height / 2 + 6;
  const anchorRadiusX = GRAPH_VIEWBOX.width * 0.4;
  const anchorRadiusY = GRAPH_VIEWBOX.height * 0.3;
  const anchors = GRAPH_TYPE_ORDER.map((nodeType, index) => {
    const angle = ((Math.PI * 2) / GRAPH_TYPE_ORDER.length) * index - Math.PI / 2;
    return {
      nodeType,
      x: centerX + Math.cos(angle) * anchorRadiusX,
      y: centerY + Math.sin(angle) * anchorRadiusY,
      radius: 40,
    };
  });
  const anchorByType = new Map(anchors.map((anchor) => [anchor.nodeType, anchor]));
  const positioned = new Map<string, { x: number; y: number }>();
  const focusNeighborIds = new Set<string>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const topRankedNodes = [...nodes]
    .sort((left, right) => {
      const leftMatched = left.matched ? 1 : 0;
      const rightMatched = right.matched ? 1 : 0;
      if (rightMatched !== leftMatched) return rightMatched - leftMatched;
      if (right.degree !== left.degree) return right.degree - left.degree;
      return left.label.localeCompare(right.label);
    });

  const activeFocusId = focusNodeId && nodeMap.has(focusNodeId)
    ? focusNodeId
    : topRankedNodes[0]?.id ?? null;

  if (activeFocusId && nodeMap.has(activeFocusId)) {
    positioned.set(activeFocusId, { x: centerX, y: centerY });
    const neighbors = edges
      .filter((edge) => edge.fromNodeId === activeFocusId || edge.toNodeId === activeFocusId)
      .map((edge) => (edge.fromNodeId === activeFocusId ? edge.toNodeId : edge.fromNodeId))
      .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter((node): node is VisibleGraphNode => Boolean(node))
      .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label));

    neighbors.forEach((node, index) => {
      focusNeighborIds.add(node.id);
      const typeIndex = Math.max(0, GRAPH_TYPE_ORDER.indexOf(node.nodeType as typeof GRAPH_TYPE_ORDER[number]));
      const anchorAngle = ((Math.PI * 2) / GRAPH_TYPE_ORDER.length) * typeIndex - Math.PI / 2;
      const localAngle = anchorAngle + (((index % 4) - 1.5) * 0.22);
      const ring = Math.floor(index / 4);
      positioned.set(node.id, {
        x: clampGraphCoordinate(centerX + Math.cos(localAngle) * (150 + ring * 52), 78, GRAPH_VIEWBOX.width - 78),
        y: clampGraphCoordinate(centerY + Math.sin(localAngle) * (118 + ring * 46), 78, GRAPH_VIEWBOX.height - 78),
      });
    });
  }

  const nodesByType = new Map<string, VisibleGraphNode[]>();
  for (const nodeType of GRAPH_TYPE_ORDER) nodesByType.set(nodeType, []);
  nodes.forEach((node) => {
    if (!positioned.has(node.id)) {
      const bucket = nodesByType.get(node.nodeType) ?? [];
      bucket.push(node);
      nodesByType.set(node.nodeType, bucket);
    }
  });

  for (const nodeType of GRAPH_TYPE_ORDER) {
    const anchor = anchorByType.get(nodeType);
    if (!anchor) continue;

    const bucket = [...(nodesByType.get(nodeType) ?? [])].sort((left, right) => {
      const leftMatched = left.matched ? 1 : 0;
      const rightMatched = right.matched ? 1 : 0;
      if (rightMatched !== leftMatched) return rightMatched - leftMatched;
      if (right.degree !== left.degree) return right.degree - left.degree;
      return left.label.localeCompare(right.label);
    });

    bucket.forEach((node, index) => {
      const ring = Math.floor(index / 7);
      const slot = index % 7;
      const angleSeed = hashGraphString(`${node.nodeType}:${node.id}`) % 360;
      const angle = (Math.PI * 2 * slot) / 7 + (angleSeed * Math.PI) / 180 / 6 + ring * 0.18;
      const spreadX = 56 + ring * 52;
      const spreadY = 42 + ring * 40;
      positioned.set(node.id, {
        x: clampGraphCoordinate(anchor.x + Math.cos(angle) * spreadX, 64, GRAPH_VIEWBOX.width - 64),
        y: clampGraphCoordinate(anchor.y + Math.sin(angle) * spreadY, 64, GRAPH_VIEWBOX.height - 64),
      });
    });
  }

  const laidOutNodes = nodes.map((node) => {
    const position = positioned.get(node.id) ?? { x: node.x, y: node.y };
    const emphasized = node.id === selectedNodeId || node.id === activeFocusId || focusNeighborIds.has(node.id) || node.matched;
    const shouldShowCard = node.id === activeFocusId
      || node.id === selectedNodeId
      || node.matched
      || focusNeighborIds.has(node.id)
      || (node.degree >= 11 && (node.nodeType === 'person' || node.nodeType === 'repo' || node.nodeType === 'document'));

    return {
      ...node,
      x: position.x,
      y: position.y,
      radius: emphasized ? Math.min(node.radius + 1.5, 20) : node.radius,
      showCard: shouldShowCard,
      cardWidth: shouldShowCard ? Math.min((emphasized ? node.cardWidth + 10 : node.cardWidth), 208) : node.cardWidth,
      cardHeight: emphasized ? node.cardHeight + 2 : node.cardHeight,
    };
  });

  const renderedEdgeIds = new Set<string>();
  const filteredEdges = edges.filter((edge) => {
    const from = nodeMap.get(edge.fromNodeId);
    const to = nodeMap.get(edge.toNodeId);
    if (!from || !to) return false;

    const touchesFocus = edge.fromNodeId === activeFocusId || edge.toNodeId === activeFocusId;
    const touchesFocusNeighbor = focusNeighborIds.has(edge.fromNodeId) || focusNeighborIds.has(edge.toNodeId);
    const touchesMatched = from.matched || to.matched;
    const strongBridge = (from.degree >= 10 && to.degree >= 8) || (to.degree >= 10 && from.degree >= 8);
    const sameTypeLocal = from.nodeType === to.nodeType && (from.degree >= 8 || to.degree >= 8);
    const keep = touchesFocus || touchesFocusNeighbor || touchesMatched || strongBridge || sameTypeLocal;
    if (!keep || renderedEdgeIds.has(edge.id)) return false;
    renderedEdgeIds.add(edge.id);
    return true;
  });

  return { nodes: laidOutNodes, edges: filteredEdges, anchors };
}

function buildCurvedGraphEdgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  highlighted: boolean,
) {
  const midpointX = (from.x + to.x) / 2;
  const midpointY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(180, length) * (highlighted ? 0.18 : 0.1);
  const controlX = midpointX + (GRAPH_VIEWBOX.width / 2 - midpointX) * 0.16 - (dy / length) * bend;
  const controlY = midpointY + (GRAPH_VIEWBOX.height / 2 - midpointY) * 0.14 + (dx / length) * bend;
  return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
}

function buildVisibleGraph(
  graph: CoordinationGraph | null,
  activeType: string,
  searchTerm: string,
  graphMode: 'overview' | 'ownership' | 'expertise' | 'deliverables',
  density: 'focused' | 'balanced' | 'expanded',
  selectedNodeId: string | null,
  showInferred: boolean,
): {
  nodes: VisibleGraphNode[];
  edges: CoordinationGraphEdge[];
} {
  if (!graph) return { nodes: [], edges: [] };

  const inferredNodeIds = new Set(graph.inferredNodeIds ?? []);
  const inferredEdgeIds = new Set(graph.inferredEdgeIds ?? []);
  const sourceNodes = showInferred ? graph.nodes : graph.nodes.filter((node) => !inferredNodeIds.has(node.id));
  const sourceEdges = showInferred ? graph.edges : graph.edges.filter((edge) => !inferredEdgeIds.has(edge.id));
  const degreeMap = buildDegreeMap({ ...graph, nodes: sourceNodes, edges: sourceEdges }, true);
  const normalizedQuery = searchTerm.trim().toLowerCase();
  const allowedEdgeTypes = graphMode === 'ownership'
    ? new Set(['owns', 'assigned_to', 'depends_on', 'blocked_by', 'contributes_to'])
    : graphMode === 'expertise'
      ? new Set(['expert_in', 'covers', 'mentions', 'derived_from'])
      : graphMode === 'deliverables'
        ? new Set(['covers', 'derived_from', 'contributes_to', 'depends_on', 'blocked_by'])
        : null;
  const densityLimit = density === 'focused' ? 24 : density === 'expanded' ? 72 : 48;

  const visibleEdgesByMode = allowedEdgeTypes
    ? sourceEdges.filter((edge) => allowedEdgeTypes.has(edge.edgeType))
    : sourceEdges;
  const graphNodesByMode = new Map<string, CoordinationGraphNode>();
  for (const node of sourceNodes) graphNodesByMode.set(node.id, node);

  const rankedNodes = [...sourceNodes]
    .map((node) => ({ node, degree: degreeMap.get(node.id) ?? 0 }))
    .sort((left, right) => right.degree - left.degree || left.node.label.localeCompare(right.node.label));

  const matchedNodeIds = new Set(
    normalizedQuery
      ? rankedNodes
        .filter(({ node }) =>
          node.label.toLowerCase().includes(normalizedQuery)
          || node.externalId.toLowerCase().includes(normalizedQuery),
        )
        .map(({ node }) => node.id)
      : [],
  );

  const visibleNodeIds = new Set<string>();
  const addNodeId = (nodeId: string) => {
    if (visibleNodeIds.size < densityLimit || visibleNodeIds.has(nodeId)) visibleNodeIds.add(nodeId);
  };

  if (selectedNodeId) addNodeId(selectedNodeId);
  for (const nodeId of matchedNodeIds) addNodeId(nodeId);
  for (const { node } of rankedNodes) {
    if (visibleNodeIds.size >= densityLimit) break;
    if (activeType !== 'all' && node.nodeType !== activeType) continue;
    addNodeId(node.id);
  }

  for (const edge of visibleEdgesByMode) {
    if (matchedNodeIds.has(edge.fromNodeId) || matchedNodeIds.has(edge.toNodeId) || edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId) {
      addNodeId(edge.fromNodeId);
      addNodeId(edge.toNodeId);
    }
  }

  const visibleNodes = sourceNodes.filter((node) => {
    if (!visibleNodeIds.has(node.id)) return false;
    if (activeType === 'all') return true;
    return node.nodeType === activeType
      || visibleEdgesByMode.some((edge) =>
        (edge.fromNodeId === node.id && graphNodesByMode.get(edge.toNodeId)?.nodeType === activeType)
        || (edge.toNodeId === node.id && graphNodesByMode.get(edge.fromNodeId)?.nodeType === activeType),
      );
  });
  const finalVisibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = visibleEdgesByMode.filter((edge) => finalVisibleNodeIds.has(edge.fromNodeId) && finalVisibleNodeIds.has(edge.toNodeId));
  const visibleEdgePartners = new Map<string, Set<string>>();
  for (const edge of visibleEdges) {
    const fromPartners = visibleEdgePartners.get(edge.fromNodeId) ?? new Set<string>();
    fromPartners.add(edge.toNodeId);
    visibleEdgePartners.set(edge.fromNodeId, fromPartners);

    const toPartners = visibleEdgePartners.get(edge.toNodeId) ?? new Set<string>();
    toPartners.add(edge.fromNodeId);
    visibleEdgePartners.set(edge.toNodeId, toPartners);
  }

  const typeBuckets = new Map<string, CoordinationGraphNode[]>();
  for (const nodeType of GRAPH_TYPE_ORDER) typeBuckets.set(nodeType, []);
  for (const node of visibleNodes) {
    const bucket = typeBuckets.get(node.nodeType) ?? [];
    bucket.push(node);
    typeBuckets.set(node.nodeType, bucket);
  }

  const width = GRAPH_VIEWBOX.width;
  const height = GRAPH_VIEWBOX.height;
  const columnSpacing = width / (GRAPH_TYPE_ORDER.length + 1);
  const repoPrefix = getSharedPrefix(
    visibleNodes
      .filter((node) => node.nodeType === 'repo')
      .map((node) => node.label),
  );

  const orderedBuckets = new Map<string, CoordinationGraphNode[]>();
  for (const nodeType of GRAPH_TYPE_ORDER) {
    const bucket = [...(typeBuckets.get(nodeType) ?? [])].sort((left, right) => {
      const leftMatched = matchedNodeIds.has(left.id) ? 1 : 0;
      const rightMatched = matchedNodeIds.has(right.id) ? 1 : 0;
      if (rightMatched !== leftMatched) return rightMatched - leftMatched;

      const leftDegree = degreeMap.get(left.id) ?? 0;
      const rightDegree = degreeMap.get(right.id) ?? 0;
      if (rightDegree !== leftDegree) return rightDegree - leftDegree;

      return left.label.localeCompare(right.label);
    });
    orderedBuckets.set(nodeType, bucket);
  }

  const laidOutNodes = visibleNodes.map((node) => {
    const bucket = orderedBuckets.get(node.nodeType) ?? [];
    const index = bucket.findIndex((entry) => entry.id === node.id);
    const count = Math.max(bucket.length, 1);
    const typeIndex = Math.max(0, GRAPH_TYPE_ORDER.indexOf(node.nodeType as typeof GRAPH_TYPE_ORDER[number]));
    const xBase = columnSpacing * (typeIndex + 1);
    const usableTop = 56;
    const usableBottom = height - 44;
    const usableHeight = usableBottom - usableTop;
    const yGap = usableHeight / (count + 1);
    const yBase = usableTop + yGap * (index + 1);
    const degree = degreeMap.get(node.id) ?? 0;

    return {
      ...node,
      degree,
      x: xBase,
      y: yBase,
      radius: Math.max(8, Math.min(18, 8 + degree * 1.2)),
      dimmed: activeType !== 'all' && node.nodeType !== activeType,
      matched: matchedNodeIds.has(node.id),
      displayLabel: node.nodeType === 'repo' ? trimRepoLabel(node.label, repoPrefix) : node.label,
      showCard: matchedNodeIds.has(node.id)
        || node.id === selectedNodeId
        || degree >= 6
        || node.nodeType === 'person'
        || node.nodeType === 'repo'
        || node.nodeType === 'document'
        || node.nodeType === 'deliverable',
      cardWidth: getGraphNodeCardWidth(node.nodeType === 'repo' ? trimRepoLabel(node.label, repoPrefix) : node.label),
      cardHeight: 34,
    };
  });

  return { nodes: laidOutNodes, edges: visibleEdges };
}

function KnowledgeGraphPanel({ graph }: { graph: CoordinationGraph | null }) {
  const [activeType, setActiveType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<'overview' | 'ownership' | 'expertise' | 'deliverables'>('overview');
  const [graphStyle, setGraphStyle] = useState<KnowledgeGraphStyle>('odyssey');
  const [density, setDensity] = useState<'focused' | 'balanced' | 'expanded'>('balanced');
  const [showInferred, setShowInferred] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const inlineGraphRef = useRef<HTMLDivElement | null>(null);
  const expandedGraphRef = useRef<HTMLDivElement | null>(null);

  const degreeMap = buildDegreeMap(graph, showInferred);
  const { nodes, edges } = buildVisibleGraph(graph, activeType, searchTerm, graphMode, density, selectedNodeId, showInferred);
  const baseNodeMap = new Map(nodes.map((node) => [node.id, node]));
  const rowboatFocusNodeId = hoveredNodeId && baseNodeMap.has(hoveredNodeId)
    ? hoveredNodeId
    : selectedNodeId && baseNodeMap.has(selectedNodeId)
      ? selectedNodeId
      : nodes.find((node) => node.matched)?.id
        ?? [...nodes]
          .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label))[0]?.id
        ?? null;
  const rowboatLayout = buildRowboatLayout(nodes, edges, rowboatFocusNodeId, selectedNodeId);
  const renderedNodes = graphStyle === 'rowboat' ? rowboatLayout.nodes : nodes;
  const renderedEdges = graphStyle === 'rowboat' ? rowboatLayout.edges : edges;
  const nodeMap = new Map(renderedNodes.map((node) => [node.id, node]));

  useEffect(() => {
    if (!selectedNodeId || nodeMap.has(selectedNodeId)) return;
    setSelectedNodeId(null);
  }, [nodeMap, nodes, selectedNodeId]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const hoveredNode = hoveredNodeId ? nodeMap.get(hoveredNodeId) ?? null : null;
  const infoNode = hoveredNode ?? selectedNode;
  const infoBox = infoNode ? getGraphInfoBoxSize(infoNode.label) : null;
  const infoBoxPosition = infoNode && infoBox ? getGraphInfoBoxPosition(infoNode, infoBox) : null;
  const selectedNeighbors = selectedNode
    ? renderedEdges
      .filter((edge) => edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id)
      .reduce<Array<{
        edgeType: string;
        weight: number;
        node: VisibleGraphNode;
      }>>((neighbors, edge) => {
        const relatedNodeId = edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.fromNodeId;
        const relatedNode = nodeMap.get(relatedNodeId);
        if (relatedNode) {
          neighbors.push({ edgeType: edge.edgeType, weight: edge.weight, node: relatedNode });
        }
        return neighbors;
      }, [])
      .sort((left, right) => right.node.degree - left.node.degree || left.node.label.localeCompare(right.node.label))
      .slice(0, 8)
    : [];
  const connectedNodeIds = new Set(
    selectedNode
      ? [
        selectedNode.id,
        ...selectedNeighbors.map((neighbor) => neighbor.node.id),
      ]
      : [],
  );

  const handleWheelZoom = useCallback((element: HTMLDivElement, clientX: number, clientY: number, deltaY: number) => {
    const bounds = element.getBoundingClientRect();
    const pointerX = ((clientX - bounds.left) / bounds.width) * GRAPH_VIEWBOX.width;
    const pointerY = ((clientY - bounds.top) / bounds.height) * GRAPH_VIEWBOX.height;
    const nextZoom = Math.min(2.8, Math.max(0.55, zoom * (deltaY < 0 ? 1.08 : 0.92)));
    const graphX = (pointerX - pan.x) / zoom;
    const graphY = (pointerY - pan.y) / zoom;
    setPan({
      x: pointerX - graphX * nextZoom,
      y: pointerY - graphY * nextZoom,
    });
    setZoom(nextZoom);
  }, [pan.x, pan.y, zoom]);

  useEffect(() => {
    const elements = [inlineGraphRef.current, expandedGraphRef.current].filter((element): element is HTMLDivElement => Boolean(element));
    if (elements.length === 0) return undefined;

    const listeners = elements.map((element) => {
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        handleWheelZoom(element, event.clientX, event.clientY, event.deltaY);
      };

      element.addEventListener('wheel', onWheel, { passive: false, capture: true });
      return { element, onWheel };
    });

    return () => {
      listeners.forEach(({ element, onWheel }) => {
        element.removeEventListener('wheel', onWheel, true);
      });
    };
  }, [handleWheelZoom]);

  useEffect(() => {
    if (!expanded) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [expanded]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const totalDx = event.clientX - dragRef.current.startX;
    const totalDy = event.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && Math.hypot(totalDx, totalDy) < 5) return;

    const dx = ((event.clientX - dragRef.current.lastX) / event.currentTarget.clientWidth) * GRAPH_VIEWBOX.width;
    const dy = ((event.clientY - dragRef.current.lastY) / event.currentTarget.clientHeight) * GRAPH_VIEWBOX.height;
    dragRef.current = {
      ...dragRef.current,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: true,
    };
    setDragging(true);
    setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
  }, []);

  const stopDragging = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const resetViewport = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (!graph || graph.nodes.length === 0) {
    return <EmptyState text="Generate a coordination snapshot to populate the project knowledge graph." />;
  }

  const renderWorkspace = (fullscreen: boolean) => (
    <div className={`space-y-5 ${fullscreen ? 'flex h-full flex-col overflow-hidden' : ''}`}>
      <div className={`grid gap-4 ${fullscreen ? 'shrink-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,460px)]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]'}`}>
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-muted">View Mode</p>
            <div className="flex flex-wrap gap-2">
              {[
                ['overview', 'Overview'],
                ['ownership', 'Ownership'],
                ['expertise', 'Expertise'],
                ['deliverables', 'Deliverables'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGraphMode(value as typeof graphMode)}
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${graphMode === value ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-muted">Graph Style</p>
            <div className="flex flex-wrap gap-2">
              {[
                ['odyssey', 'Odyssey'],
                ['rowboat', 'Rowboat'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGraphStyle(value as KnowledgeGraphStyle)}
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${graphStyle === value ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.24em] text-muted">Node Type</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveType('all')}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${activeType === 'all' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted'}`}
              >
                All
              </button>
              {GRAPH_TYPE_ORDER.map((nodeType) => (
                <button
                  key={nodeType}
                  type="button"
                  onClick={() => setActiveType(nodeType)}
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${activeType === nodeType ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted'}`}
                >
                  {GRAPH_TYPE_LABELS[nodeType]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="relative block w-full">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Find nodes by label or id"
              className="w-full border border-border bg-surface2 py-2 pl-9 pr-3 text-sm text-heading outline-none transition-colors focus:border-accent/40"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowInferred((current) => !current)}
              className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${showInferred ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted'}`}
            >
              {showInferred ? 'AI Layer On' : 'AI Layer Off'}
            </button>
            {[
              ['focused', 'Focused'],
              ['balanced', 'Balanced'],
              ['expanded', 'Expanded'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDensity(value as typeof density)}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] ${density === value ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted'}`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={resetViewport}
              className="rounded-full border border-border bg-surface2 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-muted transition-colors hover:text-heading"
            >
              Reset View
            </button>
            <span className="rounded-full border border-border bg-surface2 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-muted">
              {graphStyle === 'rowboat' ? 'Labels: key entities + matches' : 'Labels: People + Repos'}
            </span>
          </div>
        </div>
      </div>

      <div className={`grid gap-5 ${fullscreen ? 'min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]'}`}>
        <div
          ref={fullscreen ? expandedGraphRef : inlineGraphRef}
          className={`overflow-hidden border border-border bg-surface2 p-3 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ overscrollBehavior: 'contain', touchAction: 'none' }}
          onClick={() => setSelectedNodeId(null)}
          onWheelCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleWheelZoom(event.currentTarget, event.clientX, event.clientY, event.deltaY);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerLeave={() => {
            setHovering(false);
            stopDragging();
          }}
          onPointerEnter={() => setHovering(true)}
        >
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted">
            <span>{hovering ? 'Scroll to zoom, drag to pan' : graphStyle === 'rowboat' ? 'Focus-driven memory map' : 'Interactive graph'}</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <svg viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`} className={`${fullscreen ? 'h-[calc(100vh-22rem)] min-h-[620px]' : 'h-[560px]'} w-full select-none`}>
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {graphStyle === 'rowboat' ? (
                <>
                  <circle cx={GRAPH_VIEWBOX.width / 2} cy={GRAPH_VIEWBOX.height / 2 + 6} r={82} fill="rgba(111,183,255,0.06)" stroke="rgba(111,183,255,0.16)" strokeWidth="1.2" />
                  <text x={GRAPH_VIEWBOX.width / 2} y={GRAPH_VIEWBOX.height / 2 + 10} textAnchor="middle" fill="#7a8ba8" fontSize="11" letterSpacing="2.2">
                    PROJECT MEMORY
                  </text>

                  {rowboatLayout.anchors.map((anchor) => (
                    <g key={anchor.nodeType}>
                      <circle
                        cx={anchor.x}
                        cy={anchor.y}
                        r={anchor.radius}
                        fill={GRAPH_TYPE_COLORS[anchor.nodeType] ?? '#8b95a7'}
                        fillOpacity={0.08}
                        stroke={GRAPH_TYPE_COLORS[anchor.nodeType] ?? '#8b95a7'}
                        strokeOpacity={0.18}
                        strokeWidth="1.2"
                      />
                      <text x={anchor.x} y={anchor.y - anchor.radius - 10} textAnchor="middle" fill="#7a8ba8" fontSize="12" letterSpacing="2.4">
                        {GRAPH_TYPE_LABELS[anchor.nodeType].toUpperCase()}
                      </text>
                    </g>
                  ))}

                  {renderedEdges.map((edge) => {
                    const from = nodeMap.get(edge.fromNodeId);
                    const to = nodeMap.get(edge.toNodeId);
                    if (!from || !to) return null;
                    const highlighted = selectedNode && (edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id);
                    const edgeDimmed = selectedNode
                      ? !highlighted
                      : !highlighted && activeType !== 'all' && from.nodeType !== activeType && to.nodeType !== activeType;
                    return (
                      <path
                        key={edge.id}
                        d={buildCurvedGraphEdgePath(from, to, Boolean(highlighted))}
                        fill="none"
                        stroke={highlighted ? 'rgba(245,198,106,0.94)' : edgeDimmed ? 'rgba(139,149,167,0.07)' : 'rgba(111,183,255,0.18)'}
                        strokeWidth={highlighted ? Math.max(3.1, edge.weight * 2) : Math.max(0.9, Math.min(2.1, edge.weight))}
                        strokeLinecap="round"
                        style={{ transition: 'd 180ms ease, stroke 180ms ease, stroke-width 180ms ease, opacity 180ms ease' }}
                      />
                    );
                  })}

                  {renderedNodes.map((node) => {
                    const emphasized = connectedNodeIds.has(node.id) || node.matched;
                    const fadedBySelection = selectedNode ? !connectedNodeIds.has(node.id) : false;
                    const isSelected = selectedNode?.id === node.id;
                    return (
                      <g
                        key={node.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedNodeId(node.id);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerEnter={(event) => {
                          event.stopPropagation();
                          setHoveredNodeId(node.id);
                        }}
                        onPointerLeave={(event) => {
                          event.stopPropagation();
                          setHoveredNodeId((current) => (current === node.id ? null : current));
                        }}
                        className="cursor-pointer"
                      >
                        {node.showCard ? (
                          <>
                            <rect
                              x={node.x - node.cardWidth / 2}
                              y={node.y - node.cardHeight / 2}
                              width={node.cardWidth}
                              height={node.cardHeight}
                              rx={15}
                              fill={fadedBySelection ? 'rgba(255,255,255,0.52)' : 'rgba(248,250,252,0.92)'}
                              stroke={isSelected ? 'rgba(245,198,106,0.92)' : emphasized ? 'rgba(111,183,255,0.35)' : 'rgba(148,163,184,0.22)'}
                              strokeWidth={isSelected ? 2.6 : 1.2}
                              style={{ transition: 'x 180ms ease, y 180ms ease, width 180ms ease, stroke 180ms ease, fill 180ms ease' }}
                            />
                            <circle
                              cx={node.x - node.cardWidth / 2 + 15}
                              cy={node.y}
                              r={6.5}
                              fill={GRAPH_TYPE_COLORS[node.nodeType] ?? '#8b95a7'}
                              fillOpacity={fadedBySelection ? 0.3 : 0.88}
                              style={{ transition: 'cx 180ms ease, cy 180ms ease, fill-opacity 180ms ease' }}
                            />
                            <text
                              x={node.x - node.cardWidth / 2 + 28}
                              y={node.y + 4}
                              textAnchor="start"
                              fill={fadedBySelection ? '#9aa4b5' : '#23324b'}
                              fontSize="11"
                              fontWeight="600"
                              style={{ transition: 'x 180ms ease, y 180ms ease, fill 180ms ease' }}
                            >
                              {node.displayLabel.length > 26 ? `${node.displayLabel.slice(0, 24)}...` : node.displayLabel}
                            </text>
                            <text
                              x={node.x + node.cardWidth / 2 - 12}
                              y={node.y + 4}
                              textAnchor="end"
                              fill={fadedBySelection ? '#9aa4b5' : '#5f708d'}
                              fontSize="10"
                              style={{ transition: 'x 180ms ease, y 180ms ease, fill 180ms ease' }}
                            >
                              {node.degree}
                            </text>
                          </>
                        ) : (
                          <>
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={node.radius}
                              fill={GRAPH_TYPE_COLORS[node.nodeType] ?? '#8b95a7'}
                              fillOpacity={isSelected ? 1 : fadedBySelection ? 0.12 : emphasized ? 0.88 : node.dimmed ? 0.22 : 0.66}
                              stroke={isSelected ? '#ffffff' : emphasized ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.14)'}
                              strokeWidth={isSelected ? 3 : emphasized ? 1.5 : 1}
                              style={{ transition: 'cx 180ms ease, cy 180ms ease, r 180ms ease, fill-opacity 180ms ease, stroke 180ms ease' }}
                            />
                            {(node.matched || isSelected) && (
                              <text
                                x={node.x}
                                y={node.y + node.radius + 14}
                                textAnchor="middle"
                                fill="#64748b"
                                fontSize="10"
                              >
                                {node.displayLabel.length > 20 ? `${node.displayLabel.slice(0, 18)}...` : node.displayLabel}
                              </text>
                            )}
                          </>
                        )}
                      </g>
                    );
                  })}
                </>
              ) : (
                <>
                  {GRAPH_TYPE_ORDER.map((nodeType, index) => {
                    const x = (GRAPH_VIEWBOX.width / (GRAPH_TYPE_ORDER.length + 1)) * (index + 1);
                    return (
                      <g key={nodeType}>
                        <text x={x} y={26} textAnchor="middle" fill="#8b95a7" fontSize="12" letterSpacing="2.4">
                          {GRAPH_TYPE_LABELS[nodeType].toUpperCase()}
                        </text>
                        <line x1={x} y1={40} x2={x} y2={540} stroke="rgba(139,149,167,0.14)" strokeWidth="1" />
                      </g>
                    );
                  })}

                  {renderedEdges.map((edge) => {
                    const from = nodeMap.get(edge.fromNodeId);
                    const to = nodeMap.get(edge.toNodeId);
                    if (!from || !to) return null;
                    const highlighted = selectedNode && (edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id);
                    const edgeDimmed = selectedNode
                      ? !highlighted
                      : !highlighted && activeType !== 'all' && from.nodeType !== activeType && to.nodeType !== activeType;
                    return (
                      <line
                        key={edge.id}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={highlighted ? 'rgba(245,198,106,0.96)' : edgeDimmed ? 'rgba(139,149,167,0.06)' : 'rgba(111,183,255,0.22)'}
                        strokeWidth={highlighted ? Math.max(3.2, edge.weight * 2.1) : Math.max(0.8, Math.min(2.4, edge.weight))}
                      />
                    );
                  })}

                  {renderedNodes.map((node) => {
                    const showLabel = node.nodeType === 'person' || node.nodeType === 'repo';
                    const emphasized = connectedNodeIds.has(node.id) || node.matched;
                    const fadedBySelection = selectedNode ? !connectedNodeIds.has(node.id) : false;
                    return (
                      <g
                        key={node.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedNodeId(node.id);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerEnter={(event) => {
                          event.stopPropagation();
                          setHoveredNodeId(node.id);
                        }}
                        onPointerLeave={(event) => {
                          event.stopPropagation();
                          setHoveredNodeId((current) => (current === node.id ? null : current));
                        }}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius}
                          fill={GRAPH_TYPE_COLORS[node.nodeType] ?? '#8b95a7'}
                          fillOpacity={selectedNode?.id === node.id ? 1 : fadedBySelection ? 0.14 : emphasized ? 0.9 : node.dimmed ? 0.22 : 0.72}
                          stroke={selectedNode?.id === node.id ? '#ffffff' : emphasized ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.14)'}
                          strokeWidth={selectedNode?.id === node.id ? 3 : emphasized ? 1.5 : 1}
                        />
                        {showLabel && (
                          <text
                            x={node.x}
                            y={node.y + node.radius + 14}
                            textAnchor="middle"
                            fill={selectedNode?.id === node.id ? '#f8fafc' : node.dimmed ? '#667085' : '#cbd5e1'}
                            fontSize="10"
                          >
                            {node.displayLabel.length > 28 ? `${node.displayLabel.slice(0, 26)}...` : node.displayLabel}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </>
              )}

              {infoNode && infoBox && infoBoxPosition && (
                <foreignObject
                  x={infoBoxPosition.x}
                  y={infoBoxPosition.y}
                  width={infoBox.width}
                  height={infoBox.height}
                  style={{ overflow: 'visible', pointerEvents: 'none' }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: '100%',
                      borderRadius: '12px',
                      border: infoNode.id === selectedNode?.id
                        ? '1px solid rgba(245, 198, 106, 0.42)'
                        : '1px solid rgba(148, 163, 184, 0.22)',
                      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(17, 24, 39, 0.92))',
                      boxShadow: '0 14px 34px rgba(2, 6, 23, 0.32)',
                      padding: '11px 12px',
                      color: '#e5e7eb',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(148, 163, 184, 0.88)' }}>
                      {hoveredNode ? 'Hover' : 'Selected'} • {GRAPH_TYPE_LABELS[infoNode.nodeType] ?? infoNode.nodeType}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '13px', lineHeight: 1.35, fontWeight: 600, color: '#f8fafc', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {infoNode.label}
                    </div>
                  </div>
                </foreignObject>
              )}
            </g>
          </svg>
        </div>

        <div className={`space-y-4 ${fullscreen ? 'min-h-0 overflow-y-auto pr-1' : ''}`}>
          <div className="border border-border bg-surface2 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Graph Status</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted">
              <p>Nodes: <span className="text-heading">{showInferred ? graph.nodes.length : graph.nodes.length - (graph.inferredNodeIds?.length ?? 0)}</span></p>
              <p>Edges: <span className="text-heading">{showInferred ? graph.edges.length : graph.edges.length - (graph.inferredEdgeIds?.length ?? 0)}</span></p>
              <p>Generated: <span className="text-heading">{formatDateTime(graph.generatedAt)}</span></p>
              <p>State: <span className="text-heading">{graph.stale ? 'Stale' : 'Fresh'}</span></p>
              <p>AI Inference: <span className="text-heading">{graph.inference?.status ?? 'none'}</span></p>
              <p>AI Added: <span className="text-heading">{graph.inference?.inferredNodeCount ?? 0} nodes / {graph.inference?.inferredEdgeCount ?? 0} edges</span></p>
            </div>
            {(graph.inference?.provider || graph.inference?.message) && (
              <p className="mt-3 text-xs text-muted">
                {graph.inference?.provider ? `${graph.inference.provider} • ` : ''}
                {graph.inference?.message}
              </p>
            )}
          </div>

          <div className="border border-border bg-surface2 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Selected Node</p>
            {selectedNode ? (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-heading">{selectedNode.label}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">{GRAPH_TYPE_LABELS[selectedNode.nodeType] ?? selectedNode.nodeType}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                  <p>Degree: <span className="text-heading">{degreeMap.get(selectedNode.id) ?? 0}</span></p>
                  <p>ID: <span className="text-heading">{selectedNode.externalId}</span></p>
                </div>
                {selectedNeighbors.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">Connected To</p>
                    <div className="space-y-2">
                      {selectedNeighbors.map((neighbor) => (
                        <div key={`${selectedNode.id}-${neighbor.node.id}-${neighbor.edgeType}`} className="border border-border/80 bg-surface px-3 py-2 text-xs">
                          <p className="font-semibold text-heading">{neighbor.node.label}</p>
                          <p className="mt-1 text-muted">{neighbor.edgeType.replaceAll('_', ' ')} • weight {neighbor.weight}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState text="No visible connections for this node in the current graph slice." />
                )}
              </div>
            ) : (
              <EmptyState text="Select a node in the graph to inspect its connections." />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface2 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-muted transition-colors hover:text-heading"
            title="Expand knowledge graph"
            aria-label="Expand knowledge graph"
          >
            <Maximize2 size={14} />
            Expand
          </button>
        </div>
        {renderWorkspace(false)}
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/70 p-4 backdrop-blur-sm md:p-6">
          <div className="flex h-full flex-col border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-heading">Project Knowledge Graph</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">Full-page graph workspace</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface2 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-muted transition-colors hover:text-heading"
                title="Collapse knowledge graph"
                aria-label="Collapse knowledge graph"
              >
                <Minimize2 size={14} />
                Collapse
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-5">
              {renderWorkspace(true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function getAuthHeaders(hasJsonBody = false): Promise<HeadersInit> {
  const headers: HeadersInit = {};
  if (hasJsonBody) headers['Content-Type'] = 'application/json';
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) {
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  return headers;
}

export default function CoordinationTab({ projectId, isOwner }: CoordinationTabProps) {
  const [snapshot, setSnapshot] = useState<CoordinationSnapshot | null>(null);
  const [graph, setGraph] = useState<CoordinationGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBundle = useCallback(async (showSpinner = true) => {
    if (!projectId) return;
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(false);
      const response = await fetch(`${API_BASE}/projects/${projectId}/coordination`, { headers });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error ?? `Failed to load coordination data (${response.status})`);
      }
      const bundle = payload as CoordinationBundle;
      setSnapshot(bundle.snapshot);
      setGraph(bundle.graph);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load coordination data.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!active) return;
      await loadBundle(true);
    };

    void run();
    return () => {
      active = false;
    };
  }, [loadBundle]);

  const handleRecompute = useCallback(async () => {
    if (!projectId) return;
    setRecomputing(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(false);
      const response = await fetch(`${API_BASE}/projects/${projectId}/coordination/recompute`, {
        method: 'POST',
        headers,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error ?? `Failed to recompute coordination data (${response.status})`);
      }
      const bundle = payload as CoordinationBundle;
      setSnapshot(bundle.snapshot);
      setGraph(bundle.graph);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to recompute coordination data.');
    } finally {
      setRecomputing(false);
      setLoading(false);
    }
  }, [projectId]);

  return (
    <div className="space-y-6">
      <div className="border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-heading">Coordination</h1>
              {snapshot?.stale && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-200">
                  Stale
                </span>
              )}
              {snapshot?.status === 'missing' && (
                <span className="rounded-full border border-border bg-surface2 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-muted">
                  Snapshot Missing
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted">
              AI-backed ownership, handoff, workload, and knowledge coverage for this project.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              <span className="rounded-full border border-border bg-surface2 px-3 py-1">
                Generated: {snapshot ? formatDateTime(snapshot.generatedAt) : 'Not generated yet'}
              </span>
              <span className="rounded-full border border-border bg-surface2 px-3 py-1">
                Graph: {graph?.nodes.length ?? snapshot?.graphStats.nodeCount ?? 0} nodes / {graph?.edges.length ?? snapshot?.graphStats.edgeCount ?? 0} edges
              </span>
              <span className="rounded-full border border-border bg-surface2 px-3 py-1">
                View: {snapshot?.viewerRole ?? (isOwner ? 'owner' : 'member')}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRecompute}
            disabled={recomputing}
            className="inline-flex items-center justify-center gap-2 border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recomputing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Recompute Snapshot
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {!error && snapshot?.teamCoordination.summary?.length ? (
          <div className="mt-4 space-y-2">
            {snapshot.teamCoordination.summary.map((entry) => (
              <SummaryLine key={entry} text={entry} />
            ))}
          </div>
        ) : null}
      </div>

      {loading && !snapshot ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading coordination data…
        </div>
      ) : (
        <div className="grid gap-6">
          <Section title="My Next Actions" icon={Target}>
            <QueueCard queue={snapshot?.myNextActions ?? null} />
          </Section>

          <Section title="Contribution Profiles" icon={Users}>
            {snapshot?.contributionProfiles.length ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs text-muted">
                  <span className="rounded-full border border-border bg-surface2 px-3 py-1">
                    Avg active tasks: {snapshot.workloadBalance.averageActiveTasks}
                  </span>
                  <span className="rounded-full border border-border bg-surface2 px-3 py-1">
                    Avg recent hours: {snapshot.workloadBalance.averageRecentHours}
                  </span>
                  <span className="rounded-full border border-border bg-surface2 px-3 py-1">
                    Heavy load: {snapshot.workloadBalance.people.filter((person) => person.capacityStatus === 'heavy').length}
                  </span>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {snapshot.contributionProfiles.map((profile) => {
                    const workload = snapshot.workloadBalance.people.find((person) => person.userId === profile.userId) ?? null;
                    return <ContributionCard key={profile.userId} profile={profile} workload={workload} />;
                  })}
                </div>
              </div>
            ) : (
              <EmptyState text="Contribution profiles will populate once coordination data is generated." />
            )}
          </Section>

          <Section title="Project Knowledge Graph" icon={Share2}>
            <KnowledgeGraphPanel graph={graph} />
          </Section>
        </div>
      )}
    </div>
  );
}
