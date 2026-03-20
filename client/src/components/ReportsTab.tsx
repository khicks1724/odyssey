import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, FileText, Download, BarChart3, Presentation, X, TableIcon } from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { supabase } from '../lib/supabase';
import { downloadDocx, downloadPptx, downloadPdf, exportGoalsCSV, type ReportContent } from '../lib/report-download';
import './ReportsTab.css';

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
                <div className="flex items-center gap-1.5 mb-2 text-accent3 font-medium">
                  <Download size={11} />
                  Report Ready — {lastReport.sections.length} sections
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => handleGenerate(undefined, false)} disabled={generating}
                    className="text-[10px] text-accent hover:underline">
                    Re-download
                  </button>
                  {lastReport.rawData?.goals?.length ? (
                    <button type="button" onClick={() => exportGoalsCSV(lastReport!)}
                      className="flex items-center gap-1 text-[10px] text-muted hover:text-heading border border-border rounded px-2 py-0.5 hover:bg-surface2 transition-colors">
                      <TableIcon size={9} />
                      Export CSV
                    </button>
                  ) : null}
                </div>
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
