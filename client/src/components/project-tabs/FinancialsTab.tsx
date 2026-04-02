import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Pencil, Check, X, Upload, Download, DollarSign,
  TrendingDown, TrendingUp, BarChart2, Sparkles, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import * as XLSX from 'xlsx';
import './FinancialsTab.css';

interface FinancialRow {
  id: string;
  label: string;
  amount: number;
  category: 'budget' | 'expense' | 'revenue';
  note: string | null;
  date: string | null;
  sheet_name: string | null;
  created_by: string | null;
}

const CAT_LABEL: Record<string, string> = { budget: 'Budget', expense: 'Expense', revenue: 'Revenue' };
const CAT_COLOR: Record<string, string> = {
  budget:  'text-[#3b8eea] border-[#3b8eea]/30 bg-[#3b8eea]/8',
  expense: 'text-[#e85555] border-[#e85555]/30 bg-[#e85555]/8',
  revenue: 'text-[#52c98e] border-[#52c98e]/30 bg-[#52c98e]/8',
};
const CAT_BAR: Record<string, string> = {
  budget:  'bg-[#3b8eea]',
  expense: 'bg-[#e85555]',
  revenue: 'bg-[#52c98e]',
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function parseAmount(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'number') {
    // Excel serial date
    try {
      const d = XLSX.SSF.parse_date_code(v);
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    } catch { return null; }
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return null;
  const [, a, b, c] = m;
  if (a.length === 4) return `${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`;
  const year = c.length === 2 ? `20${c}` : c;
  return `${year}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`;
}

function inferCategory(sheetName: string, colCategory: string): 'budget' | 'expense' | 'revenue' {
  const s = (sheetName + ' ' + colCategory).toLowerCase();
  if (/budget|plan|alloc/.test(s)) return 'budget';
  if (/revenue|income|earn|receipt/.test(s)) return 'revenue';
  return 'expense';
}

/** Find the likely header row in a raw sheet (first row where most cells are non-numeric strings) */
function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i];
    const textCells = row.filter((c) => typeof c === 'string' && c.trim().length > 0);
    if (textCells.length >= 2) return i;
  }
  return 0;
}

/** Parse an XLSX/CSV file and return rows ready for DB insert */
function parseSpreadsheet(
  buffer: ArrayBuffer,
  fileName: string,
): Omit<FinancialRow, 'id' | 'created_by'>[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const results: Omit<FinancialRow, 'id' | 'created_by'>[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
    if (aoa.length < 2) continue;

    const headerIdx = findHeaderRow(aoa);
    const headers = (aoa[headerIdx] as unknown[]).map((h) => String(h ?? '').toLowerCase().trim());

    // Map semantic column indices
    const amountIdx   = headers.findIndex((h) => /amount|cost|price|total|budget|value|spend|expense|actual|est/i.test(h));
    const labelIdx    = headers.findIndex((h) => /name|label|desc|item|title|task|activity|account|line/i.test(h));
    const dateIdx     = headers.findIndex((h) => /date|when|period|month/i.test(h));
    const categoryIdx = headers.findIndex((h) => /^(category|type|class|kind|group)$/i.test(h));
    const noteIdx     = headers.findIndex((h) => /note|comment|remark|detail/i.test(h));

    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] as unknown[];
      const label  = labelIdx  >= 0 ? String(row[labelIdx]  ?? '').trim() : '';
      const amount = amountIdx >= 0 ? parseAmount(row[amountIdx]) : 0;
      if (!label && !amount) continue;

      const catRaw   = categoryIdx >= 0 ? String(row[categoryIdx] ?? '').trim() : '';
      const category = inferCategory(sheetName, catRaw);
      const dateStr  = dateIdx >= 0 ? parseDate(row[dateIdx]) : null;
      const note     = noteIdx >= 0 ? String(row[noteIdx] ?? '').trim() || null : null;
      const finalLabel = label || `${sheetName} row ${r}`;

      results.push({ label: finalLabel, amount, category, note, date: dateStr, sheet_name: sheetName });
    }
  }

  // Fallback: CSV plain text
  if (results.length === 0 && fileName.toLowerCase().endsWith('.csv')) {
    const decoder = new TextDecoder();
    const text = decoder.decode(buffer);
    const lines = text.trim().split('\n');
    if (lines.length >= 2) {
      const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, '').toLowerCase());
      const labelI = header.findIndex((h) => /label|name|desc/.test(h));
      const amtI   = header.findIndex((h) => /amount|cost|value/.test(h));
      const catI   = header.findIndex((h) => /category/.test(h));
      const dateI  = header.findIndex((h) => /date/.test(h));
      const noteI  = header.findIndex((h) => /note/.test(h));
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
        const label  = labelI >= 0 ? cols[labelI] ?? '' : '';
        const amount = parseAmount(amtI >= 0 ? cols[amtI] : '0');
        if (!label) continue;
        const catRaw = catI >= 0 ? cols[catI] : '';
        results.push({
          label,
          amount,
          category: inferCategory('', catRaw),
          note: noteI >= 0 ? cols[noteI] || null : null,
          date: dateI >= 0 ? parseDate(cols[dateI]) : null,
          sheet_name: null,
        });
      }
    }
  }

  return results;
}

