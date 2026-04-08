// Shared report download utilities extracted from ReportsTab.tsx
// Used by both ReportsTab and DocumentsTab (in ProjectDetailPage)

import { supabase } from './supabase';

export interface ReportSection {
  title: string;
  body: string;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
}

type TemplateRenderHints = {
  backgroundColor?: string;
  surfaceColor?: string;
  borderColor?: string;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  accentColor?: string;
  headingColor?: string;
  primaryFont?: string;
  secondaryFont?: string;
  monospaceFont?: string;
  aspectRatio?: 'wide' | 'standard';
  orientation?: 'portrait' | 'landscape';
  density?: 'airy' | 'balanced' | 'dense';
  titleAlignment?: 'left' | 'center';
  headerBand?: boolean;
  sidebarAccent?: boolean;
};

type ReportTemplateAnalysis = {
  summary?: string;
  palette?: string[];
  fonts?: string[];
  renderHints?: TemplateRenderHints | null;
};

export interface ReportContent {
  title: string;
  subtitle: string;
  projectName: string;
  generatedAt: string;
  dateRange?: { from: string; to: string };
  executiveSummary: string;
  sections: ReportSection[];
  template?: {
    id?: string | null;
    filename?: string | null;
    analysis?: ReportTemplateAnalysis | null;
  } | null;
  artifact?: ReportArtifactReference | null;
  rawData?: {
    goals: { title: string; status: string; progress: number; category: string; deadline: string | null }[];
    statusCounts: Record<string, number>;
    categoryAvg: Record<string, number>;
    memberCount: number;
    totalGoals: number;
  };
}

export interface ReportArtifactReference {
  eventId: string | null;
  storagePath: string | null;
  filename: string;
  mimeType: string;
  uploadedAt: string;
}

type RenderedReportFile = {
  blob: Blob;
  fileName: string;
  mimeType: string;
};

const FALLBACK = {
  background: 'FFFFFF',
  surface: 'F7F7F7',
  border: 'D4D4D8',
  heading: '18181B',
  accent: '374151',
  accent2: '6B7280',
  muted: '71717A',
  text: '27272A',
  headingFont: 'Aptos',
  bodyFont: 'Aptos',
  monoFont: 'Aptos Mono',
};

type ResolvedTheme = {
  background: string;
  surface: string;
  border: string;
  heading: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  headingFont: string;
  bodyFont: string;
  monoFont: string;
  aspectRatio: 'wide' | 'standard';
  orientation: 'portrait' | 'landscape';
  density: 'airy' | 'balanced' | 'dense';
  titleAlignment: 'left' | 'center';
  headerBand: boolean;
  sidebarAccent: boolean;
  palette: string[];
};

