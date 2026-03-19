import { useState, useEffect } from 'react';
import { X, FileText, Paperclip, Send, Trash2, Download, Loader2 } from 'lucide-react';
import type { Goal } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface GoalReport {
  id: string;
  content: string;
  status_at: string | null;
  progress_at: number | null;
  created_at: string;
  author_id: string | null;
}

interface GoalAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  author_id: string | null;
}

interface GoalReportModalProps {
  goal: Goal;
  projectId: string;
  onClose: () => void;
}

function fmtSize(bytes: number) {
  return bytes > 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export default function GoalReportModal({ goal, projectId, onClose }: GoalReportModalProps) {
  const { user } = useAuth();
  const [reports,     setReports]     = useState<GoalReport[]>([]);
  const [attachments, setAttachments] = useState<GoalAttachment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [content,     setContent]     = useState('');
  const [file,        setFile]        = useState<File | null>(null);
  const [submitting,  setSubmitting]  = useState(false);

  const loadData = async () => {
    const [{ data: reps }, { data: atts }] = await Promise.all([
      supabase.from('goal_reports').select('*').eq('goal_id', goal.id).order('created_at', { ascending: false }),
      supabase.from('goal_attachments').select('*').eq('goal_id', goal.id).order('created_at', { ascending: false }),
    ]);
    setReports(reps ?? []);
    setAttachments(atts ?? []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [goal.id]);

  const handleSubmit = async () => {
    if (!content.trim() && !file) return;
    setSubmitting(true);

    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${goal.id}/${Date.now()}-${safeName}`;
      const { data: up, error: upErr } = await supabase.storage
        .from('goal-attachments')
        .upload(path, file, { contentType: file.type });
      if (!upErr && up) {
        await supabase.from('goal_attachments').insert({
          goal_id: goal.id, project_id: projectId, author_id: user?.id,
          file_name: file.name, file_path: up.path, file_size: file.size, mime_type: file.type,
        });
      }
    }

    if (content.trim()) {
      await supabase.from('goal_reports').insert({
        goal_id: goal.id, project_id: projectId, author_id: user?.id,
        content: content.trim(), status_at: goal.status, progress_at: goal.progress,
      });
    }

    setContent('');
    setFile(null);
    await loadData();
    setSubmitting(false);
  };

  const getPublicUrl = (path: string) =>
    supabase.storage.from('goal-attachments').getPublicUrl(path).data.publicUrl;

  const deleteReport = async (id: string) => {
    await supabase.from('goal_reports').delete().eq('id', id);
    setReports((prev) => prev.filter((r) => r.id !== id));
  };

  const deleteAttachment = async (att: GoalAttachment) => {
    await supabase.storage.from('goal-attachments').remove([att.file_path]);
    await supabase.from('goal_attachments').delete().eq('id', att.id);
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[480px] z-50 bg-surface border-l border-border flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-accent shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-heading font-sans truncate">{goal.title}</div>
              <div className="text-[10px] text-muted font-mono">Reports &amp; Attachments</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-heading transition-colors shrink-0 ml-2">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          ) : (
            <>
              {/* Reports */}
              {reports.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-mono text-muted mb-3">Progress Reports</h4>
                  <div className="space-y-3">
                    {reports.map((r) => (
                      <div key={r.id} className="bg-surface2 border border-border rounded p-3 relative group">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] font-mono text-muted">
                            {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          {r.progress_at !== null && (
                            <span className="text-[9px] font-mono px-1 bg-accent/10 text-accent rounded">{r.progress_at}%</span>
                          )}
                          {r.status_at && (
                            <span className="text-[9px] font-mono text-muted uppercase">{r.status_at.replace('_', ' ')}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap">{r.content}</p>
                        {r.author_id === user?.id && (
                          <button
                            onClick={() => deleteReport(r.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-all"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {attachments.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-mono text-muted mb-3">Attachments</h4>
                  <div className="space-y-2">
                    {attachments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between bg-surface2 border border-border rounded px-3 py-2 group">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip size={11} className="text-muted shrink-0" />
                          <span className="text-xs font-mono text-heading truncate">{a.file_name}</span>
                          {a.file_size && (
                            <span className="text-[9px] text-muted shrink-0">{fmtSize(a.file_size)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a href={getPublicUrl(a.file_path)} target="_blank" rel="noreferrer"
                            className="text-muted hover:text-accent transition-colors">
                            <Download size={11} />
                          </a>
                          {a.author_id === user?.id && (
                            <button onClick={() => deleteAttachment(a)}
                              className="text-muted hover:text-danger transition-colors opacity-0 group-hover:opacity-100">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reports.length === 0 && attachments.length === 0 && (
                <div className="text-center py-10">
                  <FileText size={24} className="text-muted/30 mx-auto mb-2" />
                  <p className="text-xs text-muted">No reports or attachments yet</p>
                  <p className="text-[10px] text-muted/60 mt-1">Add a write-up or attach a file below</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Form */}
        <div className="shrink-0 border-t border-border p-5 space-y-3 bg-surface">
          <h4 className="text-[10px] uppercase tracking-widest font-mono text-muted">Add Report / Attachment</h4>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a progress update, completion report, or notes on what was accomplished…"
            rows={3}
            className="w-full bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 px-3 py-2 focus:outline-none focus:border-accent/50 transition-colors resize-none rounded"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted hover:text-heading transition-colors">
              <Paperclip size={12} />
              {file
                ? <span className="text-accent font-mono truncate max-w-[180px]">{file.name}</span>
                : <span>Attach file</span>
              }
              <input
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
              />
            </label>
            <button
              onClick={handleSubmit}
              disabled={submitting || (!content.trim() && !file)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              Submit
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
