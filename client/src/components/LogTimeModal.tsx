import { useState } from 'react';
import { Clock, X, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface LogTimeModalProps {
  goalId: string;
  projectId: string;
  goalTitle: string;
  onClose: () => void;
  onLogged: () => void;
}

export default function LogTimeModal({ goalId, projectId, goalTitle, onClose, onLogged }: LogTimeModalProps) {
  const { user } = useAuth();
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedHours = parseFloat(hours);
  const valid = !isNaN(parsedHours) && parsedHours > 0;

  const handleSubmit = async () => {
    if (!valid || !user) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from('time_logs').insert({
      goal_id: goalId,
      project_id: projectId,
      user_id: user.id,
      logged_hours: parsedHours,
      description: description.trim() || null,
      logged_at: new Date().toISOString(),
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    onLogged();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-[var(--color-accent2)]" />
            <span className="text-xs font-semibold text-[var(--color-heading)] font-sans">Log Time</span>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <p className="text-[10px] text-[var(--color-muted)] font-mono truncate" title={goalTitle}>
            {goalTitle}
          </p>

          {/* Hours input */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-muted)] mb-1.5">
              Hours Logged
            </label>
            <input
              type="number"
              step="0.25"
              min="0.25"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. 2.5"
              autoFocus
              className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-sm font-mono focus:outline-none focus:border-[var(--color-accent)] rounded transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-muted)] mb-1.5">
              Description <span className="normal-case">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did you work on?"
              rows={2}
              className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)] rounded transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-[10px] text-[var(--color-danger)] font-mono">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface2)]">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors font-mono">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-accent)] text-white text-xs font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-40 font-sans"
          >
            {submitting ? <Loader2 size={11} className="animate-spin" /> : <Clock size={11} />}
            {submitting ? 'Saving…' : `Log ${valid ? parsedHours + 'h' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