function normalizeHex(value: string | null | undefined, fallback: string): string {
  const cleaned = `${value ?? ''}`.trim().replace(/^#/, '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(cleaned)) return cleaned;
  if (/^[0-9A-F]{3}$/.test(cleaned)) return cleaned.split('').map((char) => `${char}${char}`).join('');
  return fallback;
}

function scaleByDensity<T>(density: ResolvedTheme['density'], airy: T, balanced: T, dense: T): T {
  if (density === 'airy') return airy;
  if (density === 'dense') return dense;
  return balanced;
}

function mapPdfFont(fontName: string | undefined, fallback: 'helvetica' | 'times' | 'courier'): 'helvetica' | 'times' | 'courier' {
  const lower = (fontName ?? '').toLowerCase();
  if (/(mono|code|courier|consolas)/.test(lower)) return 'courier';
  if (/(serif|cambria|georgia|times|garamond|baskerville)/.test(lower)) return 'times';
  if (/(sans|aptos|calibri|arial|helvetica|roboto|inter|segoe)/.test(lower)) return 'helvetica';
  return fallback;
}

function buildPalette(theme: ReportTemplateAnalysis | null | undefined): string[] {
  const palette = (theme?.palette ?? [])
    .map((value) => normalizeHex(value, ''))
    .filter(Boolean);
  return palette.length > 0
    ? [...new Set(palette)]
    : [FALLBACK.accent, FALLBACK.accent2, FALLBACK.border];
}

function resolveTemplateTheme(report: ReportContent): ResolvedTheme {
  const analysis = report.template?.analysis ?? null;
  const hints = analysis?.renderHints ?? null;
  const palette = buildPalette(analysis);

  return {
    background: normalizeHex(hints?.backgroundColor, FALLBACK.background),
    surface: normalizeHex(hints?.surfaceColor, FALLBACK.surface),
    border: normalizeHex(hints?.borderColor, palette[2] ?? FALLBACK.border),
    heading: normalizeHex(hints?.headingColor ?? hints?.primaryTextColor, FALLBACK.heading),
    text: normalizeHex(hints?.primaryTextColor, FALLBACK.text),
    muted: normalizeHex(hints?.secondaryTextColor, FALLBACK.muted),
    accent: normalizeHex(hints?.accentColor, palette[0] ?? FALLBACK.accent),
    accent2: normalizeHex(palette[1], FALLBACK.accent2),
    headingFont: hints?.primaryFont || analysis?.fonts?.[0] || FALLBACK.headingFont,
    bodyFont: hints?.secondaryFont || analysis?.fonts?.[1] || analysis?.fonts?.[0] || FALLBACK.bodyFont,
    monoFont: hints?.monospaceFont || analysis?.fonts?.find((font) => /mono|code|courier|consolas/i.test(font)) || FALLBACK.monoFont,
    aspectRatio: hints?.aspectRatio === 'wide' ? 'wide' : 'standard',
    orientation: hints?.orientation === 'landscape' ? 'landscape' : 'portrait',
    density: hints?.density === 'airy' || hints?.density === 'dense' ? hints.density : 'balanced',
    titleAlignment: hints?.titleAlignment === 'center' ? 'center' : 'left',
    headerBand: hints?.headerBand ?? false,
    sidebarAccent: hints?.sidebarAccent ?? false,
    palette,
  };
}

function asRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function categoryColorMap(categories: string[], theme: ResolvedTheme): Record<string, string> {
  const colors = theme.palette.length > 0 ? theme.palette : [theme.accent, theme.accent2, theme.border];
  return Object.fromEntries(categories.map((category, index) => [category, colors[index % colors.length]]));
}

function triggerBrowserDownload(url: string, fileName: string, revokeAfter = false) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    if (revokeAfter) URL.revokeObjectURL(url);
  }, 1000);
}

function downloadRenderedFile(rendered: RenderedReportFile) {
  const url = URL.createObjectURL(rendered.blob);
  triggerBrowserDownload(url, rendered.fileName, true);
}

async function tryDownloadStoredArtifact(report: ReportContent, fallbackFileName: string): Promise<boolean> {
  const storagePath = report.artifact?.storagePath;
  if (!storagePath) return false;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;

    const response = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storagePath }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) return false;

    const fileResponse = await fetch(payload.url);
    if (!fileResponse.ok) return false;
    const blob = await fileResponse.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerBrowserDownload(objectUrl, report.artifact?.filename || fallbackFileName, true);
    return true;
  } catch {
    return false;
  }
}

