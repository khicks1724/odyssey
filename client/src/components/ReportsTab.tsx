import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, FileText, Download, BarChart3, Presentation, X } from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { supabase } from '../lib/supabase';
import './ReportsTab.css';

interface ReportSection {
  title: string;
  body: string;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
}

interface RawGoal {
  title: string;
  status: string;
  progress: number;
  category: string;
  deadline: string | null;
}

interface ReportContent {
  title: string;
  subtitle: string;
  projectName: string;
  generatedAt: string;
  dateRange?: { from: string; to: string };
  executiveSummary: string;
  sections: ReportSection[];
  rawData?: {
    goals: RawGoal[];
    statusCounts: Record<string, number>;
    categoryAvg: Record<string, number>;
    memberCount: number;
    totalGoals: number;
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
}

interface ReportsTabProps {
  projectId: string;
  projectName: string;
  projectStartDate: string | null;
  messages: Message[];
  onMessagesChange: (msgs: Message[]) => void;
  onReportSaved?: () => void;
}

/** Parse a natural-language message for date range hints.
 *  Returns { from, to } as YYYY-MM-DD strings, or null fields if not found. */
function parseDateRange(text: string): { from: string | null; to: string | null } {
  const t = text.toLowerCase();
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = fmt(today);

  // "last N days/weeks/months"
  const lastN = t.match(/last\s+(\d+)\s+(day|week|month)s?/);
  if (lastN) {
    const n = parseInt(lastN[1]);
    const unit = lastN[2];
    const from = new Date(today);
    if (unit === 'day') from.setDate(from.getDate() - n);
    else if (unit === 'week') from.setDate(from.getDate() - n * 7);
    else if (unit === 'month') from.setMonth(from.getMonth() - n);
    return { from: fmt(from), to: todayStr };
  }

  // "last week"
  if (/\blast week\b/.test(t)) {
    const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() - 6);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: fmt(mon), to: fmt(sun) };
  }

  // "this week"
  if (/\bthis week\b/.test(t)) {
    const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() + 1);
    return { from: fmt(mon), to: todayStr };
  }

  // "last month"
  if (/\blast month\b/.test(t)) {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last  = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: fmt(first), to: fmt(last) };
  }

  // "this month"
  if (/\bthis month\b/.test(t)) {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: fmt(first), to: todayStr };
  }

  // "this year" / "this year"
  if (/\bthis year\b/.test(t)) {
    return { from: `${today.getFullYear()}-01-01`, to: todayStr };
  }

  // "last year"
  if (/\blast year\b/.test(t)) {
    const y = today.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  // "Q1/Q2/Q3/Q4 [YYYY]"
  const qMatch = t.match(/\bq([1-4])\s*(\d{4})?\b/);
  if (qMatch) {
    const q = parseInt(qMatch[1]);
    const y = qMatch[2] ? parseInt(qMatch[2]) : today.getFullYear();
    const startMonth = (q - 1) * 3;
    const from = new Date(y, startMonth, 1);
    const to   = new Date(y, startMonth + 3, 0);
    return { from: fmt(from), to: fmt(to) };
  }

  // Named months: "January 2026", "march", "march to june 2026"
  const MONTHS: Record<string, number> = {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  };
  const monthPattern = Object.keys(MONTHS).join('|');
  const rangeRe = new RegExp(`(${monthPattern})\\s*(\\d{4})?\\s*(?:to|through|-)\\s*(${monthPattern})\\s*(\\d{4})?`);
  const rangeM = t.match(rangeRe);
  if (rangeM) {
    const y1 = rangeM[2] ? parseInt(rangeM[2]) : today.getFullYear();
    const y2 = rangeM[4] ? parseInt(rangeM[4]) : y1;
    const m1 = MONTHS[rangeM[1]];
    const m2 = MONTHS[rangeM[3]];
    return { from: fmt(new Date(y1, m1 - 1, 1)), to: fmt(new Date(y2, m2, 0)) };
  }

  // Single month "March 2026" or "in march"
  const singleM = t.match(new RegExp(`\\b(${monthPattern})\\s*(\\d{4})?\\b`));
  if (singleM) {
    const m = MONTHS[singleM[1]];
    const y = singleM[2] ? parseInt(singleM[2]) : today.getFullYear();
    return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
  }

  // "since [date]" or "from [date]" — open-ended
  const sinceRe = /(?:since|from)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{4})/;
  const sinceM = t.match(sinceRe);
  if (sinceM) {
    const d = new Date(sinceM[1]);
    if (!isNaN(d.getTime())) return { from: fmt(d), to: todayStr };
  }

  return { from: null, to: null };
}

