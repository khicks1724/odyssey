import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { EyeOff, Loader2, Maximize2, Network, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  fetchThesisKnowledgeGraph,
  type ThesisKnowledgeGraphEdge,
  type ThesisKnowledgeGraphNode,
  type ThesisKnowledgeGraphPayload,
} from '../lib/thesis-paper';
import { useTheme, type Theme } from '../lib/theme';

type SourceLibraryItem = {
  id: string;
  title: string;
  type: string;
  sourceKind: string;
  role: string;
  chapterTarget: string;
  credit: string;
  venue: string;
  year: string;
  locator: string;
  citation: string;
  abstract: string;
  notes: string;
  tags: string[];
  attachmentStoragePath: string;
};

type ThesisSupportingDocument = {
  id: string;
  title: string;
  description: string;
  contribution: string;
  extractedTextPreview: string;
  linkedSourceId: string | null;
  attachmentStoragePath: string;
};

type LinkedProject = {
  id: string;
  name: string;
  description: string | null;
  github_repo: string | null;
  github_repos: string[] | null;
};

type LinkedGoal = {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  deadline: string | null;
  status: string;
  progress: number;
  category: string | null;
  loe: string | null;
};

type LinkedEvent = {
  id: string;
  project_id: string;
  source: string;
  event_type: string;
  title: string | null;
  summary: string | null;
  occurred_at: string;
};

type ThesisKnowledgeTabProps = {
  sourceLibrary: SourceLibraryItem[];
  supportingDocuments: ThesisSupportingDocument[];
  linkedProjects: LinkedProject[];
  linkedGoals: LinkedGoal[];
  linkedEvents: LinkedEvent[];
};

type PositionedNode = ThesisKnowledgeGraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisibleNodeKind = Exclude<ThesisKnowledgeGraphNode['kind'], 'chapter' | 'reference'>;
type PanelConfig = Record<VisibleNodeKind, {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
}>;

const GRAPH_VIEWBOX_WIDTH = 1500;
const PANEL_INSET_X = 18;
const PANEL_INSET_Y = 18;
const NODE_GAP_X = 16;
const NODE_GAP_Y = 16;
const PANEL_STACK_GAP_Y = 42;
const THESIS_KNOWLEDGE_HIDDEN_NODES_STORAGE_KEY = 'odyssey-thesis-knowledge-hidden-node-ids';
const THESIS_KNOWLEDGE_GRAPH_CACHE_STORAGE_KEY = 'odyssey-thesis-knowledge-graph-cache';
const THESIS_KNOWLEDGE_GRAPH_SIGNATURE_STORAGE_KEY = 'odyssey-thesis-knowledge-graph-signature';

const nodeKindOrder: VisibleNodeKind[] = ['credit', 'theme', 'source', 'project', 'repo', 'document'];
const kindPanelBase = {
  credit: { label: 'Authors / Organizations', x: 44, y: 92, width: 292, columns: 2, minHeight: 368, minCellHeight: 62 },
  theme: { label: 'Themes', x: 372, y: 52, width: 520, columns: 2, minHeight: 208, minCellHeight: 80 },
  source: { label: 'Sources', x: 372, y: 0, width: 520, columns: 2, minHeight: 188, minCellHeight: 76 },
  project: { label: 'Linked Projects', x: 372, y: 0, width: 520, columns: 2, minHeight: 168, minCellHeight: 74 },
  repo: { label: 'Repos', x: 928, y: 0, width: 356, columns: 2, minHeight: 168, minCellHeight: 70 },
  document: { label: 'Documents', x: 928, y: 92, width: 356, columns: 2, minHeight: 284, minCellHeight: 70 },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string) {
  const normalizedInput = hex.trim();
  const rgbMatch = normalizedInput.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i);
  if (rgbMatch) {
    return {
      r: Number.parseFloat(rgbMatch[1] ?? '0'),
      g: Number.parseFloat(rgbMatch[2] ?? '0'),
      b: Number.parseFloat(rgbMatch[3] ?? '0'),
    };
  }

  const normalized = normalizedInput.replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function mixColors(base: string, tint: string, ratio: number) {
  const left = hexToRgb(base);
  const right = hexToRgb(tint);
  if (!left || !right) return base;
  const boundedRatio = clamp(ratio, 0, 1);
  const channel = (from: number, to: number) => Math.round(from + (to - from) * boundedRatio);
  return `rgb(${channel(left.r, right.r)}, ${channel(left.g, right.g)}, ${channel(left.b, right.b)})`;
}

