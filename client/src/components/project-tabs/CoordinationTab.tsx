import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
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

const GRAPH_TYPE_ORDER = ['person', 'task', 'concept', 'deliverable', 'repo', 'document', 'file'] as const;
const GRAPH_TYPE_LABELS: Record<string, string> = {
  person: 'People',
  task: 'Tasks',
  deliverable: 'Deliverables',
  concept: 'LOE / Categories',
  document: 'Documents',
  repo: 'Repositories',
  file: 'Files',
};
const GRAPH_TYPE_META_LABELS: Record<string, string> = {
  person: 'PERSON',
  task: 'TASK',
  deliverable: 'DELIVERABLE',
  concept: 'LOE / CATEGORY',
  document: 'DOCUMENT',
  repo: 'REPOSITORY',
  file: 'FILE',
};
const GRAPH_VIEWBOX = { width: 1320, height: 640 };
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

type StringStyleLaneConfig = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
  maxColumns: number;
};

const STRING_STYLE_LANE_CONFIGS: Record<(typeof GRAPH_TYPE_ORDER)[number], StringStyleLaneConfig> = {
  person: { label: 'People', x: 24, y: 78, width: 176, height: 480, columns: 1, maxColumns: 1 },
  task: { label: 'Tasks', x: 230, y: 78, width: 300, height: 480, columns: 2, maxColumns: 2 },
  concept: { label: 'LOE / Categories', x: 560, y: 78, width: 196, height: 480, columns: 1, maxColumns: 1 },
  deliverable: { label: 'Deliverables', x: 786, y: 78, width: 190, height: 480, columns: 1, maxColumns: 1 },
  repo: { label: 'Repositories', x: 1006, y: 78, width: 290, height: 140, columns: 2, maxColumns: 2 },
  document: { label: 'Documents', x: 1006, y: 242, width: 290, height: 180, columns: 2, maxColumns: 2 },
  file: { label: 'Files', x: 1006, y: 446, width: 290, height: 112, columns: 2, maxColumns: 2 },
};