type ReportFormat = 'docx' | 'pptx' | 'pdf';

// ── Ivory theme palette (hex without #) ─────────────────────────────────────
const T = {
  ivory:   'F5F0E8',
  surface: 'ECE7DF',
  border:  'C8C0B4',
  navy:    '0F1F33',
  accent:  '1E3A5F',
  teal:    '3A7A6A',
  muted:   '6B7A8D',
  text:    '1E3A5F',
};

async function downloadDocx(report: ReportContent) {
  const { Document, Paragraph, TextRun, Packer, Table, TableRow, TableCell,
          WidthType, BorderStyle, ShadingType, AlignmentType } = await import('docx');

  const rule = (color = T.border) => ({
    top:    { style: BorderStyle.SINGLE, size: 1, color },
    bottom: { style: BorderStyle.SINGLE, size: 1, color },
    left:   { style: BorderStyle.SINGLE, size: 1, color },
    right:  { style: BorderStyle.SINGLE, size: 1, color },
  });

  const makeCell = (text: string, bold = false, isHeader = false) =>
    new TableCell({
      shading: isHeader
        ? { type: ShadingType.SOLID, fill: T.border, color: T.border }
        : { type: ShadingType.SOLID, fill: T.ivory, color: T.ivory },
      borders: rule(T.border),
      children: [new Paragraph({
        children: [new TextRun({
          text,
          bold,
          color: isHeader ? T.navy : T.text,
          font: 'DM Mono',
          size: 20,
        })],
      })],
    });

  const children: unknown[] = [];

  // ── Title block ──
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text: report.title, bold: true, color: T.navy, font: 'Syne', size: 52 })],
  }));
  if (report.subtitle) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: report.subtitle, color: T.muted, font: 'Syne', size: 26 })],
    }));
  }
  children.push(new Paragraph({
    spacing: { after: 320 },
    children: [new TextRun({ text: `Generated: ${new Date(report.generatedAt).toLocaleDateString()}`, color: T.muted, font: 'DM Mono', size: 18 })],
  }));

  // ── Divider ──
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: T.accent } },
    spacing: { after: 240 },
    children: [],
  }));

  // ── Executive Summary ──
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Executive Summary', bold: true, color: T.accent, font: 'Syne', size: 30 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: report.executiveSummary, color: T.text, font: 'DM Mono', size: 22 })],
  }));

  // ── Sections ──
  for (const section of report.sections) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: section.title, bold: true, color: T.teal, font: 'Syne', size: 28 })],
    }));
    if (section.body) {
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: section.body, color: T.text, font: 'DM Mono', size: 22 })],
      }));
    }
    if (section.bullets) {
      for (const b of section.bullets) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: '▸  ', color: T.teal, font: 'DM Mono', size: 22 }),
            new TextRun({ text: b, color: T.text, font: 'DM Mono', size: 22 }),
          ],
        }));
      }
    }
    if (section.table) {
      const rows = [
        new TableRow({ children: section.table.headers.map((h) => makeCell(h, true, true)) }),
        ...section.table.rows.map((r) => new TableRow({ children: r.map((c) => makeCell(c)) })),
      ];
      children.push(new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
    }
    children.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    background: { color: T.ivory },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children: children as Parameters<typeof Document>[0]['sections'][0]['children'],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.title.replace(/\s+/g, '_')}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadPptx(report: ReportContent) {
  const pptxgen = (await import('pptxgenjs')).default;
  const prs = new pptxgen();
  prs.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

  // ── Theme ──────────────────────────────────────────────────────────────────
  const BG      = 'F5F0E8';
  const NAVY    = '0F1F33';
  const ACCENT  = '1E3A5F';
  const TEAL    = '3A7A6A';
  const MUTED   = '6B7A8D';
  const BORDER  = 'C8C0B4';
  const SURFACE = 'ECE7DF';
  const AMBER   = 'E8A235';
  const DANGER  = 'B91C1C';
  const ACCENT2 = '2A5A8F';

  const CAT_COLORS: Record<string, string> = {
    Testing: 'E85555', Seeker: '3B8EEA', Missile: 'E8A235',
    Admin: 'BD93F9', Simulation: '52C98E', DevOps: 'DC7070',
    Uncategorized: '5A6A7E',
  };
  const STATUS_COLORS = [BORDER, ACCENT2, AMBER, TEAL]; // not_started, in_progress, in_review, complete

  const addBg = (slide: ReturnType<typeof prs.addSlide>) => {
    slide.background = { fill: BG };
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.1, fill: { color: ACCENT } });
  };

  // ── 1. TITLE SLIDE ─────────────────────────────────────────────────────────
  const titleSlide = prs.addSlide();
  addBg(titleSlide);
  titleSlide.addShape(prs.ShapeType.rect, { x: 0, y: 0.1, w: 0.12, h: 7.4, fill: { color: TEAL } });
  titleSlide.addShape(prs.ShapeType.rect, { x: 0.12, y: 0.1, w: 0.04, h: 7.4, fill: { color: ACCENT } });
  titleSlide.addText(report.projectName || report.title, { x: 0.4, y: 1.0, w: 12.5, h: 0.6, fontSize: 14, color: MUTED, fontFace: 'DM Mono' });
  titleSlide.addText(report.title, { x: 0.4, y: 1.7, w: 12.5, h: 2.0, fontSize: 42, bold: true, color: NAVY, fontFace: 'Syne', valign: 'top' });
  titleSlide.addText(report.subtitle, { x: 0.4, y: 3.8, w: 12.5, h: 0.6, fontSize: 20, color: ACCENT, fontFace: 'Syne' });
  titleSlide.addShape(prs.ShapeType.rect, { x: 0.4, y: 4.55, w: 4.0, h: 0.03, fill: { color: BORDER } });
  titleSlide.addText(`Generated ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { x: 0.4, y: 4.7, w: 6, h: 0.4, fontSize: 11, color: MUTED, fontFace: 'DM Mono' });
  if (report.rawData) {
    const rd = report.rawData;
    const stats = [
      { label: 'Total Goals', value: String(rd.totalGoals) },
      { label: 'Complete', value: String(rd.statusCounts['complete'] ?? 0) },
      { label: 'In Progress', value: String(rd.statusCounts['in_progress'] ?? 0) },
      { label: 'Team Members', value: String(rd.memberCount) },
    ];
    stats.forEach((s, i) => {
      const x = 0.4 + i * 3.2;
      titleSlide.addShape(prs.ShapeType.rect, { x, y: 5.4, w: 2.8, h: 1.2, fill: { color: SURFACE }, line: { color: BORDER, pt: 0.75 } });
      titleSlide.addText(s.value, { x, y: 5.5, w: 2.8, h: 0.6, fontSize: 28, bold: true, color: ACCENT, fontFace: 'Syne', align: 'center' });
      titleSlide.addText(s.label, { x, y: 6.1, w: 2.8, h: 0.35, fontSize: 10, color: MUTED, fontFace: 'DM Mono', align: 'center' });
    });
  }

  // ── 2. EXECUTIVE SUMMARY ───────────────────────────────────────────────────
  const sumSlide = prs.addSlide();
  addBg(sumSlide);
  sumSlide.addText('Executive Summary', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT, fontFace: 'Syne' });
  sumSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });
  // Left: summary text
  sumSlide.addText(report.executiveSummary, { x: 0.5, y: 1.0, w: 7.5, h: 5.8, fontSize: 13, color: NAVY, fontFace: 'DM Mono', valign: 'top', paraSpaceBefore: 0, paraSpaceAfter: 8 });
  // Right: status doughnut chart
  if (report.rawData) {
    const sc = report.rawData.statusCounts;
    const labels = ['Not Started', 'In Progress', 'In Review', 'Complete'];
    const values = [sc['not_started'] ?? 0, sc['in_progress'] ?? 0, sc['in_review'] ?? 0, sc['complete'] ?? 0];
    const hasData = values.some((v) => v > 0);
    if (hasData) {
      sumSlide.addText('Goal Status', { x: 8.3, y: 1.0, w: 4.5, h: 0.4, fontSize: 12, bold: true, color: MUTED, fontFace: 'Syne', align: 'center' });
      sumSlide.addChart('doughnut' as any, [{ name: 'Status', labels, values }], {
        x: 8.2, y: 1.4, w: 4.6, h: 3.2,
        chartColors: STATUS_COLORS,
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendColor: MUTED,
        holeSize: 55,
        showTitle: false,
        dataLabelFontSize: 11, dataLabelColor: NAVY,
        dataLabelFormatCode: '0',
      } as any);
      // stat boxes under chart
      const complete = sc['complete'] ?? 0;
      const total = values.reduce((a, b) => a + b, 0);
      const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
      sumSlide.addText(`${pct}%`, { x: 9.5, y: 4.9, w: 2.2, h: 0.8, fontSize: 32, bold: true, color: TEAL, fontFace: 'Syne', align: 'center' });
      sumSlide.addText('Complete', { x: 9.5, y: 5.65, w: 2.2, h: 0.3, fontSize: 10, color: MUTED, fontFace: 'DM Mono', align: 'center' });
    }
  }

  // ── 3. GOAL PROGRESS CHART SLIDE ───────────────────────────────────────────
  if (report.rawData && report.rawData.goals.length > 0) {
    const goals = report.rawData.goals;
    const chartSlide = prs.addSlide();
    addBg(chartSlide);
    chartSlide.addText('Goal Progress Overview', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT, fontFace: 'Syne' });
    chartSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });

    // Horizontal bar chart
    const labels = goals.map((g) => g.title.length > 28 ? g.title.slice(0, 26) + '…' : g.title);
    const values = goals.map((g) => g.progress);
    const barColors = goals.map((g) => CAT_COLORS[g.category] ?? '5A6A7E');

    chartSlide.addChart('bar' as any, [{ name: 'Progress %', labels, values }], {
      x: 0.4, y: 1.0, w: 8.5, h: 5.9,
      barDir: 'bar',
      chartColors: barColors,
      showValue: true, dataLabelFontSize: 10, dataLabelColor: NAVY,
      dataLabelFormatCode: '0"%"',
      catAxisLabelColor: MUTED, catAxisFontSize: 10,
      valAxisLabelColor: MUTED, valAxisMaxVal: 100,
      showTitle: false,
      showLegend: false,
      barGapWidthPct: 35,
    } as any);

    // Legend for categories used
    const usedCats = [...new Set(goals.map((g) => g.category))];
    let ly = 1.1;
    chartSlide.addText('Category', { x: 9.2, y: 0.95, w: 3.6, h: 0.35, fontSize: 11, bold: true, color: MUTED, fontFace: 'Syne' });
    for (const cat of usedCats) {
      chartSlide.addShape(prs.ShapeType.rect, { x: 9.2, y: ly, w: 0.18, h: 0.18, fill: { color: CAT_COLORS[cat] ?? '5A6A7E' } });
      chartSlide.addText(cat, { x: 9.5, y: ly - 0.02, w: 3.3, h: 0.22, fontSize: 10, color: NAVY, fontFace: 'DM Mono' });
      ly += 0.32;
    }

    // Summary stats on right
    const complete = goals.filter((g) => g.status === 'complete').length;
    const avgProgress = Math.round(goals.reduce((a, g) => a + g.progress, 0) / goals.length);
    ly += 0.3;
    const summaryStats = [
      { label: 'Avg Progress', value: `${avgProgress}%` },
      { label: 'Done', value: `${complete} / ${goals.length}` },
    ];
    for (const s of summaryStats) {
      chartSlide.addShape(prs.ShapeType.rect, { x: 9.2, y: ly, w: 3.6, h: 0.8, fill: { color: SURFACE }, line: { color: BORDER, pt: 0.5 } });
      chartSlide.addText(s.value, { x: 9.2, y: ly + 0.02, w: 3.6, h: 0.4, fontSize: 20, bold: true, color: ACCENT, fontFace: 'Syne', align: 'center' });
      chartSlide.addText(s.label, { x: 9.2, y: ly + 0.42, w: 3.6, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'DM Mono', align: 'center' });
      ly += 1.0;
    }
  }

  // ── 4. CATEGORY BREAKDOWN CHART ────────────────────────────────────────────
  if (report.rawData && Object.keys(report.rawData.categoryAvg).length > 1) {
    const catSlide = prs.addSlide();
    addBg(catSlide);
    catSlide.addText('Progress by Category', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT, fontFace: 'Syne' });
    catSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });

    const cats  = Object.keys(report.rawData.categoryAvg);
    const avgs  = Object.values(report.rawData.categoryAvg);
    const catClrs = cats.map((c) => CAT_COLORS[c] ?? '5A6A7E');

    catSlide.addChart('bar' as any, [{ name: 'Avg Progress %', labels: cats, values: avgs }], {
      x: 0.4, y: 1.0, w: 7.0, h: 5.9,
      barDir: 'col',
      chartColors: catClrs,
      showValue: true, dataLabelFontSize: 12, dataLabelColor: NAVY,
      dataLabelFormatCode: '0"%"',
      catAxisLabelColor: MUTED, catAxisFontSize: 11,
      valAxisLabelColor: MUTED, valAxisMaxVal: 100,
      showTitle: false, showLegend: false,
      barGapWidthPct: 40,
    } as any);

    // Category cards on right
    let cy = 1.0;
    catSlide.addText('Category Detail', { x: 7.7, y: 0.9, w: 5.0, h: 0.4, fontSize: 12, bold: true, color: MUTED, fontFace: 'Syne' });
    for (const [cat, avg] of Object.entries(report.rawData.categoryAvg)) {
      const count = report.rawData.goals.filter((g) => g.category === cat).length;
      const done  = report.rawData.goals.filter((g) => g.category === cat && g.status === 'complete').length;
      catSlide.addShape(prs.ShapeType.rect, { x: 7.7, y: cy, w: 5.0, h: 0.85, fill: { color: SURFACE }, line: { color: BORDER, pt: 0.5 } });
      catSlide.addShape(prs.ShapeType.rect, { x: 7.7, y: cy, w: 0.08, h: 0.85, fill: { color: CAT_COLORS[cat] ?? '5A6A7E' } });
      catSlide.addText(cat, { x: 7.9, y: cy + 0.05, w: 2.8, h: 0.35, fontSize: 11, bold: true, color: NAVY, fontFace: 'Syne' });
      catSlide.addText(`${avg}% avg  •  ${count} goal${count !== 1 ? 's' : ''}  •  ${done} done`, { x: 7.9, y: cy + 0.42, w: 4.6, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'DM Mono' });
      cy += 1.0;
      if (cy > 6.4) break;
    }
  }

  // ── 5. SECTION SLIDES ──────────────────────────────────────────────────────
  for (const section of report.sections) {
    const slide = prs.addSlide();
    addBg(slide);
    slide.addText(section.title, { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: TEAL, fontFace: 'Syne' });
    slide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });

    if (section.table && section.table.rows.length > 0) {
      // Full-width table layout
      if (section.body) {
        slide.addText(section.body, { x: 0.5, y: 1.0, w: 12.3, h: 1.0, fontSize: 11, color: ACCENT, fontFace: 'DM Mono', valign: 'top' });
      }
      const tableTop = section.body ? 2.1 : 1.05;
      const tableData = [
        section.table.headers.map((h) => ({ text: h, options: { bold: true, fill: BORDER, color: NAVY, fontFace: 'Syne', fontSize: 10 } })),
        ...section.table.rows.slice(0, 10).map((r, ri) => r.map((c) => ({
          text: c,
          options: { fill: ri % 2 === 0 ? BG : SURFACE, color: NAVY, fontFace: 'DM Mono', fontSize: 10 },
        }))),
      ];
      slide.addTable(tableData as Parameters<typeof slide.addTable>[0], {
        x: 0.5, y: tableTop, w: 12.3,
        border: { pt: 0.5, color: BORDER },
        rowH: 0.36,
      });
    } else {
      // Two-column: body on left, bullets on right
      const hasBody    = !!section.body;
      const hasBullets = section.bullets && section.bullets.length > 0;

      if (hasBody && hasBullets) {
        slide.addText(section.body!, { x: 0.5, y: 1.0, w: 5.9, h: 5.8, fontSize: 12, color: NAVY, fontFace: 'DM Mono', valign: 'top', paraSpaceAfter: 6 });
        slide.addShape(prs.ShapeType.rect, { x: 6.6, y: 1.0, w: 0.025, h: 5.8, fill: { color: BORDER } });
        const bulletItems = section.bullets!.map((b) => ({
          text: b,
          options: { bullet: { code: '25B8', color: TEAL }, color: NAVY, fontSize: 12, fontFace: 'DM Mono', paraSpaceAfter: 10 } as any,
        }));
        slide.addText(bulletItems, { x: 6.8, y: 1.0, w: 6.0, h: 5.8, valign: 'top' });
      } else if (hasBody) {
        slide.addText(section.body!, { x: 0.5, y: 1.0, w: 12.3, h: 5.8, fontSize: 13, color: NAVY, fontFace: 'DM Mono', valign: 'top', paraSpaceAfter: 8 });
      } else if (hasBullets) {
        const bulletItems = section.bullets!.map((b) => ({
          text: b,
          options: { bullet: { code: '25B8', color: TEAL }, color: NAVY, fontSize: 13, fontFace: 'DM Mono', paraSpaceAfter: 12 } as any,
        }));
        slide.addText(bulletItems, { x: 0.5, y: 1.0, w: 12.3, h: 5.8, valign: 'top' });
      }
    }
  }

  await prs.writeFile({ fileName: `${report.title.replace(/\s+/g, '_')}.pptx` });
}

async function downloadPdf(report: ReportContent) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const margin  = 56;
  const pageW   = doc.internal.pageSize.getWidth();
  const pageH   = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

  // Ivory theme colors as RGB
  const C = {
    ivory:   [245, 240, 232] as [number,number,number],
    surface: [236, 231, 223] as [number,number,number],
    border:  [200, 192, 180] as [number,number,number],
    navy:    [ 15,  31,  51] as [number,number,number],
    accent:  [ 30,  58,  95] as [number,number,number],
    teal:    [ 58, 122, 106] as [number,number,number],
    muted:   [107, 122, 141] as [number,number,number],
  };

  const setColor  = (c: [number,number,number]) => doc.setTextColor(...c);
  const setFill   = (c: [number,number,number]) => doc.setFillColor(...c);
  const setDraw   = (c: [number,number,number]) => doc.setDrawColor(...c);

  const paintBg = () => {
    setFill(C.ivory);
    doc.rect(0, 0, pageW, pageH, 'F');
    // Accent top bar
    setFill(C.accent);
    doc.rect(0, 0, pageW, 4, 'F');
  };

  const checkPage = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      paintBg();
      y = margin + 12;
    }
  };

  paintBg();

  // ── Title ──
  setColor(C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.text(report.title, margin, y);
  y += 32;

  setColor(C.accent);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(report.subtitle || report.projectName, margin, y);
  y += 18;

  setColor(C.muted);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleDateString()}`, margin, y);
  y += 16;

  // Divider line
  setDraw(C.accent);
  doc.setLineWidth(1.5);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // ── Executive Summary ──
  checkPage(48);
  setColor(C.accent);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Executive Summary', margin, y);
  y += 6;
  setDraw(C.teal);
  doc.setLineWidth(0.75);
  doc.line(margin, y, margin + 110, y);
  y += 14;

  setColor(C.navy);
  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  const sumLines = doc.splitTextToSize(report.executiveSummary, contentW);
  checkPage(sumLines.length * 13 + 16);
  doc.text(sumLines, margin, y);
  y += sumLines.length * 13 + 20;

  // ── Sections ──
  for (const section of report.sections) {
    checkPage(44);

    // Section heading with teal left accent bar
    setFill(C.teal);
    doc.rect(margin, y - 11, 3, 14, 'F');
    setColor(C.teal);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(section.title, margin + 10, y);
    y += 16;

    setDraw(C.border);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 10;

    setColor(C.navy);
    doc.setFont('courier', 'normal');
    doc.setFontSize(10);

    if (section.body) {
      const lines = doc.splitTextToSize(section.body, contentW);
      checkPage(lines.length * 13 + 10);
      doc.text(lines, margin, y);
      y += lines.length * 13 + 8;
    }

    if (section.bullets) {
      for (const b of section.bullets) {
        checkPage(18);
        setColor(C.teal);
        doc.text('▸', margin, y);
        setColor(C.navy);
        const lines = doc.splitTextToSize(b, contentW - 16);
        doc.text(lines, margin + 14, y);
        y += lines.length * 13 + 4;
      }
    }

    if (section.table) {
      checkPage(36);
      const cols = section.table.headers.length;
      const colW = contentW / cols;
      const rowH = 16;

      // Header row
      setFill(C.border);
      doc.rect(margin, y - 11, contentW, rowH, 'F');
      setColor(C.navy);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      section.table.headers.forEach((h, i) => doc.text(h, margin + i * colW + 5, y));
      y += rowH;

      doc.setFont('courier', 'normal');
      for (let ri = 0; ri < section.table.rows.length; ri++) {
        const row = section.table.rows[ri];
        checkPage(rowH + 4);
        if (ri % 2 === 1) { setFill(C.surface); doc.rect(margin, y - 11, contentW, rowH, 'F'); }
        setColor(C.navy);
        row.forEach((c, i) => {
          const ls = doc.splitTextToSize(c, colW - 10);
          doc.text(ls, margin + i * colW + 5, y);
        });
        y += rowH;
      }
      y += 8;
    }

    y += 14;
  }

  doc.save(`${report.title.replace(/\s+/g, '_')}.pdf`);
}