function withAlpha(color: string, alpha: number) {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1)})`;
}

function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(a: string, b: string) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableText(background: string, primary: string, alternate: string) {
  return contrastRatio(background, primary) >= contrastRatio(background, alternate) ? primary : alternate;
}

type GraphNodePalette = {
  fill: string;
  stroke: string;
  text: string;
  meta: string;
};

type GraphPalette = {
  canvasBackground: string;
  expandedBackdrop: string;
  panelFill: string;
  panelStroke: string;
  panelLabel: string;
  edge: string;
  edgeHighlight: string;
  selected: GraphNodePalette;
  kinds: Record<VisibleNodeKind, GraphNodePalette>;
};

function buildGraphPalette(theme: Theme): GraphPalette {
  const { colors, colorScheme } = theme;
  const isDarkTheme = (colorScheme ?? (relativeLuminance(colors.bg) < 0.2 ? 'dark' : 'light')) === 'dark';
  const isClaudeTheme = theme.id === 'claude-dark' || theme.id === 'claude-light';
  const metaText = isDarkTheme
    ? mixColors(colors.muted, colors.heading, 0.22)
    : mixColors(colors.muted, colors.heading, 0.12);
  const panelFill = isDarkTheme
    ? mixColors(colors.surface2, colors.heading, 0.32)
    : mixColors(colors.surface, colors.border, 0.24);
  const panelStroke = isDarkTheme
    ? mixColors(colors.border, colors.heading, 0.14)
    : mixColors(colors.border, colors.heading, 0.08);
  const selectedFill = isDarkTheme
    ? mixColors(colors.surface2, colors.accent, 0.78)
    : mixColors(colors.surface2, colors.accent, 0.88);
  const selectedText = pickReadableText(selectedFill, colors.heading, colors.bg);
  const kindAnchors: Record<VisibleNodeKind, string> = isClaudeTheme
    ? {
      credit: '#ba6d5c',
      theme: '#8d7463',
      source: '#c6a46a',
      project: '#d18659',
      repo: '#a18472',
      document: '#d9c09b',
    }
    : {
      credit: '#c86a63',
      theme: '#5f84c7',
      source: '#c8ad4c',
      project: '#d4874f',
      repo: '#6d79bc',
      document: '#5d9d7b',
    };
  const blendWithThemeColor = (anchor: string, themeColor: string, themeRatio: number) => mixColors(anchor, themeColor, themeRatio);
  const kindBase: Record<VisibleNodeKind, string> = isClaudeTheme
    ? {
      credit: blendWithThemeColor(kindAnchors.credit, colors.accent, 0.26),
      theme: blendWithThemeColor(kindAnchors.theme, colors.muted, 0.24),
      source: blendWithThemeColor(kindAnchors.source, colors.heading, 0.08),
      project: blendWithThemeColor(kindAnchors.project, colors.accent, 0.3),
      repo: blendWithThemeColor(kindAnchors.repo, colors.border, 0.18),
      document: blendWithThemeColor(kindAnchors.document, colors.accent3, 0.12),
    }
    : {
      credit: blendWithThemeColor(kindAnchors.credit, colors.accent, 0.16),
      theme: blendWithThemeColor(kindAnchors.theme, colors.accent2, 0.18),
      source: blendWithThemeColor(kindAnchors.source, colors.accent, 0.08),
      project: blendWithThemeColor(kindAnchors.project, colors.danger, 0.18),
      repo: blendWithThemeColor(kindAnchors.repo, colors.accent2, 0.18),
      document: blendWithThemeColor(kindAnchors.document, colors.accent3, 0.12),
    };
  const kindFill = (kind: VisibleNodeKind, darkRatio: number, lightRatio: number) => (
    mixColors(colors.surface2, kindBase[kind], isDarkTheme ? darkRatio : lightRatio)
  );
  const kindStroke = (kind: VisibleNodeKind, darkRatio: number, lightRatio: number) => (
    mixColors(colors.border, kindBase[kind], isDarkTheme ? darkRatio : lightRatio)
  );

  return {
    canvasBackground: colors.bg,
    expandedBackdrop: isDarkTheme ? withAlpha(colors.bg, 0.94) : withAlpha(colors.heading, 0.24),
    panelFill,
    panelStroke,
    panelLabel: isDarkTheme ? mixColors(colors.muted, colors.heading, 0.34) : colors.muted,
    edge: isDarkTheme
      ? withAlpha(mixColors(colors.border, colors.accent2, 0.34), 0.46)
      : withAlpha(mixColors(colors.border, colors.heading, 0.18), 0.42),
    edgeHighlight: isDarkTheme
      ? withAlpha(mixColors(colors.accent2, colors.heading, 0.22), 0.82)
      : withAlpha(mixColors(colors.accent2, colors.heading, 0.08), 0.78),
    selected: {
      fill: selectedFill,
      stroke: isDarkTheme ? mixColors(colors.accent, colors.heading, 0.2) : colors.accent,
      text: selectedText,
      meta: withAlpha(selectedText, 0.76),
    },
    kinds: {
      credit: {
        fill: kindFill('credit', 0.44, 0.4),
        stroke: kindStroke('credit', 0.74, 0.66),
        text: colors.heading,
        meta: metaText,
      },
      theme: {
        fill: kindFill('theme', 0.42, 0.36),
        stroke: kindStroke('theme', 0.72, 0.62),
        text: colors.heading,
        meta: metaText,
      },
      source: {
        fill: kindFill('source', 0.42, 0.34),
        stroke: kindStroke('source', 0.7, 0.58),
        text: colors.heading,
        meta: metaText,
      },
      project: {
        fill: kindFill('project', 0.44, 0.38),
        stroke: kindStroke('project', 0.74, 0.64),
        text: colors.heading,
        meta: metaText,
      },
      repo: {
        fill: kindFill('repo', 0.4, 0.34),
        stroke: kindStroke('repo', 0.7, 0.6),
        text: colors.heading,
        meta: metaText,
      },
      document: {
        fill: kindFill('document', 0.42, 0.34),
        stroke: kindStroke('document', 0.72, 0.6),
        text: colors.heading,
        meta: metaText,
      },
    },
  };
}

function titleCase(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatKindLabel(kind: ThesisKnowledgeGraphNode['kind']) {
  if (kind === 'credit') return 'Author / org';
  if (kind === 'reference') return 'Shared citation';
  if (kind === 'project') return 'Linked project';
  if (kind === 'repo') return 'Repo';
  return kind;
}

function getRepoLeafLabel(label: string) {
  const segments = label.split('/').map((segment) => segment.trim()).filter(Boolean);
  return segments[segments.length - 1] || label;
}

function getSharedRepoLabelPrefix(nodes: ThesisKnowledgeGraphNode[]) {
  const repoLabels = nodes
    .filter((node) => node.kind === 'repo')
    .map((node) => getRepoLeafLabel(node.label))
    .filter(Boolean);
  if (repoLabels.length < 2) return '';

  let prefix = repoLabels[0] ?? '';
  for (const label of repoLabels.slice(1)) {
    let index = 0;
    const maxLength = Math.min(prefix.length, label.length);
    while (index < maxLength && prefix[index] === label[index]) index += 1;
    prefix = prefix.slice(0, index);
    if (!prefix) return '';
  }

  const boundaryIndex = Math.max(
    prefix.lastIndexOf('-'),
    prefix.lastIndexOf('_'),
    prefix.lastIndexOf(' '),
  );
  if (boundaryIndex <= 0) return '';

  const boundedPrefix = prefix.slice(0, boundaryIndex + 1).trimStart();
  return boundedPrefix.length >= 4 ? boundedPrefix : '';
}

function getNodeDisplayLabel(node: Pick<ThesisKnowledgeGraphNode, 'kind' | 'label'>, repoLabelPrefix = '') {
  if (node.kind !== 'repo') return node.label;
  const leafLabel = getRepoLeafLabel(node.label);
  if (repoLabelPrefix && leafLabel.toLowerCase().startsWith(repoLabelPrefix.toLowerCase())) {
    const trimmedLabel = leafLabel.slice(repoLabelPrefix.length).trim();
    if (trimmedLabel) return trimmedLabel;
  }
  return leafLabel;
}

function getNodeDimensions(node: ThesisKnowledgeGraphNode, repoLabelPrefix = '') {
  const displayLabel = getNodeDisplayLabel(node, repoLabelPrefix);
  const baseWidth = node.kind === 'source'
    ? 196
    : node.kind === 'theme'
      ? 184
      : node.kind === 'repo'
        ? 152
      : node.kind === 'reference' || node.kind === 'project'
        ? 176
      : node.kind === 'chapter'
        ? 176
        : 170;
  const width = clamp(baseWidth + Math.max(0, displayLabel.length - 14) * 2.35, 138, 238);
  const height = node.kind === 'source'
    ? 80
    : node.kind === 'theme' || node.kind === 'document' || node.kind === 'project' || node.kind === 'repo'
      ? 74
      : node.kind === 'reference'
        ? 56
        : 68;
  return { width, height };
}

function getNodeLabelFontSize(node: PositionedNode) {
  if (node.kind === 'source') return 13;
  if (node.kind === 'repo') return 11.5;
  if (node.kind === 'credit') return 11.75;
  return 12;
}

function getNodeLabelLineHeight(node: PositionedNode) {
  if (node.kind === 'source') return 14;
  return 13;
}

function buildNodeColor(node: ThesisKnowledgeGraphNode, selected: boolean, palette: GraphPalette) {
  if (selected) {
    return palette.selected;
  }
  if (node.kind === 'credit' || node.kind === 'theme' || node.kind === 'source' || node.kind === 'project' || node.kind === 'repo' || node.kind === 'document') {
    return palette.kinds[node.kind];
  }
  return palette.kinds.source;
}

function getNodeLabelLimit(node: PositionedNode) {
  const availableWidth = Math.max(72, node.width - 34);
  const estimatedCharacterWidth = node.kind === 'source' ? 7.2 : 6.6;
  return Math.max(12, Math.floor(availableWidth / estimatedCharacterWidth));
}

function wrapNodeLabel(label: string, limit: number, maxLines = 2) {
  const normalized = label.trim();
  if (!normalized) return [''];
  if (normalized.length <= limit) return [normalized];

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [normalized.slice(0, Math.max(1, limit - 1)) + '…'];

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= limit) {
      currentLine = nextLine;
      continue;
    }

    if (!currentLine) {
      lines.push(`${word.slice(0, Math.max(1, limit - 1))}…`);
    } else {
      lines.push(currentLine);
      currentLine = word;
    }

    if (lines.length === maxLines) {
      return lines.map((line, index) => (
        index === maxLines - 1 && !line.endsWith('…') ? `${line.slice(0, Math.max(1, limit - 1))}…` : line
      ));
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) return lines;

  return [
    ...lines.slice(0, maxLines - 1),
    `${lines[maxLines - 1].slice(0, Math.max(1, limit - 1))}…`,
  ];
}

function buildEdgePath(source: PositionedNode, target: PositionedNode) {
  const startX = source.x;
  const startY = source.y;
  const endX = target.x;
  const endY = target.y;
  const deltaX = endX - startX;
  const curvature = clamp(Math.abs(deltaX) * 0.34, 90, 210);
  const controlX1 = startX + curvature;
  const controlY1 = startY;
  const controlX2 = endX - curvature;
  const controlY2 = endY;
  return `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
}

