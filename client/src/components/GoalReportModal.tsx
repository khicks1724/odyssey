import { useState, useEffect, useRef } from 'react';
import { X, FileText, Paperclip, Send, Trash2, Download, Loader2, MessageSquare } from 'lucide-react';
import type { Goal, GoalComment } from '../types';
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

interface CommentWithAuthor extends GoalComment {
  author_name?: string;
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

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function GoalReportModal({ goal, projectId, onClose }: GoalReportModalProps) {
  const { user } = useAuth();
  const [reports,     setReports]     = useState<GoalReport[]>([]);
  const [attachments, setAttachments] = useState<GoalAttachment[]>([]);
  const [comments,    setComments]    = useState<CommentWithAuthor[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [content,     setContent]     = useState('');
  const [commentText, setCommentText] = useState('');
  const [file,        setFile]        = useState<File | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    const [{ data: reps }, { data: atts }, { data: cmts }] = await Promise.all([
      supabase.from('goal_reports').select('*').eq('goal_id', goal.id).order('created_at', { ascending: false }),
      supabase.from('goal_attachments').select('*').eq('goal_id', goal.id).order('created_at', { ascending: false }),
      supabase.from('goal_comments').select('*').eq('goal_id', goal.id).order('created_at', { ascending: true }),
    ]);
    setReports(reps ?? []);
    setAttachments(atts ?? []);

    // Fetch author display names
    const commentList = cmts ?? [];
    const authorIds = [...new Set(commentList.map((c: GoalComment) => c.author_id).filter(Boolean))] as string[];
    let nameMap: Record<string, string> = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', authorIds);
      if (profiles) {
        for (const p of profiles) nameMap[p.id] = p.display_name ?? 'Unknown';
      }
    }
    setComments(commentList.map((c: GoalComment) => ({ ...c, author_name: c.author_id ? (nameMap[c.author_id] ?? 'Unknown') : 'Anonymous' })));
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [goal.id]);