export default function ReportsTab({ projectId, projectName, projectStartDate, messages, onMessagesChange, onReportSaved }: ReportsTabProps) {
  const { agent } = useAIAgent();
  const setMessages = onMessagesChange;
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [format,     setFormat]     = useState<ReportFormat>('docx');
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom,   setDateFrom]   = useState(() => projectStartDate ?? today);
  const [dateTo,     setDateTo]     = useState(today);
  const [generating,    setGenerating]    = useState(false);
  const [generateStatus, setGenerateStatus] = useState('');
  const [streamStatus,  setStreamStatus]  = useState('');
  const [error,         setError]         = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<ReportContent | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  const abort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setGenerating(false);
    setStreamStatus('');
    setGenerateStatus('');
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const GENERATE_INTENT = /\b(generate|create|make|build|produce|export|download|write|put together|compile)\b.{0,60}\b(report|doc|docx|pptx|pdf|powerpoint|word|presentation|summary|slide\s*deck|slides|deck|brief(?:ing)?|document)\b/i;

  // Detect which format the user is asking for from their message text
  function detectFormat(text: string): ReportFormat | null {
    if (/\bpptx\b|\bpowerpoint\b|\bslide\s*deck\b|\bslides\b|\bdeck\b|\bpresentation\b/i.test(text)) return 'pptx';
    if (/\bdocx\b|\bword\b|\bdoc\b/i.test(text)) return 'docx';
    if (/\bpdf\b/i.test(text)) return 'pdf';
    return null;
  }

  const defaultFrom = projectStartDate ?? today;

  const handleGenerate = async (promptOverride?: string, fromChat = false) => {
    // For button clicks with no dates, default to project start → today
    const effectiveFrom = dateFrom || defaultFrom;
    const effectiveTo   = dateTo   || today;

    // If triggered from chat, auto-switch format based on what the user asked for
    const detectedFormat = promptOverride ? detectFormat(promptOverride) : null;
    const activeFormat = detectedFormat ?? format;
    if (detectedFormat && detectedFormat !== format) setFormat(detectedFormat);

    const lastUserMsg = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
    const prompt = promptOverride ?? lastUserMsg ?? `Generate a comprehensive project status report for ${projectName}`;

    setGenerating(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    const phasesByFormat: Record<ReportFormat, string[]> = {
      pptx: [
        'Reading commits and codebase from all repos…',
        'Designing slide structure…',
        'Writing slide content…',
        'Building presentation…',
      ],
      docx: [
        'Reading commits and codebase from all repos…',
        'Outlining document sections…',
        'Writing section content…',
        'Formatting Word document…',
      ],
      pdf: [
        'Reading commits and codebase from all repos…',
        'Structuring report layout…',
        'Writing content…',
        'Generating PDF…',
      ],
    };
    const phases = phasesByFormat[activeFormat];
    let phaseIdx = 0;
    setGenerateStatus(phases[0]);
    const phaseTimer = setInterval(() => {
      phaseIdx = Math.min(phaseIdx + 1, phases.length - 1);
      setGenerateStatus(phases[phaseIdx]);
    }, 6000);

    try {
      const res = await fetch('/api/ai/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, projectId, format: activeFormat, prompt, dateFrom: effectiveFrom, dateTo: effectiveTo }),
        signal: controller.signal,
      });
      const data = await res.json();
      clearInterval(phaseTimer);
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
        setGenerating(false);
        setGenerateStatus('');
        return;
      }

      setLastReport(data);

      // Persist to saved_reports table (best-effort)
      supabase.from('saved_reports').insert({
        project_id:      projectId,
        title:           data.title,
        content:         data,
        format:          activeFormat,
        date_range_from: effectiveFrom || null,
        date_range_to:   effectiveTo   || null,
        generated_at:    new Date().toISOString(),
        provider:        data.provider ?? null,
      }).then(() => onReportSaved?.());

      if (activeFormat === 'docx') await downloadDocx(data);
      else if (activeFormat === 'pptx') await downloadPptx(data);
      else await downloadPdf(data);

      setMessages([...messages, {
        role: 'assistant',
        content: `✓ Report generated: **${data.title}** — ${data.sections.length} sections. The file has been downloaded to your device.`,
        provider: data.provider,
      }]);
    } catch (err: any) {
      clearInterval(phaseTimer);
      if (err?.name !== 'AbortError') {
        setError('Failed to generate report.');
        console.error(err);
      }
    }
    abortRef.current = null;
    setGenerating(false);
    setGenerateStatus('');
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || generating) return;

    // Auto-parse date range from message and update fields
    const parsed = parseDateRange(text);
    if (parsed.from) setDateFrom(parsed.from);
    if (parsed.to)   setDateTo(parsed.to);

    const userMsg: Message = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');

    // Detect generate intent — trigger report generation instead of chat
    if (GENERATE_INTENT.test(text)) {
      const fmt = detectFormat(text) ?? format;
      const fmtLabel = fmt === 'pptx' ? 'PowerPoint slide deck' : fmt === 'docx' ? 'Word document' : 'PDF';
      setMessages([...next, { role: 'assistant', content: `Got it — generating your ${fmtLabel} now…` }]);
      await handleGenerate(text, true);
      return;
    }

    setLoading(true);
    setStreamStatus('Sending…');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/ai/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, projectId, messages: next, reportMode: true }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError((data as any).error ?? `Error ${res.status}`);
        setLoading(false);
        setStreamStatus('');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'status') {
              setStreamStatus(event.text);
            } else if (event.type === 'done') {
              setMessages([...next, { role: 'assistant', content: event.message, provider: event.provider }]);
            } else if (event.type === 'error') {
              setError(event.message);
            }
          } catch { /* ignore malformed SSE chunk */ }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError('Network error — is the server running?');
      }
    }
    abortRef.current = null;
    setLoading(false);
    setStreamStatus('');
  };

  const formatBtns: { id: ReportFormat; label: string; icon: React.ReactNode }[] = [
    { id: 'docx', label: 'Word',       icon: <FileText size={13} /> },
    { id: 'pptx', label: 'PowerPoint', icon: <Presentation size={13} /> },
    { id: 'pdf',  label: 'PDF',        icon: <BarChart3 size={13} /> },
  ];

  return (
    <div className="rt-root flex flex-col">
      {/* Controls bar */}
      <div className="border border-border bg-surface p-4 mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Report start date"
            className="px-3 py-1.5 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 rounded" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Report end date"
            className="px-3 py-1.5 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 rounded" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Format</label>
          <div className="flex gap-1">
            {formatBtns.map((f) => (
              <button key={f.id} type="button" onClick={() => setFormat(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition-colors ${
                  format === f.id
                    ? 'bg-accent text-white border-accent'
                    : 'border-border text-muted hover:text-heading hover:bg-surface2'
                }`}>
                {f.icon}{f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {(generating || loading) && (
            <button
              type="button"
              onClick={abort}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-danger/40 text-danger text-xs rounded hover:bg-danger/10 transition-colors"
            >
              <X size={12} />
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => handleGenerate(undefined, false)}
            disabled={generating || loading}
            className="flex items-center gap-1.5 px-5 py-1.5 bg-accent text-white text-xs font-medium rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {generating ? (generateStatus || 'Generating…') : 'Generate & Download'}
          </button>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col border border-border bg-surface overflow-hidden min-h-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Bot size={28} className="text-muted/40 mx-auto mb-3" />
              <p className="text-sm text-muted font-sans">Describe the report you need</p>
              <p className="text-xs text-muted/60 mt-1 max-w-md mx-auto">
                Tell me what to include — e.g. "Create an analytical report on goal progress by category from the last 30 days,
                include who contributed most and what's at risk."
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {[
                  'Summarize all completed work this month',
                  'Analyze goal progress by category',
                  'Who is contributing the most?',
                  'What work is at risk or behind schedule?',
                ].map((hint) => (
                  <button key={hint} type="button" onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                    className="text-[10px] px-3 py-1.5 border border-border rounded text-muted hover:text-heading hover:bg-surface2 transition-colors font-mono">
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent text-white ml-4'
                  : 'bg-surface2 border border-border text-heading mr-4'
              }`}>
                {msg.content}
                {msg.role === 'assistant' && msg.provider && (
                  <div className="text-[9px] text-muted mt-1 text-right opacity-60">{msg.provider}</div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface2 border border-border px-3 py-2 rounded flex items-center gap-2 mr-4">
                <Loader2 size={11} className="animate-spin text-accent" />
                <span className="text-[10px] text-muted font-mono">{streamStatus || 'Thinking…'}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-[10px] text-danger bg-danger/5 border border-danger/20 rounded px-3 py-2 font-mono">
              <X size={11} />
              {error}
            </div>
          )}

          {lastReport && (
            <div className="flex justify-start mr-4">
              <div className="bg-accent3/5 border border-accent3/20 rounded p-3 text-xs max-w-[85%]">
                <div className="flex items-center gap-1.5 mb-1 text-accent3 font-medium">
                  <Download size={11} />
                  Report Ready — {lastReport.sections.length} sections
                </div>
                <button type="button" onClick={handleGenerate} disabled={generating}
                  className="text-[10px] text-accent hover:underline">
                  Re-download
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-border p-3 flex gap-2 items-end bg-surface">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Describe what the report should cover…"
            rows={1}
            className="rt-input flex-1 bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 px-3 py-2 focus:outline-none focus:border-accent/50 transition-colors resize-none rounded"
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 90) + 'px';
            }}
          />
          {loading ? (
            <button type="button" title="Stop" onClick={abort}
              className="p-2 bg-danger/10 border border-danger/40 text-danger rounded hover:bg-danger/20 transition-colors shrink-0">
              <X size={13} />
            </button>
          ) : (
            <button type="button" title="Send" onClick={sendMessage} disabled={!input.trim()}
              className="p-2 bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-40 shrink-0">
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
