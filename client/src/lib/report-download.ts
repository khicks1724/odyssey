// Shared report download utilities extracted from ReportsTab.tsx
// Used by both ReportsTab and DocumentsTab (in ProjectDetailPage)

export interface ReportSection {
  title: string;
  body: string;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
}

export interface ReportContent {
  title: string;
  subtitle: string;
  projectName: string;
  generatedAt: string;
  dateRange?: { from: string; to: string };
  executiveSummary: string;
  sections: ReportSection[];
  rawData?: {
    goals: { title: string; status: string; progress: number; category: string; deadline: string | null }[];
    statusCounts: Record<string, number>;
    categoryAvg: Record<string, number>;
    memberCount: number;
    totalGoals: number;
  };
}

// ── Ivory theme palette (hex without #) ──────────────────────────────────────
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

export async function downloadDocx(report: ReportContent) {
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
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: T.accent } },
    spacing: { after: 240 },
    children: [],
  }));
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Executive Summary', bold: true, color: T.accent, font: 'Syne', size: 30 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: report.executiveSummary, color: T.text, font: 'DM Mono', size: 22 })],
  }));

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
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
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

export async function downloadPptx(report: ReportContent) {
  const pptxgen = (await import('pptxgenjs')).default;
  const prs = new pptxgen();
  prs.layout = 'LAYOUT_WIDE';

  const BG      = 'F5F0E8';
  const NAVY    = '0F1F33';
  const ACCENT  = '1E3A5F';
  const TEAL    = '3A7A6A';
  const MUTED   = '6B7A8D';
  const BORDER  = 'C8C0B4';
  const SURFACE = 'ECE7DF';
  const AMBER   = 'E8A235';
  const ACCENT2 = '2A5A8F';

  const CAT_COLORS: Record<string, string> = {
    Testing: 'E85555', Seeker: '3B8EEA', Missile: 'E8A235',
    Admin: 'BD93F9', Simulation: '52C98E', DevOps: 'DC7070',
    Uncategorized: '5A6A7E',
  };
  const STATUS_COLORS = [BORDER, ACCENT2, AMBER, TEAL];

  const addBg = (slide: ReturnType<typeof prs.addSlide>) => {
    slide.background = { fill: BG };
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.1, fill: { color: ACCENT } });
  };

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

  const sumSlide = prs.addSlide();
  addBg(sumSlide);
  sumSlide.addText('Executive Summary', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT, fontFace: 'Syne' });
  sumSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });
  sumSlide.addText(report.executiveSummary, { x: 0.5, y: 1.0, w: 7.5, h: 5.8, fontSize: 13, color: NAVY, fontFace: 'DM Mono', valign: 'top', paraSpaceBefore: 0, paraSpaceAfter: 8 });
  if (report.rawData) {
    const sc = report.rawData.statusCounts;
    const labels = ['Not Started', 'In Progress', 'In Review', 'Complete'];
    const values = [sc['not_started'] ?? 0, sc['in_progress'] ?? 0, sc['in_review'] ?? 0, sc['complete'] ?? 0];
    if (values.some((v) => v > 0)) {
      sumSlide.addText('Goal Status', { x: 8.3, y: 1.0, w: 4.5, h: 0.4, fontSize: 12, bold: true, color: MUTED, fontFace: 'Syne', align: 'center' });
      sumSlide.addChart('doughnut' as any, [{ name: 'Status', labels, values }], {
        x: 8.2, y: 1.4, w: 4.6, h: 3.2,
        chartColors: STATUS_COLORS,
        showLegend: true, legendPos: 'b', legendFontSize: 10, legendColor: MUTED,
        holeSize: 55, showTitle: false,
        dataLabelFontSize: 11, dataLabelColor: NAVY, dataLabelFormatCode: '0',
      } as any);
      const complete = sc['complete'] ?? 0;
      const total = values.reduce((a, b) => a + b, 0);
      const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
      sumSlide.addText(`${pct}%`, { x: 9.5, y: 4.9, w: 2.2, h: 0.8, fontSize: 32, bold: true, color: TEAL, fontFace: 'Syne', align: 'center' });
      sumSlide.addText('Complete', { x: 9.5, y: 5.65, w: 2.2, h: 0.3, fontSize: 10, color: MUTED, fontFace: 'DM Mono', align: 'center' });
    }
  }

  if (report.rawData && report.rawData.goals.length > 0) {
    const goals = report.rawData.goals;
    const chartSlide = prs.addSlide();
    addBg(chartSlide);
    chartSlide.addText('Goal Progress Overview', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT, fontFace: 'Syne' });
    chartSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });
    const labels = goals.map((g) => g.title.length > 28 ? g.title.slice(0, 26) + '…' : g.title);
    const values = goals.map((g) => g.progress);
    const barColors = goals.map((g) => CAT_COLORS[g.category] ?? '5A6A7E');
    chartSlide.addChart('bar' as any, [{ name: 'Progress %', labels, values }], {
      x: 0.4, y: 1.0, w: 8.5, h: 5.9, barDir: 'bar',
      chartColors: barColors, showValue: true, dataLabelFontSize: 10, dataLabelColor: NAVY,
      dataLabelFormatCode: '0"%"', catAxisLabelColor: MUTED, catAxisFontSize: 10,
      valAxisLabelColor: MUTED, valAxisMaxVal: 100, showTitle: false, showLegend: false, barGapWidthPct: 35,
    } as any);
    const usedCats = [...new Set(goals.map((g) => g.category))];
    let ly = 1.1;
    chartSlide.addText('Category', { x: 9.2, y: 0.95, w: 3.6, h: 0.35, fontSize: 11, bold: true, color: MUTED, fontFace: 'Syne' });
    for (const cat of usedCats) {
      chartSlide.addShape(prs.ShapeType.rect, { x: 9.2, y: ly, w: 0.18, h: 0.18, fill: { color: CAT_COLORS[cat] ?? '5A6A7E' } });
      chartSlide.addText(cat, { x: 9.5, y: ly - 0.02, w: 3.3, h: 0.22, fontSize: 10, color: NAVY, fontFace: 'DM Mono' });
      ly += 0.32;
    }
    const complete = goals.filter((g) => g.status === 'complete').length;
    const avgProgress = Math.round(goals.reduce((a, g) => a + g.progress, 0) / goals.length);
    ly += 0.3;
    for (const s of [{ label: 'Avg Progress', value: `${avgProgress}%` }, { label: 'Done', value: `${complete} / ${goals.length}` }]) {
      chartSlide.addShape(prs.ShapeType.rect, { x: 9.2, y: ly, w: 3.6, h: 0.8, fill: { color: SURFACE }, line: { color: BORDER, pt: 0.5 } });
      chartSlide.addText(s.value, { x: 9.2, y: ly + 0.02, w: 3.6, h: 0.4, fontSize: 20, bold: true, color: ACCENT, fontFace: 'Syne', align: 'center' });
      chartSlide.addText(s.label, { x: 9.2, y: ly + 0.42, w: 3.6, h: 0.28, fontSize: 9, color: MUTED, fontFace: 'DM Mono', align: 'center' });
      ly += 1.0;
    }
  }

  if (report.rawData && Object.keys(report.rawData.categoryAvg).length > 1) {
    const catSlide = prs.addSlide();
    addBg(catSlide);
    catSlide.addText('Progress by Category', { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: ACCENT, fontFace: 'Syne' });
    catSlide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });
    const cats = Object.keys(report.rawData.categoryAvg);
    const avgs = Object.values(report.rawData.categoryAvg);
    catSlide.addChart('bar' as any, [{ name: 'Avg Progress %', labels: cats, values: avgs }], {
      x: 0.4, y: 1.0, w: 7.0, h: 5.9, barDir: 'col',
      chartColors: cats.map((c) => CAT_COLORS[c] ?? '5A6A7E'),
      showValue: true, dataLabelFontSize: 12, dataLabelColor: NAVY,
      dataLabelFormatCode: '0"%"', catAxisLabelColor: MUTED, catAxisFontSize: 11,
      valAxisLabelColor: MUTED, valAxisMaxVal: 100, showTitle: false, showLegend: false, barGapWidthPct: 40,
    } as any);
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

  for (const section of report.sections) {
    const slide = prs.addSlide();
    addBg(slide);
    slide.addText(section.title, { x: 0.5, y: 0.2, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: TEAL, fontFace: 'Syne' });
    slide.addShape(prs.ShapeType.rect, { x: 0.5, y: 0.88, w: 12.3, h: 0.025, fill: { color: BORDER } });
    if (section.table && section.table.rows.length > 0) {
      if (section.body) slide.addText(section.body, { x: 0.5, y: 1.0, w: 12.3, h: 1.0, fontSize: 11, color: ACCENT, fontFace: 'DM Mono', valign: 'top' });
      const tableTop = section.body ? 2.1 : 1.05;
      const tableData = [
        section.table.headers.map((h) => ({ text: h, options: { bold: true, fill: BORDER, color: NAVY, fontFace: 'Syne', fontSize: 10 } })),
        ...section.table.rows.slice(0, 10).map((r, ri) => r.map((c) => ({ text: c, options: { fill: ri % 2 === 0 ? BG : SURFACE, color: NAVY, fontFace: 'DM Mono', fontSize: 10 } }))),
      ];
      slide.addTable(tableData as Parameters<typeof slide.addTable>[0], { x: 0.5, y: tableTop, w: 12.3, border: { pt: 0.5, color: BORDER }, rowH: 0.36 });
    } else {
      const hasBody = !!section.body;
      const hasBullets = section.bullets && section.bullets.length > 0;
      if (hasBody && hasBullets) {
        slide.addText(section.body!, { x: 0.5, y: 1.0, w: 5.9, h: 5.8, fontSize: 12, color: NAVY, fontFace: 'DM Mono', valign: 'top', paraSpaceAfter: 6 });
        slide.addShape(prs.ShapeType.rect, { x: 6.6, y: 1.0, w: 0.025, h: 5.8, fill: { color: BORDER } });
        slide.addText(section.bullets!.map((b) => ({ text: b, options: { bullet: { code: '25B8', color: TEAL }, color: NAVY, fontSize: 12, fontFace: 'DM Mono', paraSpaceAfter: 10 } as any })), { x: 6.8, y: 1.0, w: 6.0, h: 5.8, valign: 'top' });
      } else if (hasBody) {
        slide.addText(section.body!, { x: 0.5, y: 1.0, w: 12.3, h: 5.8, fontSize: 13, color: NAVY, fontFace: 'DM Mono', valign: 'top', paraSpaceAfter: 8 });
      } else if (hasBullets) {
        slide.addText(section.bullets!.map((b) => ({ text: b, options: { bullet: { code: '25B8', color: TEAL }, color: NAVY, fontSize: 13, fontFace: 'DM Mono', paraSpaceAfter: 12 } as any })), { x: 0.5, y: 1.0, w: 12.3, h: 5.8, valign: 'top' });
      }
    }
  }

  await prs.writeFile({ fileName: `${report.title.replace(/\s+/g, '_')}.pptx` });
}

export async function downloadPdf(report: ReportContent) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const margin  = 56;
  const pageW   = doc.internal.pageSize.getWidth();
  const pageH   = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  let y = margin;

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

  setDraw(C.accent);
  doc.setLineWidth(1.5);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

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

  for (const section of report.sections) {
    checkPage(44);
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

export function exportGoalsCSV(report: ReportContent) {
  if (!report.rawData?.goals?.length) return;
  const headers = ['Title', 'Status', 'Progress', 'Category', 'Deadline'];
  const rows = report.rawData.goals.map((g) => [
    `"${g.title.replace(/"/g, '""')}"`,
    g.status,
    String(g.progress),
    g.category || '',
    g.deadline || '',
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.title.replace(/\s+/g, '_')}_goals.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