  // Realtime subscription for new comments
  useEffect(() => {
    const channel = supabase
      .channel(`goal-comments-${goal.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'goal_comments',
        filter: `goal_id=eq.${goal.id}`,
      }, async (payload) => {
        const newComment = payload.new as GoalComment;
        let authorName = 'Anonymous';
        if (newComment.author_id) {
          const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', newComment.author_id).single();
          authorName = profile?.display_name ?? 'Unknown';
        }
        setComments(prev => {
          // Avoid duplicates if we already added it optimistically
          if (prev.find(c => c.id === newComment.id)) return prev;
          return [...prev, { ...newComment, author_name: authorName }];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [goal.id]);

  // Scroll to bottom when comments change
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

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

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !user) return;
    setCommentSubmitting(true);

    const { data: inserted } = await supabase.from('goal_comments').insert({
      goal_id: goal.id,
      project_id: projectId,
      author_id: user.id,
      content: commentText.trim(),
    }).select().single();

    // Log event
    await supabase.from('events').insert({
      project_id: projectId,
      source: 'manual',
      event_type: 'comment_added',
      title: `Comment on "${goal.title}"`,
      summary: commentText.trim().slice(0, 200),
      occurred_at: new Date().toISOString(),
    });

    if (inserted) {
      // Get current user display name
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
      const authorName = profile?.display_name ?? 'You';
      // Optimistically add to state (realtime will deduplicate)
      setComments(prev => [...prev, { ...(inserted as GoalComment), author_name: authorName }]);
    }

    setCommentText('');
    setCommentSubmitting(false);
  };

  const deleteComment = async (id: string) => {
    await supabase.from('goal_comments').delete().eq('id', id);
    setComments(prev => prev.filter(c => c.id !== id));
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
      <div className="fixed right-0 top-0 bottom-0 w-[480px] z-50 bg-[var(--color-surface)] border-l border-[var(--color-border)] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-[var(--color-accent)] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--color-heading)] font-sans truncate">{goal.title}</div>
              <div className="text-[10px] text-[var(--color-muted)] font-mono">Reports, Comments &amp; Attachments</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors shrink-0 ml-2">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 min-h-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={20} className="animate-spin text-[var(--color-muted)]" />
            </div>
          ) : (
            <>
              {/* Comments */}
              {comments.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-mono text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
                    <MessageSquare size={9} /> Comments ({comments.length})
                  </h4>
                  <div className="space-y-2">
                    {comments.map((c) => (
                      <div key={c.id} className="bg-[var(--color-surface2)] border border-[var(--color-border)] rounded p-3 relative group">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold text-[var(--color-heading)] font-sans">{c.author_name}</span>
                          <span className="text-[9px] text-[var(--color-muted)] font-mono">{fmtDateTime(c.created_at)}</span>
                        </div>
                        <p className="text-xs text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap">{c.content}</p>
                        {c.author_id === user?.id && (
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-all"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                    <div ref={commentsEndRef} />
                  </div>
                </div>
              )}

              {/* Reports */}
              {reports.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-widest font-mono text-[var(--color-muted)] mb-3">Progress Reports</h4>
                  <div className="space-y-3">
                    {reports.map((r) => (
                      <div key={r.id} className="bg-[var(--color-surface2)] border border-[var(--color-border)] rounded p-3 relative group">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] font-mono text-[var(--color-muted)]">
                            {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          {r.progress_at !== null && (
                            <span className="text-[9px] font-mono px-1 bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded">{r.progress_at}%</span>
                          )}
                          {r.status_at && (
                            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase">{r.status_at.replace('_', ' ')}</span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap">{r.content}</p>
                        {r.author_id === user?.id && (
                          <button
                            onClick={() => deleteReport(r.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-all"
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
                  <h4 className="text-[10px] uppercase tracking-widest font-mono text-[var(--color-muted)] mb-3">Attachments</h4>
                  <div className="space-y-2">
                    {attachments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between bg-[var(--color-surface2)] border border-[var(--color-border)] rounded px-3 py-2 group">
                        <div className="flex items-center gap-2 min-w-0">
                          <Paperclip size={11} className="text-[var(--color-muted)] shrink-0" />
                          <span className="text-xs font-mono text-[var(--color-heading)] truncate">{a.file_name}</span>
                          {a.file_size && (
                            <span className="text-[9px] text-[var(--color-muted)] shrink-0">{fmtSize(a.file_size)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a href={getPublicUrl(a.file_path)} target="_blank" rel="noreferrer"
                            className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors">
                            <Download size={11} />
                          </a>
                          {a.author_id === user?.id && (
                            <button onClick={() => deleteAttachment(a)}
                              className="text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-colors opacity-0 group-hover:opacity-100">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reports.length === 0 && attachments.length === 0 && comments.length === 0 && (
                <div className="text-center py-10">
                  <FileText size={24} className="text-[var(--color-muted)]/30 mx-auto mb-2" />
                  <p className="text-xs text-[var(--color-muted)]">No reports, comments, or attachments yet</p>
                  <p className="text-[10px] text-[var(--color-muted)]/60 mt-1">Add a comment, write-up, or attach a file below</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Comment Form */}
        <div className="shrink-0 border-t border-[var(--color-border)] p-4 space-y-2 bg-[var(--color-surface2)]">
          <h4 className="text-[10px] uppercase tracking-widest font-mono text-[var(--color-muted)]">Add Comment</h4>
          <div className="flex items-end gap-2">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); }}}
              placeholder="Leave a comment… (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono placeholder:text-[var(--color-muted)]/50 px-3 py-2 focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors resize-none rounded"
            />
            <button
              onClick={handleSubmitComment}
              disabled={commentSubmitting || !commentText.trim()}
              className="flex items-center gap-1 px-3 py-2 bg-[var(--color-accent)] text-white text-xs rounded hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              {commentSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
        </div>

        {/* Report / Attachment Form */}
        <div className="shrink-0 border-t border-[var(--color-border)] p-5 space-y-3 bg-[var(--color-surface)]">
          <h4 className="text-[10px] uppercase tracking-widest font-mono text-[var(--color-muted)]">Add Report / Attachment</h4>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a progress update, completion report, or notes on what was accomplished…"
            rows={3}
            className="w-full bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono placeholder:text-[var(--color-muted)]/50 px-3 py-2 focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors resize-none rounded"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
              <Paperclip size={12} />
              {file
                ? <span className="text-[var(--color-accent)] font-mono truncate max-w-[180px]">{file.name}</span>
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
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-accent)] text-white text-xs rounded hover:opacity-90 transition-opacity disabled:opacity-40"
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