async function renderDocxFile(report: ReportContent): Promise<RenderedReportFile> {
  const theme = resolveTemplateTheme(report);
  const {
    Document,
    Paragraph,
    TextRun,
    Packer,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    ShadingType,
    AlignmentType,
  } = await import('docx');

  const rule = (color = theme.border) => ({
    top: { style: BorderStyle.SINGLE, size: 1, color },
    bottom: { style: BorderStyle.SINGLE, size: 1, color },
    left: { style: BorderStyle.SINGLE, size: 1, color },
    right: { style: BorderStyle.SINGLE, size: 1, color },
  });

  const titleAlignment = theme.titleAlignment === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
  const titleSize = scaleByDensity(theme.density, 58, 52, 46);
  const headingSize = scaleByDensity(theme.density, 32, 30, 26);
  const bodySize = scaleByDensity(theme.density, 24, 22, 20);
  const metaSize = scaleByDensity(theme.density, 20, 18, 16);

  const makeCell = (text: string, bold = false, isHeader = false) =>
    new TableCell({
      shading: isHeader
        ? { type: ShadingType.SOLID, fill: theme.border, color: theme.border }
        : { type: ShadingType.SOLID, fill: theme.background, color: theme.background },
      borders: rule(theme.border),
      children: [new Paragraph({
        children: [new TextRun({
          text,
          bold,
          color: isHeader ? theme.heading : theme.text,
          font: isHeader ? theme.headingFont : theme.bodyFont,
          size: 20,
        })],
      })],
    });

  const children: unknown[] = [];

  if (theme.headerBand) {
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: theme.accent } },
      spacing: { after: scaleByDensity(theme.density, 260, 220, 180) },
      children: [],
    }));
  }

  children.push(new Paragraph({
    alignment: titleAlignment,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text: report.title, bold: true, color: theme.heading, font: theme.headingFont, size: titleSize })],
  }));
  if (report.subtitle) {
    children.push(new Paragraph({
      alignment: titleAlignment,
      spacing: { after: 80 },
      children: [new TextRun({ text: report.subtitle, color: theme.muted, font: theme.headingFont, size: scaleByDensity(theme.density, 28, 26, 22) })],
    }));
  }
  children.push(new Paragraph({
    alignment: titleAlignment,
    spacing: { after: 280 },
    children: [new TextRun({ text: `Generated: ${new Date(report.generatedAt).toLocaleDateString()}`, color: theme.muted, font: theme.monoFont, size: metaSize })],
  }));
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: theme.accent } },
    spacing: { after: 220 },
    children: [],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Executive Summary', bold: true, color: theme.accent, font: theme.headingFont, size: headingSize })],
  }));
  children.push(new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: report.executiveSummary, color: theme.text, font: theme.bodyFont, size: bodySize })],
  }));

  for (const section of report.sections) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: section.title, bold: true, color: theme.accent2, font: theme.headingFont, size: headingSize - 2 })],
    }));
    if (section.body) {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: section.body, color: theme.text, font: theme.bodyFont, size: bodySize })],
      }));
    }
    if (section.bullets) {
      for (const bullet of section.bullets) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: '▸  ', color: theme.accent2, font: theme.monoFont, size: bodySize }),
            new TextRun({ text: bullet, color: theme.text, font: theme.bodyFont, size: bodySize }),
          ],
        }));
      }
    }
    if (section.table) {
      const rows = [
        new TableRow({ children: section.table.headers.map((header) => makeCell(header, true, true)) }),
        ...section.table.rows.map((row) => new TableRow({ children: row.map((cell) => makeCell(cell)) })),
      ];
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }
    children.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    background: { color: theme.background },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children: children as any,
    }],
  });

  const blob = await Packer.toBlob(doc);
  return {
    blob,
    fileName: `${report.title.replace(/\s+/g, '_')}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

export async function downloadDocx(report: ReportContent) {
  const fallbackFileName = `${report.title.replace(/\s+/g, '_')}.docx`;
  if (await tryDownloadStoredArtifact(report, fallbackFileName)) return;
  downloadRenderedFile(await renderDocxFile(report));
}

async function renderPptxFile(report: ReportContent): Promise<RenderedReportFile> {
  const theme = resolveTemplateTheme(report);
  const pptxgen = (await import('pptxgenjs')).default;
  const prs = new pptxgen();
  prs.layout = theme.aspectRatio === 'wide' ? 'LAYOUT_WIDE' : 'LAYOUT_STANDARD';

  const titleFontSize = scaleByDensity(theme.density, 46, 42, 36);
  const headingFontSize = scaleByDensity(theme.density, 26, 24, 22);
  const bodyFontSize = scaleByDensity(theme.density, 14, 13, 12);
  const smallFontSize = scaleByDensity(theme.density, 11, 10, 9);
  const statusColors = [theme.border, theme.accent, theme.accent2, theme.palette[2] ?? theme.accent2];

  const addBg = (slide: ReturnType<typeof prs.addSlide>) => {
    slide.background = { fill: theme.background };
    if (theme.headerBand) {
      slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: theme.accent } });
    }
  };

  const titleSlide = prs.addSlide();
  addBg(titleSlide);
  if (theme.sidebarAccent) {
    titleSlide.addShape(prs.ShapeType.rect, { x: 0, y: 0.12, w: 0.12, h: 7.35, fill: { color: theme.accent2 } });
    titleSlide.addShape(prs.ShapeType.rect, { x: 0.12, y: 0.12, w: 0.04, h: 7.35, fill: { color: theme.accent } });
  }
  titleSlide.addText(report.projectName || report.title, {
    x: 0.5,
    y: 1.0,
    w: 12.3,
    h: 0.6,
    fontSize: 14,
    color: theme.muted,
    fontFace: theme.bodyFont,
    align: theme.titleAlignment,
  });
  titleSlide.addText(report.title, {
    x: 0.5,
    y: 1.7,
    w: 12.3,
    h: 2.0,
    fontSize: titleFontSize,
    bold: true,
    color: theme.heading,
    fontFace: theme.headingFont,
    valign: 'top',
    align: theme.titleAlignment,
  });
  titleSlide.addText(report.subtitle, {
    x: 0.5,
    y: 3.8,
    w: 12.3,
    h: 0.6,
    fontSize: 20,
    color: theme.accent,
    fontFace: theme.headingFont,
    align: theme.titleAlignment,
  });
  titleSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 4.55, w: 4.0, h: 0.03, fill: { color: theme.border } });
  titleSlide.addText(`Generated ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
    x: 0.5,
    y: 4.7,
    w: 6,
    h: 0.4,
    fontSize: smallFontSize + 1,
    color: theme.muted,
    fontFace: theme.bodyFont,
  });

  if (report.rawData) {
    const stats = [
      { label: 'Total Goals', value: String(report.rawData.totalGoals) },
      { label: 'Complete', value: String(report.rawData.statusCounts.complete ?? 0) },
      { label: 'In Progress', value: String(report.rawData.statusCounts.in_progress ?? 0) },
      { label: 'Team Members', value: String(report.rawData.memberCount) },
    ];
    stats.forEach((stat, index) => {
      const x = 0.5 + index * 3.05;
      titleSlide.addShape(prs.ShapeType.rect, { x, y: 5.4, w: 2.65, h: 1.2, fill: { color: theme.surface }, line: { color: theme.border, pt: 0.75 } });
      titleSlide.addText(stat.value, { x, y: 5.5, w: 2.65, h: 0.6, fontSize: 28, bold: true, color: theme.accent, fontFace: theme.headingFont, align: 'center' });
      titleSlide.addText(stat.label, { x, y: 6.1, w: 2.65, h: 0.35, fontSize: smallFontSize, color: theme.muted, fontFace: theme.bodyFont, align: 'center' });
    });
  }

  const summarySlide = prs.addSlide();
  addBg(summarySlide);
  summarySlide.addText('Executive Summary', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: headingFontSize, bold: true, color: theme.accent, fontFace: theme.headingFont });
  summarySlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: theme.border } });
  summarySlide.addText(report.executiveSummary, { x: 0.5, y: 1.0, w: 7.5, h: 5.8, fontSize: bodyFontSize, color: theme.text, fontFace: theme.bodyFont, valign: 'top', paraSpaceAfter: 8 });
  if (report.rawData) {
    const sc = report.rawData.statusCounts;
    const labels = ['Not Started', 'In Progress', 'In Review', 'Complete'];
    const values = [sc.not_started ?? 0, sc.in_progress ?? 0, sc.in_review ?? 0, sc.complete ?? 0];
    if (values.some((value) => value > 0)) {
      summarySlide.addText('Goal Status', { x: 8.3, y: 1.0, w: 4.5, h: 0.4, fontSize: 12, bold: true, color: theme.muted, fontFace: theme.headingFont, align: 'center' });
      summarySlide.addChart('doughnut' as any, [{ name: 'Status', labels, values }], {
        x: 8.2, y: 1.4, w: 4.6, h: 3.2,
        chartColors: statusColors,
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendColor: theme.muted,
        holeSize: 55, showTitle: false,
        dataLabelFontSize: 11, dataLabelColor: theme.heading, dataLabelFormatCode: '0',
      } as any);
      const complete = sc.complete ?? 0;
      const total = values.reduce((sum, value) => sum + value, 0);
      const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
      summarySlide.addText(`${pct}%`, { x: 9.5, y: 4.9, w: 2.2, h: 0.8, fontSize: 32, bold: true, color: theme.accent2, fontFace: theme.headingFont, align: 'center' });
      summarySlide.addText('Complete', { x: 9.5, y: 5.65, w: 2.2, h: 0.3, fontSize: smallFontSize, color: theme.muted, fontFace: theme.bodyFont, align: 'center' });
    }
  }

  if (report.rawData && report.rawData.goals.length > 0) {
    const goals = report.rawData.goals;
    const categories = [...new Set(goals.map((goal) => goal.category))];
    const catColors = categoryColorMap(categories, theme);
    const chartSlide = prs.addSlide();
    addBg(chartSlide);
    chartSlide.addText('Goal Progress Overview', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: headingFontSize, bold: true, color: theme.accent, fontFace: theme.headingFont });
    chartSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: theme.border } });
    const labels = goals.map((goal) => goal.title.length > 28 ? `${goal.title.slice(0, 26)}…` : goal.title);
    const values = goals.map((goal) => goal.progress);
    chartSlide.addChart('bar' as any, [{ name: 'Progress %', labels, values }], {
      x: 0.4, y: 1.0, w: 8.5, h: 5.9, barDir: 'bar',
      chartColors: goals.map((goal) => catColors[goal.category] ?? theme.accent),
      showValue: true, dataLabelFontSize: 10, dataLabelColor: theme.heading,
      dataLabelFormatCode: '0"%"', catAxisLabelColor: theme.muted, catAxisFontSize: 10,
      valAxisLabelColor: theme.muted, valAxisMaxVal: 100, showTitle: false, showLegend: false, barGapWidthPct: 35,
    } as any);
    let legendY = 1.1;
    chartSlide.addText('Category', { x: 9.2, y: 0.95, w: 3.6, h: 0.35, fontSize: 11, bold: true, color: theme.muted, fontFace: theme.headingFont });
    for (const category of categories) {
      chartSlide.addShape(prs.ShapeType.rect, { x: 9.2, y: legendY, w: 0.18, h: 0.18, fill: { color: catColors[category] ?? theme.accent } });
      chartSlide.addText(category, { x: 9.5, y: legendY - 0.02, w: 3.3, h: 0.22, fontSize: smallFontSize, color: theme.text, fontFace: theme.bodyFont });
      legendY += 0.32;
    }
    const complete = goals.filter((goal) => goal.status === 'complete').length;
    const avgProgress = Math.round(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length);
    legendY += 0.3;
    for (const stat of [{ label: 'Avg Progress', value: `${avgProgress}%` }, { label: 'Done', value: `${complete} / ${goals.length}` }]) {
      chartSlide.addShape(prs.ShapeType.rect, { x: 9.2, y: legendY, w: 3.6, h: 0.8, fill: { color: theme.surface }, line: { color: theme.border, pt: 0.5 } });
      chartSlide.addText(stat.value, { x: 9.2, y: legendY + 0.02, w: 3.6, h: 0.4, fontSize: 20, bold: true, color: theme.accent, fontFace: theme.headingFont, align: 'center' });
      chartSlide.addText(stat.label, { x: 9.2, y: legendY + 0.42, w: 3.6, h: 0.28, fontSize: smallFontSize - 1, color: theme.muted, fontFace: theme.bodyFont, align: 'center' });
      legendY += 1.0;
    }
  }

  if (report.rawData && Object.keys(report.rawData.categoryAvg).length > 1) {
    const categories = Object.keys(report.rawData.categoryAvg);
    const catColors = categoryColorMap(categories, theme);
    const categorySlide = prs.addSlide();
    addBg(categorySlide);
    categorySlide.addText('Progress by Category', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: headingFontSize, bold: true, color: theme.accent, fontFace: theme.headingFont });
    categorySlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: theme.border } });
    categorySlide.addChart('bar' as any, [{ name: 'Avg Progress %', labels: categories, values: Object.values(report.rawData.categoryAvg) }], {
      x: 0.4, y: 1.0, w: 7.0, h: 5.9, barDir: 'col',
      chartColors: categories.map((category) => catColors[category] ?? theme.accent),
      showValue: true, dataLabelFontSize: 12, dataLabelColor: theme.heading,
      dataLabelFormatCode: '0"%"', catAxisLabelColor: theme.muted, catAxisFontSize: 11,
      valAxisLabelColor: theme.muted, valAxisMaxVal: 100, showTitle: false, showLegend: false, barGapWidthPct: 40,
    } as any);
    let detailY = 1.0;
    categorySlide.addText('Category Detail', { x: 7.7, y: 0.9, w: 5.0, h: 0.4, fontSize: 12, bold: true, color: theme.muted, fontFace: theme.headingFont });
    for (const [category, avg] of Object.entries(report.rawData.categoryAvg)) {
      const count = report.rawData.goals.filter((goal) => goal.category === category).length;
      const done = report.rawData.goals.filter((goal) => goal.category === category && goal.status === 'complete').length;
      categorySlide.addShape(prs.ShapeType.rect, { x: 7.7, y: detailY, w: 5.0, h: 0.85, fill: { color: theme.surface }, line: { color: theme.border, pt: 0.5 } });
      categorySlide.addShape(prs.ShapeType.rect, { x: 7.7, y: detailY, w: 0.08, h: 0.85, fill: { color: catColors[category] ?? theme.accent } });
      categorySlide.addText(category, { x: 7.9, y: detailY + 0.05, w: 2.8, h: 0.35, fontSize: 11, bold: true, color: theme.heading, fontFace: theme.headingFont });
      categorySlide.addText(`${avg}% avg  •  ${count} goal${count !== 1 ? 's' : ''}  •  ${done} done`, { x: 7.9, y: detailY + 0.42, w: 4.6, h: 0.28, fontSize: smallFontSize - 1, color: theme.muted, fontFace: theme.bodyFont });
      detailY += 1.0;
      if (detailY > 6.4) break;
    }
  }

  for (const section of report.sections) {
    const slide = prs.addSlide();
    addBg(slide);
    slide.addText(section.title, { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: headingFontSize - 1, bold: true, color: theme.accent2, fontFace: theme.headingFont });
    slide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: theme.border } });
    if (section.table && section.table.rows.length > 0) {
      if (section.body) slide.addText(section.body, { x: 0.5, y: 1.0, w: 12.3, h: 1.0, fontSize: bodyFontSize - 1, color: theme.accent, fontFace: theme.bodyFont, valign: 'top' });
      const tableTop = section.body ? 2.1 : 1.05;
      const tableData = [
        section.table.headers.map((header) => ({ text: header, options: { bold: true, fill: theme.border, color: theme.heading, fontFace: theme.headingFont, fontSize: smallFontSize } })),
        ...section.table.rows.slice(0, 10).map((row, index) => row.map((cell) => ({ text: cell, options: { fill: index % 2 === 0 ? theme.background : theme.surface, color: theme.heading, fontFace: theme.bodyFont, fontSize: smallFontSize } }))),
      ];
      slide.addTable(tableData as Parameters<typeof slide.addTable>[0], { x: 0.5, y: tableTop, w: 12.3, border: { pt: 0.5, color: theme.border }, rowH: 0.36 });
    } else {
      const hasBody = !!section.body;
      const hasBullets = !!section.bullets?.length;
      if (hasBody && hasBullets) {
        slide.addText(section.body, { x: 0.5, y: 1.0, w: 5.9, h: 5.8, fontSize: bodyFontSize - 1, color: theme.heading, fontFace: theme.bodyFont, valign: 'top', paraSpaceAfter: 6 });
        slide.addShape(prs.ShapeType.rect, { x: 6.6, y: 1.0, w: 0.025, h: 5.8, fill: { color: theme.border } });
        slide.addText(section.bullets!.map((bullet) => ({ text: bullet, options: { bullet: { code: '25B8', color: theme.accent2 }, color: theme.heading, fontSize: bodyFontSize - 1, fontFace: theme.bodyFont, paraSpaceAfter: 10 } as any })), { x: 6.8, y: 1.0, w: 6.0, h: 5.8, valign: 'top' });
      } else if (hasBody) {
        slide.addText(section.body, { x: 0.5, y: 1.0, w: 12.3, h: 5.8, fontSize: bodyFontSize, color: theme.heading, fontFace: theme.bodyFont, valign: 'top', paraSpaceAfter: 8 });
      } else if (hasBullets) {
        slide.addText(section.bullets!.map((bullet) => ({ text: bullet, options: { bullet: { code: '25B8', color: theme.accent2 }, color: theme.heading, fontSize: bodyFontSize, fontFace: theme.bodyFont, paraSpaceAfter: 12 } as any })), { x: 0.5, y: 1.0, w: 12.3, h: 5.8, valign: 'top' });
      }
    }
  }

  const blob = await prs.write({ outputType: 'blob' }) as Blob;
  return {
    blob,
    fileName: `${report.title.replace(/\s+/g, '_')}.pptx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
}

export async function downloadPptx(report: ReportContent) {
  const fallbackFileName = `${report.title.replace(/\s+/g, '_')}.pptx`;
  if (await tryDownloadStoredArtifact(report, fallbackFileName)) return;
  downloadRenderedFile(await renderPptxFile(report));
}

async function renderPdfFile(report: ReportContent): Promise<RenderedReportFile> {
  const theme = resolveTemplateTheme(report);
  const { default: jsPDF } = await import('jspdf');
  const orientation = theme.orientation === 'landscape' ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'letter' });
  const margin = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

  const colors = {
    background: asRgb(theme.background),
    surface: asRgb(theme.surface),
    border: asRgb(theme.border),
    heading: asRgb(theme.heading),
    accent: asRgb(theme.accent),
    accent2: asRgb(theme.accent2),
    muted: asRgb(theme.muted),
    text: asRgb(theme.text),
  };

  const headingFont = mapPdfFont(theme.headingFont, 'helvetica');
  const bodyFont = mapPdfFont(theme.bodyFont, 'helvetica');
  const monoFont = mapPdfFont(theme.monoFont, 'courier');

  const setColor = (color: [number, number, number]) => doc.setTextColor(...color);
  const setFill = (color: [number, number, number]) => doc.setFillColor(...color);
  const setDraw = (color: [number, number, number]) => doc.setDrawColor(...color);

  const paintBg = () => {
    setFill(colors.background);
    doc.rect(0, 0, pageW, pageH, 'F');
    if (theme.headerBand) {
      setFill(colors.accent);
      doc.rect(0, 0, pageW, 4, 'F');
    }
  };

  const checkPage = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      paintBg();
      y = margin + 12;
    }
  };

  const titleSize = scaleByDensity(theme.density, 28, 26, 24);
  const bodySize = scaleByDensity(theme.density, 11, 10, 9);
  const metaSize = scaleByDensity(theme.density, 10, 9, 8);

  paintBg();

  setColor(colors.heading);
  doc.setFont(headingFont, 'bold');
  doc.setFontSize(titleSize);
  if (theme.titleAlignment === 'center') {
    doc.text(report.title, pageW / 2, y, { align: 'center' });
  } else {
    doc.text(report.title, margin, y);
  }
  y += 32;

  setColor(colors.accent);
  doc.setFont(headingFont, 'normal');
  doc.setFontSize(12);
  if (theme.titleAlignment === 'center') {
    doc.text(report.subtitle || report.projectName, pageW / 2, y, { align: 'center' });
  } else {
    doc.text(report.subtitle || report.projectName, margin, y);
  }
  y += 18;

  setColor(colors.muted);
  doc.setFont(bodyFont, 'normal');
  doc.setFontSize(metaSize);
  if (theme.titleAlignment === 'center') {
    doc.text(`Generated ${new Date(report.generatedAt).toLocaleDateString()}`, pageW / 2, y, { align: 'center' });
  } else {
    doc.text(`Generated ${new Date(report.generatedAt).toLocaleDateString()}`, margin, y);
  }
  y += 16;

  setDraw(colors.accent);
  doc.setLineWidth(1.5);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  checkPage(48);
  setColor(colors.accent);
  doc.setFont(headingFont, 'bold');
  doc.setFontSize(13);
  doc.text('Executive Summary', margin, y);
  y += 6;
  setDraw(colors.accent2);
  doc.setLineWidth(0.75);
  doc.line(margin, y, margin + 110, y);
  y += 14;

  setColor(colors.text);
  doc.setFont(bodyFont, 'normal');
  doc.setFontSize(bodySize);
  const summaryLines = doc.splitTextToSize(report.executiveSummary, contentW);
  checkPage(summaryLines.length * (bodySize + 3) + 16);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * (bodySize + 3) + 20;

  for (const section of report.sections) {
    checkPage(44);
    if (theme.sidebarAccent) {
      setFill(colors.accent2);
      doc.rect(margin, y - 11, 3, 14, 'F');
    }
    setColor(colors.accent2);
    doc.setFont(headingFont, 'bold');
    doc.setFontSize(12);
    doc.text(section.title, margin + (theme.sidebarAccent ? 10 : 0), y);
    y += 16;
    setDraw(colors.border);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 10;
    setColor(colors.text);
    doc.setFont(bodyFont, 'normal');
    doc.setFontSize(bodySize);
    if (section.body) {
      const lines = doc.splitTextToSize(section.body, contentW);
      checkPage(lines.length * (bodySize + 3) + 10);
      doc.text(lines, margin, y);
      y += lines.length * (bodySize + 3) + 8;
    }
    if (section.bullets) {
      for (const bullet of section.bullets) {
        checkPage(18);
        setColor(colors.accent2);
        doc.setFont(monoFont, 'normal');
        doc.text('▸', margin, y);
        setColor(colors.text);
        doc.setFont(bodyFont, 'normal');
        const lines = doc.splitTextToSize(bullet, contentW - 16);
        doc.text(lines, margin + 14, y);
        y += lines.length * (bodySize + 3) + 4;
      }
    }
    if (section.table) {
      checkPage(36);
      const cols = section.table.headers.length;
      const colW = contentW / cols;
      const rowH = 16;
      setFill(colors.border);
      doc.rect(margin, y - 11, contentW, rowH, 'F');
      setColor(colors.heading);
      doc.setFont(headingFont, 'bold');
      doc.setFontSize(9);
      section.table.headers.forEach((header, index) => doc.text(header, margin + index * colW + 5, y));
      y += rowH;
      doc.setFont(bodyFont, 'normal');
      for (let rowIndex = 0; rowIndex < section.table.rows.length; rowIndex += 1) {
        const row = section.table.rows[rowIndex];
        checkPage(rowH + 4);
        if (rowIndex % 2 === 1) {
          setFill(colors.surface);
          doc.rect(margin, y - 11, contentW, rowH, 'F');
        }
        setColor(colors.text);
        row.forEach((cell, index) => {
          const lines = doc.splitTextToSize(cell, colW - 10);
          doc.text(lines, margin + index * colW + 5, y);
        });
        y += rowH;
      }
      y += 8;
    }
    y += 14;
  }

  return {
    blob: doc.output('blob'),
    fileName: `${report.title.replace(/\s+/g, '_')}.pdf`,
    mimeType: 'application/pdf',
  };
}

export async function downloadPdf(report: ReportContent) {
  const fallbackFileName = `${report.title.replace(/\s+/g, '_')}.pdf`;
  if (await tryDownloadStoredArtifact(report, fallbackFileName)) return;
  downloadRenderedFile(await renderPdfFile(report));
}

export async function downloadReport(report: ReportContent, format: 'docx' | 'pptx' | 'pdf') {
  if (format === 'pptx') {
    await downloadPptx(report);
    return;
  }
  if (format === 'pdf') {
    await downloadPdf(report);
    return;
  }
  await downloadDocx(report);
}

export async function renderReportFile(report: ReportContent, format: 'docx' | 'pptx' | 'pdf'): Promise<RenderedReportFile> {
  if (format === 'pptx') return renderPptxFile(report);
  if (format === 'pdf') return renderPdfFile(report);
  return renderDocxFile(report);
}

export function exportGoalsCSV(report: ReportContent) {
  if (!report.rawData?.goals?.length) return;
  const headers = ['Title', 'Status', 'Progress', 'Category', 'Deadline'];
  const rows = report.rawData.goals.map((goal) => [
    `"${goal.title.replace(/"/g, '""')}"`,
    goal.status,
    String(goal.progress),
    goal.category || '',
    goal.deadline || '',
  ]);
  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  triggerBrowserDownload(url, `${report.title.replace(/\s+/g, '_')}_goals.csv`, true);
}