function resolvePanelColumns(width: number, preferredColumns: number, itemCount: number) {
  const maxColumnsByWidth = Math.max(
    1,
    Math.floor((width - PANEL_INSET_X * 2 + NODE_GAP_X) / (146 + NODE_GAP_X)),
  );
  return Math.max(1, Math.min(Math.max(preferredColumns, maxColumnsByWidth), Math.max(itemCount, 1)));
}

function calculatePanelRows(itemCount: number, columns: number) {
  return Math.max(1, Math.ceil(Math.max(itemCount, 1) / columns));
}

function calculatePanelHeight(itemCount: number, columns: number, minHeight: number, minCellHeight: number) {
  const rows = calculatePanelRows(itemCount, columns);
  const naturalHeight = PANEL_INSET_Y * 2 + rows * minCellHeight + Math.max(0, rows - 1) * NODE_GAP_Y;
  const relaxedMinRows = Math.min(rows, 2);
  const relaxedMinHeight = Math.min(
    minHeight,
    PANEL_INSET_Y * 2 + relaxedMinRows * minCellHeight + Math.max(0, relaxedMinRows - 1) * NODE_GAP_Y + 36,
  );
  return Math.max(naturalHeight, relaxedMinHeight);
}

function buildKindPanelConfig(nodes: ThesisKnowledgeGraphNode[]) {
  const themeCount = nodes.filter((node) => node.kind === 'theme').length;
  const sourceCount = nodes.filter((node) => node.kind === 'source').length;
  const projectCount = nodes.filter((node) => node.kind === 'project').length;
  const repoCount = nodes.filter((node) => node.kind === 'repo').length;
  const creditCount = nodes.filter((node) => node.kind === 'credit').length;
  const documentCount = nodes.filter((node) => node.kind === 'document').length;

  const themeColumns = resolvePanelColumns(kindPanelBase.theme.width, kindPanelBase.theme.columns, themeCount);
  const themeHeight = calculatePanelHeight(
    themeCount,
    themeColumns,
    kindPanelBase.theme.minHeight,
    kindPanelBase.theme.minCellHeight,
  );
  const sourceY = kindPanelBase.theme.y + themeHeight + PANEL_STACK_GAP_Y;
  const sourceColumns = resolvePanelColumns(kindPanelBase.source.width, kindPanelBase.source.columns, sourceCount);
  const sourceHeight = calculatePanelHeight(
    sourceCount,
    sourceColumns,
    kindPanelBase.source.minHeight,
    kindPanelBase.source.minCellHeight,
  );
  const projectY = sourceY + sourceHeight + PANEL_STACK_GAP_Y;
  const projectColumns = resolvePanelColumns(kindPanelBase.project.width, kindPanelBase.project.columns, projectCount);
  const projectHeight = calculatePanelHeight(
    projectCount,
    projectColumns,
    kindPanelBase.project.minHeight,
    kindPanelBase.project.minCellHeight,
  );
  const documentColumns = resolvePanelColumns(kindPanelBase.document.width, kindPanelBase.document.columns, documentCount);
  const documentHeight = calculatePanelHeight(
    documentCount,
    documentColumns,
    kindPanelBase.document.minHeight,
    kindPanelBase.document.minCellHeight,
  );
  const repoY = kindPanelBase.document.y + documentHeight + PANEL_STACK_GAP_Y;
  const repoColumns = resolvePanelColumns(kindPanelBase.repo.width, kindPanelBase.repo.columns, repoCount);
  const repoHeight = calculatePanelHeight(
    repoCount,
    repoColumns,
    kindPanelBase.repo.minHeight,
    kindPanelBase.repo.minCellHeight,
  );
  const creditColumns = resolvePanelColumns(kindPanelBase.credit.width, kindPanelBase.credit.columns, creditCount);
  const creditHeight = calculatePanelHeight(
    creditCount,
    creditColumns,
    kindPanelBase.credit.minHeight,
    kindPanelBase.credit.minCellHeight,
  );
  const middleColumnBottom = projectY + projectHeight;
  const rightColumnBottom = repoY + repoHeight;
  const leftColumnBottom = kindPanelBase.credit.y + creditHeight;

  const panelConfig: PanelConfig = {
    credit: {
      label: kindPanelBase.credit.label,
      x: kindPanelBase.credit.x,
      y: kindPanelBase.credit.y,
      width: kindPanelBase.credit.width,
      height: creditHeight,
      columns: creditColumns,
    },
    theme: {
      label: kindPanelBase.theme.label,
      x: kindPanelBase.theme.x,
      y: kindPanelBase.theme.y,
      width: kindPanelBase.theme.width,
      height: themeHeight,
      columns: themeColumns,
    },
    source: {
      label: kindPanelBase.source.label,
      x: kindPanelBase.source.x,
      y: sourceY,
      width: kindPanelBase.source.width,
      height: sourceHeight,
      columns: sourceColumns,
    },
    project: {
      label: kindPanelBase.project.label,
      x: kindPanelBase.project.x,
      y: projectY,
      width: kindPanelBase.project.width,
      height: projectHeight,
      columns: projectColumns,
    },
    repo: {
      label: kindPanelBase.repo.label,
      x: kindPanelBase.repo.x,
      y: repoY,
      width: kindPanelBase.repo.width,
      height: repoHeight,
      columns: repoColumns,
    },
    document: {
      label: kindPanelBase.document.label,
      x: kindPanelBase.document.x,
      y: kindPanelBase.document.y,
      width: kindPanelBase.document.width,
      height: documentHeight,
      columns: documentColumns,
    },
  };

  const viewboxHeight = Math.max(
    middleColumnBottom + 64,
    rightColumnBottom + 64,
    leftColumnBottom + 64,
  );

  return { panelConfig, viewboxHeight };
}