const STRING_STYLE_NODE_LIMITS: Record<(typeof GRAPH_TYPE_ORDER)[number], number> = {
  person: 6,
  concept: 6,
  task: 8,
  deliverable: 4,
  repo: 4,
  file: 4,
  document: 4,
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
  node: { x: number; y: number; radius: number; cardHeight?: number },
  box: { width: number; height: number },
): { x: number; y: number } {
  const verticalGap = 16;
  const horizontalPadding = 12;
  const halfNodeHeight = Math.max(node.radius, (node.cardHeight ?? 0) / 2);
  const topY = node.y - halfNodeHeight - box.height - verticalGap;
  const bottomY = node.y + halfNodeHeight + verticalGap;
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

function getStringStyleNodeDimensions(node: VisibleGraphNode, maxWidth: number) {
  const baseWidth = node.nodeType === 'task'
    ? 138
    : node.nodeType === 'document'
      ? 176
      : node.nodeType === 'concept'
        ? 142
        : 136;
  const width = clampGraphCoordinate(baseWidth + Math.max(0, node.displayLabel.length - 12) * 1.85, 124, maxWidth);
  const height = node.nodeType === 'task' || node.nodeType === 'deliverable' ? 54 : 50;
  return { width, height };
}

function getStringStyleCardTitle(node: VisibleGraphNode) {
  const approxChars = Math.max(12, Math.floor((node.cardWidth - 48) / 7));
  return node.displayLabel.length > approxChars ? `${node.displayLabel.slice(0, approxChars - 1)}...` : node.displayLabel;
}

function getStringStyleCardMeta(node: VisibleGraphNode) {
  const label = GRAPH_TYPE_META_LABELS[node.nodeType] ?? node.nodeType.toUpperCase();
  return label.length > 10 ? `${label.slice(0, 10)}.` : label;
}

type StringStyleCellRect = {
  nodeType: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function buildStringStyleProjectLayout(nodes: VisibleGraphNode[], selectedNodeId: string | null): {
  nodes: VisibleGraphNode[];
  cells: StringStyleCellRect[];
} {
  const lanePaddingX = 14;
  const lanePaddingY = 18;
  const gapX = 12;
  const gapY = 12;
  // Vertical gap between stacked cells in the same column
  const cellStackGap = 24;
  // Top margin before the first cell in each column
  const columnTopY = 78;

  // Group lane types by their x-column (same x = same column, stacked vertically)
  const columnGroups: Map<number, (keyof typeof STRING_STYLE_LANE_CONFIGS)[]> = new Map();
  for (const nodeType of GRAPH_TYPE_ORDER) {
    const config = STRING_STYLE_LANE_CONFIGS[nodeType];
    const existing = columnGroups.get(config.x) ?? [];
    existing.push(nodeType as keyof typeof STRING_STYLE_LANE_CONFIGS);
    columnGroups.set(config.x, existing);
  }

  // For each lane, compute the content height needed based on actual nodes
  function computeLaneContentHeight(
    ordered: VisibleGraphNode[],
    config: StringStyleLaneConfig,
  ): { contentHeight: number; columns: number; rowHeights: number[]; dimensions: Array<{ width: number; height: number }>; columnWidth: number } {
    if (ordered.length === 0) return { contentHeight: 0, columns: config.columns, rowHeights: [], dimensions: [], columnWidth: 0 };
    const availableWidth = Math.max(80, config.width - lanePaddingX * 2);

    let bestLayout: {
      columns: number;
      rowHeights: number[];
      dimensions: Array<{ width: number; height: number }>;
      columnWidth: number;
      totalHeight: number;
    } | null = null;

    for (let cols = config.columns; cols <= config.maxColumns; cols += 1) {
      const columnWidth = (availableWidth - gapX * (cols - 1)) / cols;
      if (columnWidth < 108) continue;
      const dimensions = ordered.map((node) => getStringStyleNodeDimensions(node, columnWidth));
      const rowCount = Math.ceil(ordered.length / cols);
      const rowHeights = new Array(rowCount).fill(0) as number[];
      dimensions.forEach((dimension, index) => {
        const row = Math.floor(index / cols);
        rowHeights[row] = Math.max(rowHeights[row], dimension.height);
      });
      const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0) + gapY * Math.max(0, rowHeights.length - 1);
      if (!bestLayout || totalHeight < bestLayout.totalHeight) {
        bestLayout = { columns: cols, rowHeights, dimensions, columnWidth, totalHeight };
      }
    }

    if (!bestLayout) return { contentHeight: 0, columns: config.columns, rowHeights: [], dimensions: [], columnWidth: 0 };
    return {
      contentHeight: bestLayout.totalHeight,
      columns: bestLayout.columns,
      rowHeights: bestLayout.rowHeights,
      dimensions: bestLayout.dimensions,
      columnWidth: bestLayout.columnWidth,
    };
  }

  // Sort nodes per lane
  const orderedByType = new Map<string, VisibleGraphNode[]>();
  for (const nodeType of GRAPH_TYPE_ORDER) {
    const ordered = nodes
      .filter((node) => node.nodeType === nodeType)
      .sort((left, right) => {
        const leftSelected = left.id === selectedNodeId ? 1 : 0;
        const rightSelected = right.id === selectedNodeId ? 1 : 0;
        if (rightSelected !== leftSelected) return rightSelected - leftSelected;

        const leftMatched = left.matched ? 1 : 0;
        const rightMatched = right.matched ? 1 : 0;
        if (rightMatched !== leftMatched) return rightMatched - leftMatched;
        if (right.degree !== left.degree) return right.degree - left.degree;
        return left.label.localeCompare(right.label);
      })
      .slice(0, STRING_STYLE_NODE_LIMITS[nodeType]);
    orderedByType.set(nodeType, ordered);
  }

  const laidOutNodes: VisibleGraphNode[] = [];
  const cells: StringStyleCellRect[] = [];

  // Process each column: stack lanes top-to-bottom with computed heights
  for (const [colX, laneTypes] of columnGroups) {
    let currentY = columnTopY;

    for (const nodeType of laneTypes) {
      const config = STRING_STYLE_LANE_CONFIGS[nodeType];
      const ordered = orderedByType.get(nodeType) ?? [];

      if (ordered.length === 0) continue;

      const { contentHeight, columns, rowHeights, dimensions, columnWidth } = computeLaneContentHeight(ordered, config);
      const cellHeight = contentHeight + lanePaddingY * 2;

      cells.push({
        nodeType,
        label: config.label,
        x: colX,
        y: currentY,
        width: config.width,
        height: cellHeight,
      });

      const startY = currentY + lanePaddingY;
      const rowOffsets: number[] = [];
      let rowY = startY;
      rowHeights.forEach((rowHeight, index) => {
        rowOffsets[index] = rowY;
        rowY += rowHeight + gapY;
      });

      ordered.forEach((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const dimensionsForNode = dimensions[index] ?? getStringStyleNodeDimensions(node, columnWidth);
        const columnStart = colX + lanePaddingX + column * (columnWidth + gapX);
        const rowStart = rowOffsets[row] ?? startY;

        laidOutNodes.push({
          ...node,
          x: columnStart + columnWidth / 2,
          y: rowStart + (rowHeights[row] ?? dimensionsForNode.height) / 2,
          radius: Math.min(node.radius, 10),
          showCard: true,
          cardWidth: dimensionsForNode.width,
          cardHeight: dimensionsForNode.height,
        });
      });

      currentY += cellHeight + cellStackGap;
    }
  }

  return { nodes: laidOutNodes, cells };
}

function buildStringStyleProjectEdgePath(from: VisibleGraphNode, to: VisibleGraphNode) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const followsHorizontalFlow = Math.abs(deltaX) >= Math.abs(deltaY) * 0.55;

  if (followsHorizontalFlow) {
    const direction = deltaX >= 0 ? 1 : -1;
    const startX = from.x + direction * (from.cardWidth / 2 + 2);
    const endX = to.x - direction * (to.cardWidth / 2 + 2);
    const curvature = clampGraphCoordinate(Math.abs(endX - startX) * 0.42, 38, 170);
    return `M ${startX} ${from.y} C ${startX + curvature * direction} ${from.y}, ${endX - curvature * direction} ${to.y}, ${endX} ${to.y}`;
  }

  const direction = deltaY >= 0 ? 1 : -1;
  const startY = from.y + direction * (from.cardHeight / 2 + 2);
  const endY = to.y - direction * (to.cardHeight / 2 + 2);
  const curvature = clampGraphCoordinate(Math.abs(endY - startY) * 0.42, 34, 130);
  return `M ${from.x} ${startY} C ${from.x} ${startY + curvature * direction}, ${to.x} ${endY - curvature * direction}, ${to.x} ${endY}`;
}

