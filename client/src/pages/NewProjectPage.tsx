import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, LogIn, QrCode, Link2 } from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { supabase } from '../lib/supabase';
import { PROJECT_CODE_LENGTH, sanitizeProjectCode } from '../lib/project-code';

type Tab = 'create' | 'join';

// ─── Join by project ID code ─────────────────────────────────────────────────
function JoinSection() {
  const navigate = useNavigate();
  const [code, setCode]       = useState('');
  const [joining, setJoining] = useState(false);
  const [result, setResult]   = useState<{ text: string; ok: boolean } | null>(null);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = sanitizeProjectCode(code);
    if (!trimmed) return;
    setJoining(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('join_project_by_code', { p_code: trimmed });
      if (error) throw error;
      const res = data as { result?: string; error?: string; project_id?: string; project_name?: string };

      if (res.error) {
        setResult({ text: res.error as string, ok: false });
      } else if (res.result === 'joined') {
        setResult({ text: `Joined "${res.project_name}"! Redirecting…`, ok: true });
        setCode('');
        setTimeout(() => navigate(`/projects/${res.project_id}`), 1200);
      } else if (res.result === 'already_member') {
        navigate(`/projects/${res.project_id}`);
      } else if (res.result === 'request_sent') {
        setResult({ text: `Join request sent to the current members of "${res.project_name}". You'll be notified when someone responds.`, ok: true });
        setCode('');
      } else if (res.result === 'request_already_pending') {
        setResult({ text: `You already have a pending request for "${res.project_name}".`, ok: false });
      }
    } catch (err: unknown) {
      setResult({ text: err instanceof Error ? err.message : 'Something went wrong.', ok: false });
    }
    setJoining(false);
  };

  return (
    <div className="space-y-8">
      {/* Project ID code */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Link2 size={14} className="text-accent2" />
          <h3 className="font-sans text-sm font-bold text-heading">Enter Project ID</h3>
        </div>
        <p className="text-[11px] text-muted mb-4">
          Ask the project owner for their project ID code.
        </p>
        <form onSubmit={handleJoin} className="flex gap-2 max-w-sm">
          <input
            value={code}
            onChange={(e) => setCode(sanitizeProjectCode(e.target.value))}
            placeholder="PROJECT ID CODE"
            maxLength={PROJECT_CODE_LENGTH}
            autoFocus
            className="flex-1 px-4 py-3 bg-surface border border-border text-heading text-sm font-mono tracking-[0.18em] placeholder:text-muted/40 placeholder:tracking-normal focus:outline-none focus:border-accent2/50 transition-colors uppercase"
          />
          <button
            type="submit"
            disabled={joining || code.trim().length < PROJECT_CODE_LENGTH}
            className="px-5 py-3 bg-accent2/10 border border-accent2/30 text-accent2 text-xs font-semibold tracking-wider uppercase hover:bg-accent2/20 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {joining ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
            Join
          </button>
        </form>
        {result && (
          <p className={`mt-3 text-xs font-mono ${result.ok ? 'text-accent2' : 'text-danger'}`}>
            {result.text}
          </p>
        )}
      </div>

      {/* QR code scan */}
      <div className="border border-border bg-surface2 p-5 rounded-md">
        <div className="flex items-center gap-2 mb-2">
          <QrCode size={14} className="text-muted" />
          <h3 className="font-sans text-sm font-semibold text-heading">Scan a QR Code</h3>
          <span className="text-[9px] font-mono bg-border text-muted px-1.5 py-0.5 rounded uppercase tracking-wider">Coming Soon</span>
        </div>
        <p className="text-[11px] text-muted">
          Project members can generate a time-limited QR code in their project settings. Scanning it
          will authenticate you and send a join request to the current project members automatically.
        </p>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted/60 font-mono">
          <span>· Scan with camera</span>
          <span>· Authenticate</span>
          <span>· Owner approval</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function NewProjectPage() {
  const navigate = useNavigate();
  const { createProject } = useProjects();
  const [tab, setTab]               = useState<Tab>('create');
  const [name, setName]             = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const project = await createProject(name, description);
      navigate(`/projects/${project.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as any)?.message ?? (err as any)?.details ?? JSON.stringify(err);
      setError(msg || 'Failed to create project');
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.25em] uppercase text-accent mb-2 font-mono">
          {tab === 'create' ? 'New Project' : 'Add Project'}
        </p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
          {tab === 'create' ? 'Create a Project' : 'Join an Existing Project'}
        </h1>
        <p className="text-sm text-muted mt-1">
          {tab === 'create'
            ? 'Give your project a name and start tracking everything in one place.'
            : 'Use a project ID code or QR code to join a project shared with you.'}
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-px mb-8 border border-border bg-border">
        <button
          type="button"
          onClick={() => setTab('create')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-wider uppercase transition-colors ${
            tab === 'create' ? 'bg-surface text-heading' : 'bg-surface text-muted hover:text-heading hover:bg-surface2'
          }`}
        >
          <Plus size={12} />
          Create New
        </button>
        <button
          type="button"
          onClick={() => setTab('join')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-wider uppercase transition-colors ${
            tab === 'join' ? 'bg-surface text-heading' : 'bg-surface text-muted hover:text-heading hover:bg-surface2'
          }`}
        >
          <LogIn size={12} />
          Join Existing
        </button>
      </div>

      {/* Tab content */}
      {tab === 'create' ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="px-4 py-3 border border-danger/30 bg-danger/5 text-danger text-xs font-mono">
              {error}
            </div>
          )}
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Odyssey v1"
              className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What is this project about?"
              className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {saving ? 'Creating…' : 'Create Project'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/projects')}
              className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <JoinSection />
      )}
    </div>
  );
}