// ── Simple SVG chart helpers ──────────────────────────────────────────────────

function HorizBar({ value, max, color, label, formatted }: {
  value: number; max: number; color: string; label: string; formatted: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="w-28 truncate text-muted text-right shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-surface2 rounded-full overflow-hidden">
        <div className={`fin-bar-fill h-full rounded-full ${color} transition-all duration-500`} style={{ '--fin-pct': `${pct}%` } as React.CSSProperties} />
      </div>
      <span className="w-16 text-right text-heading shrink-0">{formatted}</span>
    </div>
  );
}

interface Props { projectId: string; }

export default function FinancialsTab({ projectId }: Props) {
  const { user } = useAuth();
  const [rows, setRows]       = useState<FinancialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId]   = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<FinancialRow>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addBuf, setAddBuf]   = useState<{ label: string; amount: string; category: 'budget' | 'expense' | 'revenue'; note: string; date: string }>(
    { label: '', amount: '', category: 'expense', note: '', date: '' }
  );
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [filterCat, setFilterCat]   = useState<'all' | 'budget' | 'expense' | 'revenue'>('all');
  const [activeSheet, setActiveSheet] = useState<string | null>(null); // null = All Sheets
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [aiLoading, setAiLoading]   = useState(false);
  const [clearing, setClearing]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('project_financials')
      .select('*')
      .eq('project_id', projectId)
      .order('date', { ascending: true, nullsFirst: false });
    if (data) setRows(data as FinancialRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // ── Clear all data ────────────────────────────────────────────────────────
  const handleClearAll = async () => {
    if (!window.confirm('Delete ALL financial data for this project? This cannot be undone.')) return;
    setClearing(true);
    await supabase.from('project_financials').delete().eq('project_id', projectId);
    setRows([]);
    setActiveSheet(null);
    setClearing(false);
  };

  // ── Sheet tabs (derived from data) ───────────────────────────────────────
  const sheetNames = [...new Set(rows.map((r) => r.sheet_name).filter(Boolean))] as string[];
  const hasSheets  = sheetNames.length > 1;

  // ── Metrics ──────────────────────────────────────────────────────────────
  const totalBudget  = rows.filter((r) => r.category === 'budget').reduce((s, r) => s + r.amount, 0);
  const totalExpense = rows.filter((r) => r.category === 'expense').reduce((s, r) => s + r.amount, 0);
  const totalRevenue = rows.filter((r) => r.category === 'revenue').reduce((s, r) => s + r.amount, 0);
  const burnRate     = totalBudget > 0 ? (totalExpense / totalBudget) * 100 : null;
  const remaining    = totalBudget - totalExpense;
  const variance     = totalBudget - totalExpense;

  // ── Category breakdown (top labels by amount within each category) ────────
  const labelTotals = rows.reduce<Record<string, { amount: number; category: string }>>((acc, r) => {
    const key = r.label.length > 30 ? r.label.slice(0, 28) + '…' : r.label;
    if (!acc[key]) acc[key] = { amount: 0, category: r.category };
    acc[key].amount += r.amount;
    return acc;
  }, {});
  const topExpenses = Object.entries(labelTotals)
    .filter(([, v]) => v.category === 'expense')
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 8);
  const maxExpense = topExpenses[0]?.[1].amount ?? 0;

  // ── Spend over time ───────────────────────────────────────────────────────
  const rowsWithDate = rows.filter((r) => r.date && r.category === 'expense').sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const monthlySpend: Record<string, number> = {};
  rowsWithDate.forEach((r) => {
    if (!r.date) return;
    const month = r.date.slice(0, 7); // YYYY-MM
    monthlySpend[month] = (monthlySpend[month] ?? 0) + r.amount;
  });
  const monthlyKeys  = Object.keys(monthlySpend).sort();
  const maxMonthly   = Math.max(...Object.values(monthlySpend), 1);

  // ── Add row ───────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!addBuf.label.trim()) { setError('Label is required'); return; }
    setSaving(true); setError(null);
    const { error: err } = await supabase.from('project_financials').insert({
      project_id: projectId,
      label: addBuf.label.trim(),
      amount: parseFloat(addBuf.amount) || 0,
      category: addBuf.category,
      note: addBuf.note.trim() || null,
      date: addBuf.date || null,
      created_by: user?.id ?? null,
    });
    if (err) { setError(err.message); setSaving(false); return; }
    setAddOpen(false);
    setAddBuf({ label: '', amount: '', category: 'expense', note: '', date: '' });
    setSaving(false);
    fetchRows();
  };

  // ── Edit row ──────────────────────────────────────────────────────────────
  const startEdit  = (row: FinancialRow) => { setEditId(row.id); setEditBuf({ label: row.label, amount: row.amount, category: row.category, note: row.note ?? '', date: row.date ?? '' }); };
  const cancelEdit = () => { setEditId(null); setEditBuf({}); };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true); setError(null);
    const { error: err } = await supabase.from('project_financials').update({
      label: editBuf.label ?? '',
      amount: Number(editBuf.amount) || 0,
      category: editBuf.category ?? 'expense',
      note: (editBuf.note as string)?.trim() || null,
      date: (editBuf.date as string) || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editId);
    if (err) { setError(err.message); } else { cancelEdit(); fetchRows(); }
    setSaving(false);
  };

  // ── Delete row ────────────────────────────────────────────────────────────
  const deleteRow = async (id: string) => {
    await supabase.from('project_financials').delete().eq('id', id);
    fetchRows();
  };

  // ── File import (CSV or XLSX) ─────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setSaving(true); setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSpreadsheet(buffer, file.name);
      if (!parsed.length) {
        setError('No valid rows found. Ensure the file has amount and label/name columns.');
        setSaving(false);
        return;
      }
      const inserts = parsed.map((r) => ({ ...r, project_id: projectId, created_by: user?.id ?? null }));
      const { error: err } = await supabase.from('project_financials').insert(inserts);
      if (err) setError(err.message); else { fetchRows(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file');
    }
    setSaving(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const header = 'label,amount,category,note,date';
    const lines = rows.map((r) => [r.label, r.amount, r.category, r.note ?? '', r.date ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `financials-${projectId.slice(0, 8)}.csv`; a.click();
  };

  // ── AI Insights ───────────────────────────────────────────────────────────
  const getAiInsights = async () => {
    if (!rows.length) return;
    setAiLoading(true); setAiInsights(null);
    try {
      const summary = {
        totalBudget, totalExpense, totalRevenue, remaining, burnRate,
        topExpenses: topExpenses.slice(0, 5).map(([l, v]) => ({ label: l, amount: v.amount })),
        rowCount: rows.length,
      };
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const resp = await fetch('/api/ai/project-insights', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          customPrompt: `Analyze this project's financial data and provide 3-5 concise insights:\n${JSON.stringify(summary, null, 2)}\n\nFocus on: budget utilization, spending trends, anomalies, and recommendations. Be direct and specific with numbers.`,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setAiInsights(data.insights ?? data.content ?? data.text ?? 'Analysis complete.');
      } else {
        setAiInsights('Could not generate insights at this time.');
      }
    } catch {
      setAiInsights('Could not generate insights at this time.');
    }
    setAiLoading(false);
  };

  const inputCls  = 'px-2 py-1 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 rounded w-full';
  const selectCls = 'px-2 py-1 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 rounded';

  const sheetRows   = activeSheet ? rows.filter((r) => r.sheet_name === activeSheet) : rows;
  const visibleRows = filterCat === 'all' ? sheetRows : sheetRows.filter((r) => r.category === filterCat);

  return (
    <div className="space-y-6">

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Budget',   value: fmt(totalBudget),  icon: DollarSign,   color: 'text-[#3b8eea]' },
          { label: 'Total Expenses', value: fmt(totalExpense), icon: TrendingDown,  color: 'text-[#e85555]' },
          { label: 'Revenue',        value: fmt(totalRevenue), icon: TrendingUp,    color: 'text-[#52c98e]' },
          { label: 'Remaining',      value: fmt(remaining),    icon: DollarSign,    color: remaining >= 0 ? 'text-[#52c98e]' : 'text-[#e85555]' },
          { label: 'Variance',       value: variance >= 0 ? fmt(variance) : `(${fmt(Math.abs(variance))})`, icon: BarChart2, color: variance >= 0 ? 'text-[#52c98e]' : 'text-[#e85555]' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="border border-border bg-surface p-4 rounded">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon size={11} className={color} />
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted">{label}</span>
            </div>
            <p className={`text-base font-mono font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Burn rate ── */}
      {burnRate !== null && (
        <div className="border border-border bg-surface p-4 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Budget Utilization</span>
            <span className={`text-xs font-mono font-bold ${burnRate > 90 ? 'text-[#e85555]' : burnRate > 70 ? 'text-[#e8a235]' : 'text-[#52c98e]'}`}>{burnRate.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-surface2 rounded-full overflow-hidden">
            <div
              className={`fin-bar-fill h-full rounded-full transition-all duration-500 ${burnRate > 90 ? 'bg-[#e85555]' : burnRate > 70 ? 'bg-[#e8a235]' : 'bg-[#52c98e]'}`}
              style={{ '--fin-pct': `${Math.min(100, burnRate)}%` } as React.CSSProperties}
            />
          </div>
          {burnRate > 100 && <p className="text-[10px] text-[#e85555] font-mono mt-1">⚠ Expenses exceed budget by {fmt(totalExpense - totalBudget)}</p>}
        </div>
      )}

      {/* ── Charts ── */}
      {rows.length > 0 && (
        <div className="border border-border bg-surface rounded overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-surface2/30 transition-colors"
            onClick={() => setChartsOpen((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <BarChart2 size={13} className="text-accent" />
              <span className="text-xs font-semibold text-heading">Financial Breakdown</span>
            </div>
            {chartsOpen ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
          </button>

          {chartsOpen && (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Category totals comparison */}
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-3">Category Totals</p>
                <div className="space-y-2">
                  {[
                    { cat: 'budget',  total: totalBudget,  label: 'Budget',   cls: 'bg-[#3b8eea]' },
                    { cat: 'expense', total: totalExpense, label: 'Expenses',  cls: 'bg-[#e85555]' },
                    { cat: 'revenue', total: totalRevenue, label: 'Revenue',  cls: 'bg-[#52c98e]' },
                  ].filter((c) => c.total > 0).map(({ label, total, cls }) => {
                    const max = Math.max(totalBudget, totalExpense, totalRevenue);
                    const pct = max > 0 ? (total / max) * 100 : 0;
                    return (
                      <div key={label} className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="w-16 text-muted shrink-0">{label}</span>
                        <div className="flex-1 h-4 bg-surface2 rounded overflow-hidden">
                          <div className={`fin-bar-fill h-full rounded ${cls} transition-all duration-500`} style={{ '--fin-pct': `${pct}%` } as React.CSSProperties} />
                        </div>
                        <span className="w-20 text-right text-heading shrink-0">{fmt(total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top expense items */}
              {topExpenses.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-3">Top Expense Items</p>
                  <div className="space-y-1.5">
                    {topExpenses.map(([label, v]) => (
                      <HorizBar key={label} value={v.amount} max={maxExpense} color="bg-[#e85555]" label={label} formatted={fmt(v.amount)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly spend (if dates present) */}
              {monthlyKeys.length >= 2 && (
                <div className="md:col-span-2">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted mb-3">Monthly Expense Trend</p>
                  <div className="flex items-end gap-1 h-24">
                    {monthlyKeys.map((m) => {
                      const val = monthlySpend[m] ?? 0;
                      const pct = (val / maxMonthly) * 100;
                      return (
                        <div key={m} className="flex-1 flex flex-col items-center gap-0.5 group">
                          <div className="fin-col-wrap w-full relative">
                            <div
                              className="fin-col-fill absolute bottom-0 left-0 right-0 bg-[#e8a235]/70 rounded-t transition-all duration-500 group-hover:bg-[#e8a235]"
                              style={{ '--fin-h': `${pct}%` } as React.CSSProperties}
                              title={`${m}: ${fmt(val)}`}
                            />
                          </div>
                          <span className="text-[8px] font-mono text-muted/60 leading-none">{m.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AI Insights ── */}
      {rows.length > 0 && (
        <div className="border border-border bg-surface rounded overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-accent" />
              <span className="text-xs font-semibold text-heading">AI Financial Insights</span>
            </div>
            <button
              type="button"
              onClick={getAiInsights}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono border border-border rounded text-muted hover:text-heading hover:bg-surface2 transition-colors disabled:opacity-50"
            >
              {aiLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              {aiLoading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
          {aiInsights ? (
            <div className="px-4 py-3">
              <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap">{aiInsights}</p>
            </div>
          ) : (
            !aiLoading && <p className="px-4 py-3 text-[10px] text-muted/50 font-mono">Click Analyze to generate AI-powered financial insights from your data.</p>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 border border-danger/20 bg-danger/5 text-danger text-xs font-mono rounded flex items-center justify-between">
          {error}
          <button type="button" title="Dismiss" onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-xs font-semibold uppercase tracking-wider rounded hover:bg-accent/5 transition-colors"
        >
          <Plus size={12} /> Add Row
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          title="Import CSV or XLSX (multi-sheet supported)"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted text-xs font-semibold uppercase tracking-wider rounded hover:bg-surface2 hover:text-heading transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {saving ? 'Importing…' : 'Import'}
        </button>
        {rows.length > 0 && (
          <>
            <button
              type="button"
              onClick={exportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted text-xs font-semibold uppercase tracking-wider rounded hover:bg-surface2 hover:text-heading transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearing}
              title="Delete all financial data for this project"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-danger/30 text-danger/70 text-xs font-semibold uppercase tracking-wider rounded hover:bg-danger/5 hover:text-danger transition-colors disabled:opacity-50"
            >
              {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {clearing ? 'Clearing…' : 'Clear All'}
            </button>
          </>
        )}
        {/* Category filter */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted font-mono">Show:</span>
          {(['all', 'budget', 'expense', 'revenue'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilterCat(c)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${filterCat === c ? 'border-accent/30 bg-accent/8 text-accent' : 'border-border text-muted hover:text-heading hover:bg-surface2'}`}
            >
              {c === 'all' ? 'All' : CAT_LABEL[c]}
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          title="Import file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />
      </div>

      {/* ── Sheet tabs (only shown when data has multiple sheets) ── */}
      {hasSheets && (
        <div className="flex items-center gap-1 flex-wrap border-b border-border pb-1">
          <button
            type="button"
            onClick={() => setActiveSheet(null)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-t border-b-2 transition-colors ${!activeSheet ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-heading'}`}
          >
            All Sheets
          </button>
          {sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveSheet(name)}
              className={`text-[10px] font-mono px-2.5 py-1 rounded-t border-b-2 transition-colors ${activeSheet === name ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-heading'}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* ── Add row form ── */}
      {addOpen && (
        <div className="border border-accent/20 bg-accent/5 rounded p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted">New Entry</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input placeholder="Label *" value={addBuf.label} onChange={(e) => setAddBuf((p) => ({ ...p, label: e.target.value }))} className={inputCls} />
            <input placeholder="Amount" type="number" value={addBuf.amount} onChange={(e) => setAddBuf((p) => ({ ...p, amount: e.target.value }))} className={inputCls} />
            <select value={addBuf.category} onChange={(e) => setAddBuf((p) => ({ ...p, category: e.target.value as any }))} className={selectCls} aria-label="Category">
              <option value="expense">Expense</option>
              <option value="budget">Budget</option>
              <option value="revenue">Revenue</option>
            </select>
            <input placeholder="Date" type="date" title="Date" value={addBuf.date} onChange={(e) => setAddBuf((p) => ({ ...p, date: e.target.value }))} className={inputCls} />
          </div>
          <input placeholder="Note (optional)" value={addBuf.note} onChange={(e) => setAddBuf((p) => ({ ...p, note: e.target.value }))} className={inputCls} />
          <div className="flex gap-2">
            <button type="button" onClick={handleAdd} disabled={saving} className="px-4 py-1.5 border border-accent/30 bg-accent/10 text-accent text-xs font-semibold uppercase tracking-wider rounded hover:bg-accent/20 transition-colors disabled:opacity-50 flex items-center gap-1.5">
              <Check size={11} /> Save
            </button>
            <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-1.5 border border-border text-muted text-xs font-semibold uppercase tracking-wider rounded hover:bg-surface2 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="py-8 text-center text-xs text-muted font-mono">Loading…</div>
      ) : visibleRows.length === 0 ? (
        <div className="py-12 text-center border border-border rounded bg-surface">
          <DollarSign size={24} className="text-muted/30 mx-auto mb-3" />
          <p className="text-xs text-muted">{rows.length === 0 ? 'No financial data yet. Add rows manually or import a CSV/XLSX file.' : 'No entries match the selected filter.'}</p>
          {rows.length === 0 && <p className="text-[10px] text-muted/60 mt-1 font-mono">Supports CSV and multi-sheet XLSX with automatic column detection</p>}
        </div>
      ) : (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-surface2 border-b border-border text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left px-3 py-2">Label</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Note</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Date</th>
                <th className="px-3 py-2 w-14"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-surface2/50 transition-colors">
                  {editId === row.id ? (
                    <>
                      <td className="px-2 py-1.5"><input title="Label" placeholder="Label" value={editBuf.label ?? ''} onChange={(e) => setEditBuf((p) => ({ ...p, label: e.target.value }))} className={inputCls} /></td>
                      <td className="px-2 py-1.5">
                        <select value={editBuf.category ?? 'expense'} onChange={(e) => setEditBuf((p) => ({ ...p, category: e.target.value as any }))} className={selectCls} aria-label="Category">
                          <option value="expense">Expense</option>
                          <option value="budget">Budget</option>
                          <option value="revenue">Revenue</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right"><input type="number" title="Amount" placeholder="0" value={String(editBuf.amount ?? '')} onChange={(e) => setEditBuf((p) => ({ ...p, amount: parseFloat(e.target.value) || 0 }))} className={`${inputCls} text-right`} /></td>
                      <td className="px-2 py-1.5 hidden sm:table-cell"><input title="Note" placeholder="Note" value={editBuf.note as string ?? ''} onChange={(e) => setEditBuf((p) => ({ ...p, note: e.target.value }))} className={inputCls} /></td>
                      <td className="px-2 py-1.5 hidden sm:table-cell"><input type="date" title="Date" value={editBuf.date as string ?? ''} onChange={(e) => setEditBuf((p) => ({ ...p, date: e.target.value }))} className={inputCls} /></td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1 justify-end">
                          <button type="button" title="Save" onClick={saveEdit} disabled={saving} className="p-1 text-accent hover:text-heading transition-colors"><Check size={12} /></button>
                          <button type="button" title="Cancel" onClick={cancelEdit} className="p-1 text-muted hover:text-heading transition-colors"><X size={12} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-heading">{row.label}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[9px] border px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${CAT_COLOR[row.category]}`}>{CAT_LABEL[row.category]}</span>
                      </td>
                      <td className={`px-3 py-2 text-right font-bold ${row.category === 'expense' ? 'text-[#e85555]' : row.category === 'revenue' ? 'text-[#52c98e]' : 'text-[#3b8eea]'}`}>{fmt(row.amount)}</td>
                      <td className="px-3 py-2 text-muted hidden sm:table-cell">{row.note ?? '—'}</td>
                      <td className="px-3 py-2 text-muted hidden sm:table-cell">{row.date ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 justify-end">
                          <button type="button" title="Edit" onClick={() => startEdit(row)} className="p-1 text-muted hover:text-heading transition-colors"><Pencil size={11} /></button>
                          <button type="button" title="Delete" onClick={() => deleteRow(row.id)} className="p-1 text-muted hover:text-danger transition-colors"><Trash2 size={11} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {visibleRows.length > 1 && (
              <tfoot>
                <tr className="bg-surface2 border-t border-border text-[10px] text-muted">
                  <td colSpan={2} className="px-3 py-2 font-semibold uppercase tracking-wider">Totals</td>
                  <td className="px-3 py-2 text-right">
                    <div className="space-y-0.5">
                      {totalBudget > 0  && <div className="text-[#3b8eea] font-bold">{fmt(totalBudget)} budget</div>}
                      {totalExpense > 0 && <div className="text-[#e85555] font-bold">{fmt(totalExpense)} expenses</div>}
                      {totalRevenue > 0 && <div className="text-[#52c98e] font-bold">{fmt(totalRevenue)} revenue</div>}
                    </div>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