function getGraphNodeAccent(nodeType: string): string {
  if (nodeType === 'person') return '#6fb7ff';
  if (nodeType === 'task') return '#7ce3b2';
  if (nodeType === 'deliverable') return '#f5c66a';
  if (nodeType === 'concept') return '#b9a1ff';
  if (nodeType === 'document') return '#a88dff';
  if (nodeType === 'repo') return '#8bd0f6';
  return '#a7b0c2';
}

function getGraphLanePalette(nodeType: string) {
  const accent = getGraphNodeAccent(nodeType);
  return {
    accent,
    fill: `color-mix(in srgb, var(--color-surface2) 91%, ${accent} 9%)`,
    stroke: `color-mix(in srgb, var(--color-border) 68%, ${accent} 32%)`,
  };
}

function getGraphEdgeColor(edgeType: string, emphasized = false): string {
  const alpha = emphasized ? 0.96 : 0.44;
  if (edgeType === 'owns' || edgeType === 'assigned_to' || edgeType === 'contributes_to') {
    return `rgba(111, 183, 255, ${alpha})`;
  }
  if (edgeType === 'expert_in' || edgeType === 'covers' || edgeType === 'mentions') {
    return `rgba(185, 161, 255, ${alpha})`;
  }
  if (edgeType === 'derived_from') return `rgba(245, 198, 106, ${alpha})`;
  if (edgeType === 'depends_on' || edgeType === 'blocked_by') return `rgba(240, 140, 160, ${alpha})`;
  return `rgba(139, 208, 246, ${alpha})`;
}