function positionLaneNodes(
  nodes: ThesisKnowledgeGraphNode[],
  kind: VisibleNodeKind,
  panelConfig: PanelConfig,
  repoLabelPrefix: string,
) {
  const config = panelConfig[kind];
  const ordered = [...nodes].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  if (ordered.length === 0) return [];

  const columns = Math.max(1, Math.min(config.columns, ordered.length));
  const rowCount = Math.max(1, Math.ceil(ordered.length / columns));
  const usableWidth = config.width - PANEL_INSET_X * 2;
  const usableHeight = config.height - PANEL_INSET_Y * 2;
  const cellWidth = (usableWidth - NODE_GAP_X * Math.max(0, columns - 1)) / columns;
  const cellHeight = (usableHeight - NODE_GAP_Y * Math.max(0, rowCount - 1)) / rowCount;

  return ordered.map<PositionedNode>((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const desiredDimensions = getNodeDimensions(node, repoLabelPrefix);
    const width = Math.min(desiredDimensions.width, cellWidth);
    const height = Math.min(desiredDimensions.height, cellHeight);
    const cellX = config.x + PANEL_INSET_X + column * (cellWidth + NODE_GAP_X);
    const cellY = config.y + PANEL_INSET_Y + row * (cellHeight + NODE_GAP_Y);
    const x = cellX + cellWidth / 2;
    const y = cellY + cellHeight / 2;

    return {
      ...node,
      x,
      y,
      width,
      height,
    };
  });
}

