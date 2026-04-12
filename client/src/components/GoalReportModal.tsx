import { useState, useEffect, useRef } from 'react';
import { X, FileText, Paperclip, Send, Trash2, Download, Loader2, MessageSquare } from 'lucide-react';
import type { Goal, GoalComment } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { pushUndoAction } from '../lib/undo-manager';

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
  comment_id: string | null;
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
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [submitting,  setSubmitting]  = useState(false);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [attachmentBusyId, setAttachmentBusyId] = useState<string | null>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const commentAttachmentsById = attachments.reduce<Record<string, GoalAttachment[]>>((acc, attachment) => {
    const key = attachment.comment_id ?? '';
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(attachment);
    return acc;
  }, {});

  const loadData = async () => {
    setLoading(true);
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
    if (!content.trim()) return;
    setSubmitting(true);

    if (content.trim()) {
      await supabase.from('goal_reports').insert({
        goal_id: goal.id, project_id: projectId, author_id: user?.id,
        content: content.trim(), status_at: goal.status, progress_at: goal.progress,
      });
    }

    setContent('');
    await loadData();
    setSubmitting(false);
  };

  const handleSubmitComment = async () => {
    if ((!commentText.trim() && commentFiles.length === 0) || !user) return;
    setCommentSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You are not signed in.');

      const form = new FormData();
      form.append('content', commentText.trim());
      for (const file of commentFiles) {
        form.append('file', file);
      }

      const res = await fetch(`/api/projects/${projectId}/goals/${goal.id}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: form,
      });

      const payload = await res.json().catch(() => ({ error: 'Unable to save task note.' })) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? 'Unable to save task note.');
      }

      setCommentText('');
      setCommentFiles([]);
      await loadData();
    } finally {
      setCommentSubmitting(false);
    }
  };

  const deleteComment = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`/api/projects/${projectId}/goals/${goal.id}/comments/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    await loadData();
  };

  const deleteReport = async (id: string) => {
    const reportIndex = reports.findIndex((report) => report.id === id);
    const deletedReport = reportIndex >= 0 ? reports[reportIndex] ?? null : null;
    await supabase.from('goal_reports').delete().eq('id', id);
    setReports((prev) => prev.filter((r) => r.id !== id));
    if (!deletedReport) return;
    pushUndoAction({
      label: 'Deleted task report',
      undo: async () => {
        const { data, error } = await supabase
          .from('goal_reports')
          .insert({
            ...deletedReport,
            goal_id: goal.id,
            project_id: projectId,
          })
          .select()
          .single();
        if (error) throw error;
        setReports((prev) => {
          if (prev.some((report) => report.id === deletedReport.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(reportIndex, next.length), 0, data as GoalReport);
          return next;
        });
      },
    });
  };

  const openAttachment = async (attachment: GoalAttachment) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setAttachmentBusyId(attachment.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/goals/${goal.id}/attachments/${attachment.id}/sign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = await res.json().catch(() => ({ error: 'Unable to open attachment.' })) as { url?: string; error?: string };
      if (!res.ok || !payload.url) {
        throw new Error(payload.error ?? 'Unable to open attachment.');
      }
      window.open(payload.url, '_blank', 'noopener,noreferrer');
    } finally {
      setAttachmentBusyId(null);
    }
  };

  const deleteAttachment = async (att: GoalAttachment) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`/api/projects/${projectId}/goals/${goal.id}/attachments/${att.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    await loadData();
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
                        {commentAttachmentsById[c.id]?.length ? (
                          <div className="mt-2 space-y-1.5">
                            {commentAttachmentsById[c.id].map((attachment) => (
                              <div key={attachment.id} className="flex items-center justify-between rounded border border-[var(--color-border)]/70 bg-[var(--color-surface)]/40 px-2 py-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Paperclip size={10} className="text-[var(--color-muted)] shrink-0" />
                                  <span className="text-[11px] text-[var(--color-heading)] font-mono truncate">{attachment.file_name}</span>
                                  {attachment.file_size ? <span className="text-[9px] text-[var(--color-muted)] shrink-0">{fmtSize(attachment.file_size)}</span> : null}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => { void openAttachment(attachment); }}
                                    className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
                                  >
                                    {attachmentBusyId === attachment.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                                  </button>
                                  {(attachment.author_id === user?.id || c.author_id === user?.id) && (
                                    <button
                                      type="button"
                                      onClick={() => { void deleteAttachment(attachment); }}
                                      className="text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-colors"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
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
                          <button type="button" onClick={() => { void openAttachment(a); }}
                            className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors">
                            {attachmentBusyId === a.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                          </button>
                          {a.author_id === user?.id && (
                            <button type="button" onClick={() => { void deleteAttachment(a); }}
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
              placeholder="Leave a task note… (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono placeholder:text-[var(--color-muted)]/50 px-3 py-2 focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors resize-none rounded"
            />
            <button
              onClick={handleSubmitComment}
              disabled={commentSubmitting || (!commentText.trim() && commentFiles.length === 0)}
              className="odyssey-fill-accent flex items-center gap-1 px-3 py-2 text-xs rounded transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
            >
              {commentSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
              <Paperclip size={12} />
              <span>{commentFiles.length > 0 ? `${commentFiles.length} attachment${commentFiles.length === 1 ? '' : 's'} selected` : 'Attach files'}</span>
              <input
                type="file"
                className="hidden"
                multiple
                onChange={(e) => setCommentFiles(Array.from(e.target.files ?? []))}
                accept="image/*,.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json"
              />
            </label>
            {commentFiles.length > 0 && (
              <button
                type="button"
                onClick={() => setCommentFiles([])}
                className="text-[10px] font-mono text-[var(--color-muted)] hover:text-[var(--color-heading)]"
              >
                Clear
              </button>
            )}
          </div>
          {commentFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {commentFiles.map((selectedFile) => (
                <span key={`${selectedFile.name}-${selectedFile.size}`} className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] font-mono text-[var(--color-heading)]">
                  {selectedFile.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Report / Attachment Form */}
        <div className="shrink-0 border-t border-[var(--color-border)] p-5 space-y-3 bg-[var(--color-surface)]">
          <h4 className="text-[10px] uppercase tracking-widest font-mono text-[var(--color-muted)]">Add Progress Report</h4>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a progress update, completion report, or notes on what was accomplished…"
            rows={3}
            className="w-full bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono placeholder:text-[var(--color-muted)]/50 px-3 py-2 focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors resize-none rounded"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] text-[var(--color-muted)]">Use task notes above for files, screenshots, and supporting artifacts.</p>
            <button
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="odyssey-fill-accent flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-opacity hover:opacity-90 disabled:opacity-40"
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