function getStringStyleNodePalette(node: VisibleGraphNode, selected: boolean) {
  if (selected) {
    return {
      fill: 'var(--color-accent)',
      stroke: 'var(--color-accent)',
      text: 'var(--color-accent-fg)',
      meta: 'rgba(255,255,255,0.86)',
    };
  }

  if (node.nodeType === 'person') {
    return {
      fill: 'rgba(111, 183, 255, 0.42)',
      stroke: 'rgba(111, 183, 255, 0.72)',
      text: '#edf5ff',
      meta: 'rgba(206, 226, 255, 0.88)',
    };
  }
  if (node.nodeType === 'task') {
    return {
      fill: 'rgba(124, 227, 178, 0.34)',
      stroke: 'rgba(124, 227, 178, 0.64)',
      text: '#eefdf6',
      meta: 'rgba(203, 245, 224, 0.86)',
    };
  }
  if (node.nodeType === 'deliverable') {
    return {
      fill: 'rgba(245, 198, 106, 0.36)',
      stroke: 'rgba(245, 198, 106, 0.66)',
      text: '#fff7e3',
      meta: 'rgba(255, 232, 184, 0.88)',
    };
  }
  if (node.nodeType === 'concept') {
    return {
      fill: 'rgba(185, 161, 255, 0.36)',
      stroke: 'rgba(185, 161, 255, 0.66)',
      text: '#f5f0ff',
      meta: 'rgba(226, 215, 255, 0.86)',
    };
  }
  if (node.nodeType === 'document') {
    return {
      fill: 'rgba(168, 141, 255, 0.32)',
      stroke: 'rgba(168, 141, 255, 0.6)',
      text: '#f6f2ff',
      meta: 'rgba(225, 215, 255, 0.86)',
    };
  }
  if (node.nodeType === 'repo') {
    return {
      fill: 'rgba(139, 208, 246, 0.34)',
      stroke: 'rgba(139, 208, 246, 0.62)',
      text: '#effaff',
      meta: 'rgba(214, 241, 255, 0.85)',
    };
  }
  return {
    fill: 'rgba(139, 149, 167, 0.3)',
    stroke: 'rgba(139, 149, 167, 0.56)',
    text: '#f5f7fb',
    meta: 'rgba(221, 228, 240, 0.84)',
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
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateCarouselControls = useCallback(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const maxScrollLeft = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
    setCanScrollLeft(carousel.scrollLeft > 4);
    setCanScrollRight(carousel.scrollLeft < maxScrollLeft - 4);
  }, []);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return undefined;

    let animationFrame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateCarouselControls);
    };

    scheduleUpdate();
    carousel.addEventListener('scroll', scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(carousel);
    Array.from(carousel.children).forEach((item) => resizeObserver.observe(item));

    return () => {
      window.cancelAnimationFrame(animationFrame);
      carousel.removeEventListener('scroll', scheduleUpdate);
      resizeObserver.disconnect();
    };
  }, [queue?.items.length, updateCarouselControls]);

  const scrollCarousel = useCallback((direction: -1 | 1) => {
    const carousel = carouselRef.current;
    const firstCard = carousel?.querySelector<HTMLElement>('[data-action-card]');
    if (!carousel || !firstCard) return;
    const styles = window.getComputedStyle(carousel);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0;
    carousel.scrollBy({
      left: direction * (firstCard.offsetWidth + gap),
      behavior: 'smooth',
    });
  }, []);

  if (!queue || queue.items.length === 0) {
    return <EmptyState text="No queued coordination actions yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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

        <div className="ml-auto flex items-center gap-2">
          <span className="mr-1 hidden text-[10px] uppercase tracking-[0.18em] text-muted sm:inline">
            {queue.items.length} actions
          </span>
          <button
            type="button"
            onClick={() => scrollCarousel(-1)}
            disabled={!canScrollLeft}
            tabIndex={canScrollLeft ? 0 : -1}
            aria-hidden={!canScrollLeft}
            aria-label="Show previous actions"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface2 text-heading transition-all hover:border-accent/45 hover:text-accent disabled:pointer-events-none ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            onClick={() => scrollCarousel(1)}
            disabled={!canScrollRight}
            aria-label="Show more actions"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface2 text-heading transition-all hover:border-accent/45 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      <div
        ref={carouselRef}
        className="flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {queue.items.map((item) => (
          <article
            key={`${item.kind}-${item.taskId}`}
            data-action-card
            className="flex min-w-[260px] shrink-0 basis-[86%] snap-start flex-col border border-border bg-surface2 p-4 sm:basis-[calc(50%_-_0.5rem)] xl:basis-[calc(33.333%_-_0.667rem)]"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold leading-5 text-heading [overflow-wrap:anywhere]">{item.taskTitle}</p>
              <p className="mt-2 break-words text-xs leading-5 text-muted [overflow-wrap:anywhere]">{item.reason}</p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${priorityClasses(item.priority)}`}>
                {item.priority}
              </span>
              <span className="rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-muted">
                {item.kind.replaceAll('_', ' ')}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted">
              <p>Due: <span className="text-heading">{formatDueDate(item.dueDate)}</span></p>
              <p className="text-right">Status: <span className="break-words text-heading">{item.status.replaceAll('_', ' ')}</span></p>
              {item.blockedByTaskTitle && (
                <p className="col-span-2 break-words [overflow-wrap:anywhere]">
                  Blocked by: <span className="text-heading">{item.blockedByTaskTitle}</span>
                </p>
              )}
            </div>

            <p className="mt-auto break-words pt-4 text-xs leading-5 text-accent [overflow-wrap:anywhere]">{item.suggestedAction}</p>
          </article>
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

function buildVisibleGraph(
  graph: CoordinationGraph | null,
  searchTerm: string,
  graphMode: 'overview' | 'ownership' | 'expertise' | 'deliverables',
  selectedNodeId: string | null,
): {
  nodes: VisibleGraphNode[];
  edges: CoordinationGraphEdge[];
} {
  if (!graph) return { nodes: [], edges: [] };

  const sourceNodes = graph.nodes;
  const sourceEdges = graph.edges;
  const degreeMap = buildDegreeMap({ ...graph, nodes: sourceNodes, edges: sourceEdges }, true);
  const normalizedQuery = searchTerm.trim().toLowerCase();
  const allowedEdgeTypes = graphMode === 'ownership'
    ? new Set(['owns', 'assigned_to', 'depends_on', 'blocked_by', 'contributes_to'])
    : graphMode === 'expertise'
      ? new Set(['expert_in', 'covers', 'mentions', 'derived_from'])
      : graphMode === 'deliverables'
        ? new Set(['covers', 'derived_from', 'contributes_to', 'depends_on', 'blocked_by'])
        : null;
  const densityLimit = 72;

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
  const addPinnedNodeId = (nodeId: string) => {
    visibleNodeIds.add(nodeId);
  };

  if (selectedNodeId) addPinnedNodeId(selectedNodeId);
  for (const nodeId of matchedNodeIds) addPinnedNodeId(nodeId);
  for (const node of sourceNodes) {
    if (node.nodeType === 'repo') addPinnedNodeId(node.id);
  }
  for (const { node } of rankedNodes) {
    if (visibleNodeIds.size >= densityLimit) break;
    addNodeId(node.id);
  }

  for (const edge of visibleEdgesByMode) {
    if (matchedNodeIds.has(edge.fromNodeId) || matchedNodeIds.has(edge.toNodeId) || edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId) {
      addPinnedNodeId(edge.fromNodeId);
      addPinnedNodeId(edge.toNodeId);
    }
  }

  const visibleNodes = sourceNodes.filter((node) => {
    if (!visibleNodeIds.has(node.id)) return false;
    return true;
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
      dimmed: false,
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
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<'overview' | 'ownership' | 'expertise' | 'deliverables'>('overview');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const inlineGraphRef = useRef<HTMLDivElement | null>(null);
  const expandedGraphRef = useRef<HTMLDivElement | null>(null);

  const degreeMap = useMemo(() => buildDegreeMap(graph, true), [graph]);
  const { nodes, edges } = useMemo(
    () => buildVisibleGraph(graph, searchTerm, graphMode, selectedNodeId),
    [graph, graphMode, searchTerm, selectedNodeId],
  );
  const stringLayout = useMemo(
    () => buildStringStyleProjectLayout(nodes, selectedNodeId),
    [nodes, selectedNodeId],
  );
  const stringNodeIds = useMemo(() => new Set(stringLayout.nodes.map((node) => node.id)), [stringLayout.nodes]);
  const renderedNodes = stringLayout.nodes;
  const renderedEdges = useMemo(
    () => edges.filter((edge) => stringNodeIds.has(edge.fromNodeId) && stringNodeIds.has(edge.toNodeId)),
    [edges, stringNodeIds],
  );
  const nodeMap = useMemo(() => new Map(renderedNodes.map((node) => [node.id, node])), [renderedNodes]);

  useEffect(() => {
    if (!selectedNodeId || nodeMap.has(selectedNodeId)) return;
    setSelectedNodeId(null);
  }, [nodeMap, selectedNodeId]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const hoveredNode = hoveredNodeId ? nodeMap.get(hoveredNodeId) ?? null : null;
  const infoNode = hoveredNode ?? selectedNode;
  const infoBox = infoNode ? getGraphInfoBoxSize(infoNode.label) : null;
  const infoBoxPosition = infoNode && infoBox ? getGraphInfoBoxPosition(infoNode, infoBox) : null;
  const selectedEdges = useMemo(
    () => selectedNode
      ? renderedEdges.filter((edge) => edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id)
      : [],
    [renderedEdges, selectedNode],
  );
  const selectedEdgeIds = useMemo(() => new Set(selectedEdges.map((edge) => edge.id)), [selectedEdges]);
  const selectedNeighbors = useMemo(
    () => selectedNode
      ? selectedEdges.reduce<Array<{
        edgeId: string;
        edgeType: string;
        weight: number;
        node: VisibleGraphNode;
      }>>((neighbors, edge) => {
        const relatedNodeId = edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.fromNodeId;
        const relatedNode = nodeMap.get(relatedNodeId);
        if (relatedNode) {
          neighbors.push({ edgeId: edge.id, edgeType: edge.edgeType, weight: edge.weight, node: relatedNode });
        }
        return neighbors;
      }, [])
      .sort((left, right) => right.node.degree - left.node.degree || left.node.label.localeCompare(right.node.label))
      : [],
    [nodeMap, selectedEdges, selectedNode],
  );
  const connectedNodeIds = useMemo(
    () => new Set(
      selectedNode
        ? [
          selectedNode.id,
          ...selectedNeighbors.map((neighbor) => neighbor.node.id),
        ]
        : [],
    ),
    [selectedNeighbors, selectedNode],
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

  if (!graph || graph.nodes.length === 0) {
    return <EmptyState text="Generate a coordination snapshot to populate the project knowledge graph." />;
  }

  const renderWorkspace = (fullscreen: boolean) => (
    <div className={`space-y-5 ${fullscreen ? 'flex h-full flex-col overflow-hidden' : ''}`}>
      <div className={`space-y-4 ${fullscreen ? 'shrink-0' : ''}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
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
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-colors ${graphMode === value ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface2 text-muted hover:text-heading'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="relative block w-full lg:max-w-[420px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Find people, tasks, LOEs, repos, or documents"
              className="w-full border border-border bg-surface2 py-2 pl-9 pr-3 text-sm text-heading outline-none transition-colors focus:border-accent/40"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted">Node types</span>
          {GRAPH_TYPE_ORDER.filter((nodeType) => renderedNodes.some((node) => node.nodeType === nodeType)).map((nodeType) => (
            <span key={nodeType} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getGraphNodeAccent(nodeType) }} />
              {GRAPH_TYPE_LABELS[nodeType]}
            </span>
          ))}
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
            <span>{hovering ? 'Scroll to zoom, drag to pan' : 'Structured string map'}</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <svg
            viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
            className={`${fullscreen ? 'h-[calc(100vh-22rem)] min-h-[640px]' : 'h-[620px]'} w-full select-none overflow-hidden`}
            role="group"
            aria-label="Interactive project knowledge graph"
          >
            <defs>
              <pattern
                id={`coordination-grid-${fullscreen ? 'expanded' : 'inline'}`}
                width="28"
                height="28"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 28 0 L 0 0 0 28" fill="none" stroke="var(--color-border)" strokeOpacity="0.2" strokeWidth="1" />
              </pattern>
              <filter id={`coordination-selected-glow-${fullscreen ? 'expanded' : 'inline'}`} x="-40%" y="-70%" width="180%" height="240%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id={`coordination-connected-glow-${fullscreen ? 'expanded' : 'inline'}`} x="-25%" y="-50%" width="150%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect
              x="0"
              y="0"
              width={GRAPH_VIEWBOX.width}
              height={GRAPH_VIEWBOX.height}
              fill={`url(#coordination-grid-${fullscreen ? 'expanded' : 'inline'})`}
              pointerEvents="none"
            />
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              <>
                  {stringLayout.cells.map((cell) => {
                    const lanePalette = getGraphLanePalette(cell.nodeType);
                    return (
                      <g key={cell.nodeType}>
                        <rect
                          x={cell.x}
                          y={cell.y}
                          width={cell.width}
                          height={cell.height}
                          rx={20}
                          fill={lanePalette.fill}
                          stroke={lanePalette.stroke}
                          strokeWidth="1.2"
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle cx={cell.x + 12} cy={cell.y - 12} r="3.5" fill={lanePalette.accent} />
                        <text
                          x={cell.x + 22}
                          y={cell.y - 8}
                          fill="var(--color-muted)"
                          fontSize="10"
                          fontWeight="600"
                          style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}
                        >
                          {cell.label}
                        </text>
                      </g>
                    );
                  })}

                  {renderedEdges.map((edge) => {
                    const from = nodeMap.get(edge.fromNodeId);
                    const to = nodeMap.get(edge.toNodeId);
                    if (!from || !to) return null;
                    const highlighted = selectedEdgeIds.has(edge.id);
                    const hovered = !selectedNode && Boolean(hoveredNode && (edge.fromNodeId === hoveredNode.id || edge.toNodeId === hoveredNode.id));
                    const emphasized = highlighted || hovered;
                    const edgeDimmed = Boolean(selectedNode && !highlighted);
                    const defaultWidth = Math.min(2.35, Math.max(1, 0.82 + Math.log2(Math.max(1, edge.weight) + 1) * 0.34));
                    return (
                      <path
                        key={edge.id}
                        d={buildStringStyleProjectEdgePath(from, to)}
                        fill="none"
                        stroke={edgeDimmed ? 'rgba(148, 163, 184, 0.07)' : getGraphEdgeColor(edge.edgeType, emphasized)}
                        strokeWidth={emphasized ? 3.2 : defaultWidth}
                        strokeLinecap="round"
                        opacity={edgeDimmed ? 0.45 : 1}
                        vectorEffect="non-scaling-stroke"
                        filter={highlighted ? `url(#coordination-connected-glow-${fullscreen ? 'expanded' : 'inline'})` : undefined}
                      >
                        <title>{`${from.label} — ${edge.edgeType.replaceAll('_', ' ')} — ${to.label}`}</title>
                      </path>
                    );
                  })}

                  {renderedNodes.map((node) => {
                    const selected = node.id === selectedNodeId;
                    const connected = connectedNodeIds.has(node.id) || node.matched;
                    const fadedBySelection = selectedNode ? !connectedNodeIds.has(node.id) : false;
                    const palette = getStringStyleNodePalette(node, selected);
                    return (
                      <g
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${GRAPH_TYPE_LABELS[node.nodeType] ?? node.nodeType}: ${node.label}. ${node.degree} connections.`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedNodeId((current) => current === node.id ? null : node.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedNodeId((current) => current === node.id ? null : node.id);
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
                        className="cursor-pointer outline-none"
                        opacity={fadedBySelection ? 0.24 : 1}
                      >
                        <title>{`${node.label} • ${GRAPH_TYPE_LABELS[node.nodeType] ?? node.nodeType} • ${node.degree} connections`}</title>
                        <rect
                          x={node.x - node.cardWidth / 2}
                          y={node.y - node.cardHeight / 2}
                          width={node.cardWidth}
                          height={node.cardHeight}
                          rx={node.nodeType === 'task' ? 18 : 16}
                          fill="var(--color-surface)"
                          stroke="none"
                        />
                        <rect
                          x={node.x - node.cardWidth / 2}
                          y={node.y - node.cardHeight / 2}
                          width={node.cardWidth}
                          height={node.cardHeight}
                          rx={node.nodeType === 'task' ? 18 : 16}
                          fill={palette.fill}
                          fillOpacity={connected ? 1 : 0.96}
                          stroke={palette.stroke}
                          strokeWidth={selected ? 2.5 : connected ? 2 : 1.45}
                          vectorEffect="non-scaling-stroke"
                          filter={selected
                            ? `url(#coordination-selected-glow-${fullscreen ? 'expanded' : 'inline'})`
                            : connected && selectedNode
                              ? `url(#coordination-connected-glow-${fullscreen ? 'expanded' : 'inline'})`
                              : undefined}
                        />
                        <rect
                          x={node.x - node.cardWidth / 2 + 1}
                          y={node.y - node.cardHeight / 2 + 1}
                          width={6}
                          height={node.cardHeight - 2}
                          rx={3}
                          fill={palette.stroke}
                          opacity={0.92}
                        />
                        <circle
                          cx={node.x - node.cardWidth / 2 + 18}
                          cy={node.y - 6}
                          r={4}
                          fill={palette.stroke}
                          opacity={0.95}
                        />
                        <text
                          x={node.x - node.cardWidth / 2 + 28}
                          y={node.y - 4}
                          fill={palette.text}
                          fontSize={node.nodeType === 'task' ? 12 : 11}
                          fontWeight="600"
                        >
                          {getStringStyleCardTitle(node)}
                        </text>
                        <text
                          x={node.x - node.cardWidth / 2 + 28}
                          y={node.y + 13}
                          fill={palette.meta}
                          fontSize="8"
                          style={{ letterSpacing: '0.11em', textTransform: 'uppercase' }}
                        >
                          {getStringStyleCardMeta(node)}
                        </text>
                        <text
                          x={node.x + node.cardWidth / 2 - 12}
                          y={node.y + 13}
                          textAnchor="end"
                          fill={palette.meta}
                          fontSize="8"
                          style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}
                        >
                          {node.degree}
                        </text>
                      </g>
                    );
                  })}
              </>

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
                        ? '1px solid rgba(245, 198, 106, 0.5)'
                        : '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      boxShadow: '0 14px 34px rgba(0,0,0,0.18)',
                      padding: '11px 12px',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
                      {hoveredNode ? 'Hover' : 'Selected'} • {GRAPH_TYPE_LABELS[infoNode.nodeType] ?? infoNode.nodeType}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '13px', lineHeight: 1.35, fontWeight: 600, color: 'var(--color-heading)', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
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
              <p>Nodes: <span className="text-heading">{graph.nodes.length}</span></p>
              <p>Edges: <span className="text-heading">{graph.edges.length}</span></p>
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
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                      Connected To • {selectedNeighbors.length}
                    </p>
                    <div className="space-y-2">
                      {selectedNeighbors.slice(0, 12).map((neighbor) => (
                        <div key={neighbor.edgeId} className="border border-border/80 bg-surface px-3 py-2 text-xs">
                          <p className="font-semibold text-heading">{neighbor.node.label}</p>
                          <p className="mt-1 text-muted">{neighbor.edgeType.replaceAll('_', ' ')} • weight {neighbor.weight}</p>
                        </div>
                      ))}
                    </div>
                    {selectedNeighbors.length > 12 && (
                      <p className="mt-2 text-xs text-muted">{selectedNeighbors.length - 12} more highlighted in the graph.</p>
                    )}
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
    <div className="space-y-5">
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
        <div className="grid gap-5">
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