function layoutNodes(nodes: ThesisKnowledgeGraphNode[], panelConfig: PanelConfig, repoLabelPrefix: string) {
  const positioned: PositionedNode[] = [];
  for (const kind of nodeKindOrder) {
    positioned.push(...positionLaneNodes(
      nodes.filter((node) => node.kind === kind),
      kind,
      panelConfig,
      repoLabelPrefix,
    ));
  }
  return positioned;
}

function pruneHiddenGraph(graph: ThesisKnowledgeGraphPayload): ThesisKnowledgeGraphPayload {
  const nodes = graph.nodes.filter((node) => node.kind !== 'chapter');
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    ...graph,
    nodes,
    edges,
  };
}

function readStoredHiddenNodeIds() {
  if (typeof window === 'undefined') return [];

  try {
    const rawValue = window.localStorage.getItem(THESIS_KNOWLEDGE_HIDDEN_NODES_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

function isKnowledgeGraphPayload(value: unknown): value is ThesisKnowledgeGraphPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.nodes)
    && Array.isArray(candidate.edges)
    && Array.isArray(candidate.themes)
    && Array.isArray(candidate.coverage)
    && Array.isArray(candidate.insights)
    && Array.isArray(candidate.sourceBriefs)
    && typeof candidate.generatedAt === 'string';
}

function readStoredGraphCache() {
  if (typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(THESIS_KNOWLEDGE_GRAPH_CACHE_STORAGE_KEY);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    if (!isKnowledgeGraphPayload(parsed)) return null;
    return pruneHiddenGraph(parsed);
  } catch {
    return null;
  }
}

function writeStoredGraphCache(graph: ThesisKnowledgeGraphPayload, signature: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THESIS_KNOWLEDGE_GRAPH_CACHE_STORAGE_KEY, JSON.stringify(graph));
  window.localStorage.setItem(THESIS_KNOWLEDGE_GRAPH_SIGNATURE_STORAGE_KEY, signature);
}

function buildKnowledgeGraphContextSignature({
  sourceLibrary,
  supportingDocuments,
  linkedProjects,
  linkedGoals,
  linkedEvents,
}: ThesisKnowledgeTabProps) {
  return JSON.stringify({
    sourceLibrary: [...sourceLibrary]
      .map((item) => ({
        id: item.id,
        title: item.title,
        sourceKind: item.sourceKind,
        role: item.role,
        chapterTarget: item.chapterTarget,
        credit: item.credit,
        venue: item.venue,
        year: item.year,
        locator: item.locator,
        citation: item.citation,
        abstract: item.abstract,
        notes: item.notes,
        tags: [...item.tags].sort((left, right) => left.localeCompare(right)),
        attachmentStoragePath: item.attachmentStoragePath,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    supportingDocuments: [...supportingDocuments]
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        contribution: item.contribution,
        extractedTextPreview: item.extractedTextPreview,
        linkedSourceId: item.linkedSourceId,
        attachmentStoragePath: item.attachmentStoragePath,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    linkedProjects: [...linkedProjects]
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        github_repo: item.github_repo,
        github_repos: [...(item.github_repos ?? [])].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    linkedGoals: [...linkedGoals]
      .map((item) => ({
        id: item.id,
        project_id: item.project_id,
        title: item.title,
        description: item.description ?? null,
        deadline: item.deadline,
        status: item.status,
        progress: item.progress,
        category: item.category,
        loe: item.loe,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    linkedEvents: [...linkedEvents]
      .map((item) => ({
        id: item.id,
        project_id: item.project_id,
        source: item.source,
        event_type: item.event_type,
        title: item.title,
        summary: item.summary,
        occurred_at: item.occurred_at,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export default function ThesisKnowledgeTab({
  sourceLibrary,
  supportingDocuments,
  linkedProjects,
  linkedGoals,
  linkedEvents,
}: ThesisKnowledgeTabProps) {
  const { theme } = useTheme();
  const [graph, setGraph] = useState<ThesisKnowledgeGraphPayload | null>(() => readStoredGraphCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>(() => readStoredHiddenNodeIds());
  const [showHiddenNodes, setShowHiddenNodes] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [expandedGraphViewport, setExpandedGraphViewport] = useState({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const expandedGraphContainerRef = useRef<HTMLDivElement | null>(null);
  const graphPanRef = useRef<{
    startX: number;
    startY: number;
    originTranslateX: number;
    originTranslateY: number;
  } | null>(null);
  const graphContextSignature = useMemo(() => buildKnowledgeGraphContextSignature({
    sourceLibrary,
    supportingDocuments,
    linkedProjects,
    linkedGoals,
    linkedEvents,
  }), [linkedEvents, linkedGoals, linkedProjects, sourceLibrary, supportingDocuments]);

  useEffect(() => {
    let cancelled = false;

    if (graph) {
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (sourceLibrary.length === 0 && supportingDocuments.length === 0) {
      setGraph(null);
      setSelectedNodeId(null);
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadGraph = async () => {
      setLoading(true);
      setError(null);
      try {
        const nextGraph = pruneHiddenGraph(await fetchThesisKnowledgeGraph({
          sourceLibrary,
          thesisDocuments: supportingDocuments,
          linkedProjects,
          linkedGoals,
          linkedEvents,
        }));
        if (cancelled) return;
        writeStoredGraphCache(nextGraph, graphContextSignature);
        setGraph(nextGraph);
        setSelectedNodeId((current) => (current && nextGraph.nodes.some((node) => node.id === current) ? current : nextGraph.nodes[0]?.id ?? null));
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to build the thesis knowledge graph.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadGraph();

    return () => {
      cancelled = true;
    };
  }, [graph, graphContextSignature, linkedEvents, linkedGoals, linkedProjects, sourceLibrary, supportingDocuments]);

  useEffect(() => {
    if (!graph) {
      setShowHiddenNodes(false);
      return;
    }

    const availableIds = new Set(graph.nodes.map((node) => node.id));
    setHiddenNodeIds((current) => current.filter((id) => availableIds.has(id)));
  }, [graph]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THESIS_KNOWLEDGE_HIDDEN_NODES_STORAGE_KEY, JSON.stringify(hiddenNodeIds));
  }, [hiddenNodeIds]);

  useEffect(() => {
    if (!graphExpanded) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGraphExpanded(false);
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const currentPan = graphPanRef.current;
      if (!currentPan) return;
      setExpandedGraphViewport((current) => ({
        ...current,
        translateX: currentPan.originTranslateX + (event.clientX - currentPan.startX),
        translateY: currentPan.originTranslateY + (event.clientY - currentPan.startY),
      }));
    };

    const handleMouseUp = () => {
      graphPanRef.current = null;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.overflow = previousOverflow;
      graphPanRef.current = null;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [graphExpanded]);

  const visibleGraph = useMemo(() => {
    if (!graph) return null;
    if (hiddenNodeIds.length === 0) return graph;

    const hiddenIds = new Set(hiddenNodeIds);
    const nodes = graph.nodes.filter((node) => !hiddenIds.has(node.id));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    return {
      ...graph,
      nodes,
      edges,
    };
  }, [graph, hiddenNodeIds]);

  const hiddenNodes = useMemo(() => {
    if (!graph || hiddenNodeIds.length === 0) return [];
    const hiddenIdSet = new Set(hiddenNodeIds);
    return graph.nodes.filter((node) => hiddenIdSet.has(node.id));
  }, [graph, hiddenNodeIds]);

  useEffect(() => {
    if (!visibleGraph) {
      setSelectedNodeId(null);
      return;
    }

    if (selectedNodeId && !visibleGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(visibleGraph.nodes[0]?.id ?? null);
    }
  }, [selectedNodeId, visibleGraph]);

  const graphLayout = useMemo(
    () => buildKindPanelConfig(visibleGraph?.nodes ?? []),
    [visibleGraph],
  );

  const repoLabelPrefix = useMemo(
    () => getSharedRepoLabelPrefix(visibleGraph?.nodes ?? []),
    [visibleGraph],
  );

  const positionedNodes = useMemo(
    () => (visibleGraph ? layoutNodes(visibleGraph.nodes, graphLayout.panelConfig, repoLabelPrefix) : []),
    [graphLayout.panelConfig, repoLabelPrefix, visibleGraph],
  );

  const positionedNodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes],
  );

  const visibleEdges = useMemo(() => {
    if (!visibleGraph) return [];
    return visibleGraph.edges
      .map((edge) => {
        const source = positionedNodeMap.get(edge.source);
        const target = positionedNodeMap.get(edge.target);
        if (!source || !target) return null;
        return { edge, source, target };
      })
      .filter((item): item is { edge: ThesisKnowledgeGraphEdge; source: PositionedNode; target: PositionedNode } => Boolean(item));
  }, [visibleGraph, positionedNodeMap]);

  const selectedNode = useMemo(
    () => positionedNodes.find((node) => node.id === selectedNodeId) ?? null,
    [positionedNodes, selectedNodeId],
  );

  const selectedNodeLinks = useMemo(() => {
    if (!visibleGraph || !selectedNode) return [];
    const connectedIds = new Set<string>();
    for (const edge of visibleGraph.edges) {
      if (edge.source === selectedNode.id) connectedIds.add(edge.target);
      if (edge.target === selectedNode.id) connectedIds.add(edge.source);
    }
    return visibleGraph.nodes.filter((node) => connectedIds.has(node.id)).slice(0, 8);
  }, [visibleGraph, selectedNode]);

  const graphPalette = useMemo(() => buildGraphPalette(theme), [theme]);

  const hideNode = (nodeId: string) => {
    setHiddenNodeIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
    if (selectedNodeId === nodeId) {
      const nextVisibleNode = visibleGraph?.nodes.find((node) => node.id !== nodeId) ?? null;
      setSelectedNodeId(nextVisibleNode?.id ?? null);
    }
  };

  const unhideNode = (nodeId: string) => {
    setHiddenNodeIds((current) => current.filter((id) => id !== nodeId));
    setSelectedNodeId(nodeId);
  };

  const openExpandedGraph = () => {
    setExpandedGraphViewport({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    setGraphExpanded(true);
  };

  const handleExpandedGraphWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = expandedGraphContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 0.9;

    setExpandedGraphViewport((current) => {
      const nextScale = clamp(current.scale * factor, 0.75, 3.25);
      const contentX = (pointerX - current.translateX) / current.scale;
      const contentY = (pointerY - current.translateY) / current.scale;

      return {
        scale: nextScale,
        translateX: pointerX - contentX * nextScale,
        translateY: pointerY - contentY * nextScale,
      };
    });
  };

  const handleExpandedGraphMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-graph-node="true"]')) return;

    graphPanRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originTranslateX: expandedGraphViewport.translateX,
      originTranslateY: expandedGraphViewport.translateY,
    };
  };

  const handleGraphClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement | null;
    if (target?.closest('[data-graph-node="true"]')) return;
    setSelectedNodeId(null);
  };

  const graphScene = (
    <>
      {Object.entries(graphLayout.panelConfig).map(([kind, config]) => (
        <g key={kind}>
          <rect
            x={config.x}
            y={config.y}
            width={config.width}
            height={config.height}
            rx={24}
            fill={graphPalette.panelFill}
            stroke={graphPalette.panelStroke}
          />
          <text x={config.x + 20} y={config.y - 14} fill={graphPalette.panelLabel} fontSize="12" style={{ letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            {config.label}
          </text>
        </g>
      ))}

      {visibleEdges.map(({ edge, source, target }) => {
        const highlighted = selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);
        return (
          <path
            key={edge.id}
            d={buildEdgePath(source, target)}
            fill="none"
            stroke={highlighted ? graphPalette.edgeHighlight : graphPalette.edge}
            strokeWidth={highlighted ? 3 : Math.max(1.2, edge.strength * 1.15)}
            strokeLinecap="round"
            opacity={highlighted ? 1 : 0.82}
          />
        );
      })}

      {positionedNodes.map((node) => {
        const selected = node.id === selectedNodeId;
        const palette = buildNodeColor(node, selected, graphPalette);
        const labelLimit = getNodeLabelLimit(node);
        const labelLines = wrapNodeLabel(getNodeDisplayLabel(node, repoLabelPrefix), labelLimit, 2);
        const labelFontSize = getNodeLabelFontSize(node);
        const labelLineHeight = getNodeLabelLineHeight(node);
        const nodeTop = node.y - node.height / 2;
        const nodeLeft = node.x - node.width / 2 + 16;
        return (
          <g
            key={node.id}
            data-graph-node="true"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedNodeId(node.id);
            }}
            className="cursor-pointer"
          >
            <rect
              x={node.x - node.width / 2}
              y={node.y - node.height / 2}
              width={node.width}
              height={node.height}
              rx={node.kind === 'source' ? 20 : 18}
              fill={palette.fill}
              stroke={palette.stroke}
              strokeWidth={selected ? 2.5 : 1.25}
            />
            <text
              x={nodeLeft}
              y={nodeTop + 16}
              fill={palette.meta}
              fontSize="9.5"
              style={{ letterSpacing: '0.16em', textTransform: 'uppercase' }}
            >
              {titleCase(formatKindLabel(node.kind))}
            </text>
            <text
              x={nodeLeft}
              y={nodeTop + 35}
              fill={palette.text}
              fontSize={labelFontSize}
              fontWeight="600"
            >
              {labelLines.map((line, index) => (
                <tspan key={`${node.id}-line-${index}`} x={nodeLeft} dy={index === 0 ? 0 : labelLineHeight}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </>
  );

  if (sourceLibrary.length === 0 && supportingDocuments.length === 0 && !graph) {
    return (
      <div className="border border-dashed border-border bg-surface px-6 py-16 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center border border-border bg-surface2">
          <Network size={18} className="text-accent" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-heading">Knowledge graph will populate from thesis evidence</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Add thesis sources or supporting documents first. Odyssey will then compile URL metadata, uploaded PDF context,
          document previews, and citation structure into a connected evidence map here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:gap-x-0 xl:items-stretch">
      <div className="flex h-full flex-col border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-accent" />
              <h2 className="font-sans text-sm font-bold text-heading">Evidence Knowledge Graph</h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHiddenNodes((current) => !current)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-border bg-surface2 px-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface"
              aria-label={showHiddenNodes ? 'Hide hidden nodes tray' : 'Show hidden nodes tray'}
              title={showHiddenNodes ? 'Hide hidden nodes tray' : 'Show hidden nodes tray'}
            >
              <EyeOff size={11} />
              Hidden
              {hiddenNodes.length > 0 && (
                <span className="inline-flex min-w-[1rem] items-center justify-center border border-border bg-surface px-1 py-0.5 text-[8px] text-heading">
                  {hiddenNodes.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setLoading(true);
                void fetchThesisKnowledgeGraph({
                  sourceLibrary,
                  thesisDocuments: supportingDocuments,
                  linkedProjects,
                  linkedGoals,
                  linkedEvents,
                })
                  .then((nextGraph) => {
                    const prunedGraph = pruneHiddenGraph(nextGraph);
                    writeStoredGraphCache(prunedGraph, graphContextSignature);
                    setGraph(prunedGraph);
                    setSelectedNodeId((current) => (
                      current && prunedGraph.nodes.some((node) => node.id === current)
                        ? current
                        : prunedGraph.nodes[0]?.id ?? null
                    ));
                  })
                  .catch((loadError) => {
                    setError(loadError instanceof Error ? loadError.message : 'Failed to rebuild the knowledge graph.');
                  })
                  .finally(() => setLoading(false));
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-border bg-surface2 px-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface"
            >
              <RefreshCw size={11} />
              Refresh Graph
            </button>
            <button
              type="button"
              onClick={openExpandedGraph}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 border border-border bg-surface2 px-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface"
            >
              <Maximize2 size={11} />
              Expand
            </button>
          </div>
        </div>

        {showHiddenNodes && (
          <div className="mt-4 border border-border bg-surface2/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <EyeOff size={13} className="text-muted" />
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Hidden nodes</p>
              </div>
              {hiddenNodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHiddenNodeIds([])}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted transition-colors hover:text-heading"
                >
                  <RotateCcw size={11} />
                  Unhide all
                </button>
              )}
            </div>
            {hiddenNodes.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {hiddenNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => unhideNode(node.id)}
                    className="inline-flex items-center gap-2 border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface2"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-heading">{getNodeDisplayLabel(node, repoLabelPrefix)}</span>
                      <span className="block text-[10px] font-mono uppercase tracking-[0.16em] text-muted">{formatKindLabel(node.kind)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No nodes are hidden right now.</p>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: 'Sources', value: graph?.stats.sourceCount ?? sourceLibrary.length },
            { label: 'Documents', value: graph?.stats.documentCount ?? supportingDocuments.length },
            { label: 'Projects', value: graph?.stats.projectCount ?? linkedProjects.length },
            { label: 'Themes', value: graph?.stats.themeCount ?? 0 },
            { label: 'Connections', value: graph?.stats.connectionCount ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="border border-border bg-surface2/50 px-4 py-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">{stat.label}</p>
              <p className="mt-1 text-xl font-semibold text-heading">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex-1 overflow-hidden border border-border" style={{ background: graphPalette.canvasBackground }}>
          {loading ? (
            <div className="flex h-[52rem] items-center justify-center gap-3 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              Rebuilding the thesis knowledge map from current sources and documents...
            </div>
          ) : error ? (
            <div className="flex h-[52rem] flex-col items-center justify-center px-8 text-center">
              <p className="text-sm font-semibold text-heading">Knowledge graph build failed</p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{error}</p>
            </div>
          ) : visibleGraph && visibleGraph.nodes.length > 0 ? (
            <svg
              viewBox={`0 0 ${GRAPH_VIEWBOX_WIDTH} ${graphLayout.viewboxHeight}`}
              className="block h-[52rem] w-full"
              onClick={handleGraphClick}
            >
              {graphScene}
            </svg>
          ) : visibleGraph ? (
            <div className="flex h-[52rem] flex-col items-center justify-center px-8 text-center">
              <p className="text-sm font-semibold text-heading">All graph nodes are hidden</p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                Open the hidden nodes tray and restore any node to bring the graph back into view.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex h-full flex-col gap-5 xl:justify-self-end xl:w-full xl:max-w-[22.5rem]">
        <div className="flex-1 border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Network size={13} className="text-accent" />
              <h2 className="font-sans text-[13px] font-bold text-heading">Selected Node</h2>
            </div>
            {selectedNode && (
              <button
                type="button"
                onClick={() => hideNode(selectedNode.id)}
                className="inline-flex items-center gap-1.5 border border-border bg-surface2 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.17em] text-muted transition-colors hover:bg-surface hover:text-heading"
              >
                <EyeOff size={11} />
                Hide node
              </button>
            )}
          </div>
          {selectedNode ? (
            <div className="mt-4 space-y-3">
              <div className="border border-border bg-surface2/50 p-3.5">
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">{formatKindLabel(selectedNode.kind)}</p>
                <h3 className="mt-1.5 text-base font-semibold text-heading">{getNodeDisplayLabel(selectedNode, repoLabelPrefix)}</h3>
                <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{selectedNode.detail}</p>
                {selectedNode.meta.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedNode.meta.map((item) => (
                      <span key={item} className="border border-border bg-surface px-2 py-1 text-[9px] font-mono uppercase tracking-[0.11em] text-muted">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {selectedNodeLinks.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">Connected evidence</p>
                  <div className="mt-2.5 space-y-2">
                    {selectedNodeLinks.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedNodeId(node.id)}
                        className="flex w-full items-center justify-between gap-2.5 border border-border bg-surface2/40 px-3 py-2.5 text-left transition-colors hover:bg-surface2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold leading-snug text-heading">{getNodeDisplayLabel(node, repoLabelPrefix)}</span>
                          <span className="mt-0.5 block text-[9px] font-mono uppercase tracking-[0.16em] text-muted">{formatKindLabel(node.kind)}</span>
                        </span>
                        <span className="shrink-0 text-[9px] font-mono text-muted">{node.score}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Select a node in the graph to inspect how it connects to the rest of the thesis evidence.</p>
          )}
        </div>
      </div>

      {graphExpanded && (
        <div className="fixed inset-0 z-[80] p-4" style={{ backgroundColor: graphPalette.expandedBackdrop }}>
          <div className="flex h-full flex-col border border-border bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-heading">Expanded Knowledge Graph</p>
                <p className="mt-1 text-xs text-muted">Scroll to zoom. Drag the background to pan.</p>
              </div>
              <button
                type="button"
                onClick={() => setGraphExpanded(false)}
                className="inline-flex items-center gap-2 border border-border bg-surface2 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-heading transition-colors hover:bg-surface"
              >
                <X size={12} />
                Close
              </button>
            </div>

            <div
              ref={expandedGraphContainerRef}
              className="relative flex-1 overflow-hidden"
              onWheel={handleExpandedGraphWheel}
              onMouseDown={handleExpandedGraphMouseDown}
              style={{ background: graphPalette.canvasBackground, cursor: graphPanRef.current ? 'grabbing' : 'grab' }}
            >
              {visibleGraph && visibleGraph.nodes.length > 0 ? (
                <svg
                  viewBox={`0 0 ${GRAPH_VIEWBOX_WIDTH} ${graphLayout.viewboxHeight}`}
                  className="block h-full w-full"
                  onClick={handleGraphClick}
                  style={{
                    transform: `translate(${expandedGraphViewport.translateX}px, ${expandedGraphViewport.translateY}px) scale(${expandedGraphViewport.scale})`,
                    transformOrigin: '0 0',
                  }}
                >
                  {graphScene}
                </svg>
              ) : (
                <div className="flex h-full items-center justify-center px-8 text-center">
                  <p className="text-sm text-muted">No graph is available to expand right now.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
