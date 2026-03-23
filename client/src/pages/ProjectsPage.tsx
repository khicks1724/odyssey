import { useMemo, useState } from 'react';
import {
  Plus,
  FolderKanban,
  ArrowUpDown,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowUp,
  CalendarArrowDown,
  GripVertical,
  Trash2,
  X,
  Loader2,
  LogIn,
  Lock,
  Globe,
  LogOut,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { supabase } from '../lib/supabase';
import { getCustomOrder, getSortMode, setCustomOrder, setSortMode, sortProjects, type ProjectSortMode } from '../lib/project-sort';
import { PROJECT_CODE_LENGTH, sanitizeProjectCode } from '../lib/project-code';
import type { Project } from '../types';

function ProjectRemovalModal({
  project,
  onRemove,
  onDelete,
  onClose,
}: {
  project: Project;
  onRemove: () => Promise<{ result: 'removed' | 'delete_required' }>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState<'remove' | 'delete'>('remove');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = typed.trim().toLowerCase() === mode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'remove') {
        const result = await onRemove();
        if (result.result === 'delete_required') {
          setMode('delete');
          setTyped('');
          setSubmitting(false);
          return;
        }
        return;
      }
      await onDelete();
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${mode} project. Please try again.`);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Trash2 size={14} className="text-danger" />
            <h2 className="font-sans text-sm font-bold text-heading">{mode === 'remove' ? 'Remove Project' : 'Delete Project'}</h2>
          </div>
          <button type="button" title="Close" aria-label="Close" onClick={onClose} className="text-muted hover:text-heading transition-colors">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {mode === 'remove' ? (
            <p className="text-xs text-muted leading-relaxed">
              This will remove <span className="font-semibold text-heading">{project.name}</span> from your project list. The project will remain in Odyssey for the other members.
            </p>
          ) : (
            <p className="text-xs text-muted leading-relaxed">
              You are the only member of <span className="font-semibold text-heading">{project.name}</span>. Deleting it will permanently remove the project and all associated tasks, events, reports, and data.
            </p>
          )}

          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
              Type <span className="text-danger font-mono">{mode}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder={mode}
              className="w-full px-4 py-2.5 bg-surface2 border border-border text-heading text-sm font-mono placeholder:text-muted/40 focus:outline-none focus:border-danger/50 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-danger font-mono">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || submitting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-danger/10 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : mode === 'remove' ? <LogOut size={12} /> : <Trash2 size={12} />}
              {submitting ? (mode === 'remove' ? 'Removing...' : 'Deleting...') : mode === 'remove' ? 'Remove' : 'Delete'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function JoinByCodePanel() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = sanitizeProjectCode(code);
    if (!trimmed) return;
    setJoining(true);
    setResult(null);
    setIsError(false);
    try {
      const { data, error } = await supabase.rpc('join_project_by_code', { p_code: trimmed });
      if (error) throw error;
      const res = data as { result?: string; error?: string; project_id?: string; project_name?: string };
      if (res.error) {
        setResult(res.error);
        setIsError(true);
      } else if (res.result === 'joined') {
        setResult(`Joined "${res.project_name}"!`);
        setCode('');
        setTimeout(() => navigate(`/projects/${res.project_id}`), 1200);
      } else if (res.result === 'already_member') {
        navigate(`/projects/${res.project_id}`);
      } else if (res.result === 'request_sent') {
        setResult(`Join request sent to the owners of "${res.project_name}". You will be notified when approved.`);
        setCode('');
      } else if (res.result === 'request_already_pending') {
        setResult(`You already have a pending request to join "${res.project_name}".`);
      }
    } catch (err: unknown) {
      setResult(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setIsError(true);
    }
    setJoining(false);
  };

  return (
    <div className="border border-border bg-surface p-6">
      <div className="flex items-center gap-2 mb-4">
        <LogIn size={14} className="text-accent2" />
        <h3 className="font-sans text-sm font-bold text-heading">Join a Project</h3>
      </div>
      <p className="text-[11px] text-muted mb-4">Enter the project ID code shared by a project owner.</p>
      <form onSubmit={handleJoin} className="flex gap-2 max-w-xl">
        <input
          value={code}
          onChange={(e) => setCode(sanitizeProjectCode(e.target.value))}
          placeholder="PROJECT ID CODE"
          maxLength={PROJECT_CODE_LENGTH}
          className="flex-1 px-4 py-2.5 bg-surface border border-border text-heading text-sm font-mono tracking-[0.18em] placeholder:text-muted/40 placeholder:tracking-normal focus:outline-none focus:border-accent2/50 transition-colors uppercase"
        />
        <button
          type="submit"
          disabled={joining || code.trim().length < 20}
          className="px-4 py-2.5 bg-accent2/10 border border-accent2/30 text-accent2 text-xs font-semibold tracking-wider uppercase hover:bg-accent2/20 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {joining ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
          Join
        </button>
      </form>
      {result && <p className={`mt-3 text-xs font-mono ${isError ? 'text-danger' : 'text-accent2'}`}>{result}</p>}
    </div>
  );
}

export default function ProjectsPage() {
  const { projects, loading, deleteProject, removeSelfFromProject } = useProjects();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [sortModeState, setSortModeState] = useState<ProjectSortMode>(() => getSortMode());
  const [customOrderState, setCustomOrderState] = useState<string[]>(() => getCustomOrder());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const sorted = useMemo(() => {
    if (sortModeState !== 'custom') return sortProjects(projects, sortModeState);
    const idx = new Map(customOrderState.map((id, i) => [id, i]));
    return [...projects].sort((a, b) => {
      const ai = idx.get(a.id) ?? Infinity;
      const bi = idx.get(b.id) ?? Infinity;
      if (ai !== bi) return ai - bi;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [projects, sortModeState, customOrderState]);

  const sortButtons: { mode: ProjectSortMode; icon: typeof ArrowUpDown; label: string }[] = [
    { mode: 'alpha-asc', icon: ArrowDownAZ, label: 'A to Z' },
    { mode: 'alpha-desc', icon: ArrowUpAZ, label: 'Z to A' },
    { mode: 'date-desc', icon: CalendarArrowDown, label: 'Newest' },
    { mode: 'date-asc', icon: CalendarArrowUp, label: 'Oldest' },
    { mode: 'custom', icon: GripVertical, label: 'Custom' },
  ];

  const handleSortMode = (mode: ProjectSortMode) => {
    setSortMode(mode);
    setSortModeState(mode);
    if (mode === 'custom' && customOrderState.length === 0) {
      const initialOrder = projects.map((project) => project.id);
      setCustomOrder(initialOrder);
      setCustomOrderState(initialOrder);
    }
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragEnter = (idx: number) => setOverIdx(idx);
  const handleDragEnd = () => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const next = [...sorted];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(overIdx, 0, moved);
      const nextOrder = next.map((project) => project.id);
      setCustomOrder(nextOrder);
      setCustomOrderState(nextOrder);
      setSortMode('custom');
      setSortModeState('custom');
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-10 gap-4 flex-wrap">
        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase text-accent2 mb-2 font-mono">Projects</p>
          <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">Workspace Projects</h1>
          <p className="text-sm text-muted mt-1">Browse, sort, join, and manage your projects.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center border border-border bg-surface overflow-hidden">
            {sortButtons.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                title={`Sort: ${label}`}
                onClick={() => handleSortMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold tracking-wider uppercase transition-colors border-r last:border-r-0 border-border ${
                  sortModeState === mode ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2 hover:text-heading'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          <Link
            to="/projects/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
          >
            <Plus size={14} />
            New Project
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface p-6 animate-pulse">
              <div className="h-4 bg-border rounded w-3/4 mb-3" />
              <div className="h-3 bg-border rounded w-full mb-2" />
              <div className="h-3 bg-border rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="border border-border bg-surface p-16 text-center">
          <FolderKanban size={40} className="text-border mx-auto mb-4" />
          <h3 className="font-sans text-lg font-bold text-heading mb-2">No projects yet</h3>
          <p className="text-sm text-muted mb-6 max-w-sm mx-auto">Create your first project and connect a repo to start tracking everything.</p>
          <Link
            to="/projects/new"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
          >
            <Plus size={14} />
            Create Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
          {sorted.map((project, idx) => (
            <div
              key={project.id}
              className={`relative bg-surface hover:bg-surface2 transition-colors group ${
                overIdx === idx && dragIdx !== null ? 'ring-2 ring-accent ring-inset' : ''
              }`}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
            >
              <div className="absolute top-3 right-10 text-muted/40 group-hover:text-muted/80 cursor-grab active:cursor-grabbing z-10 transition-colors">
                <GripVertical size={14} />
              </div>

              <button
                type="button"
                title="Remove project"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPendingDelete(project); }}
                className="absolute top-3 right-3 z-10 p-1 text-muted/20 group-hover:text-muted hover:!text-danger transition-colors rounded"
              >
                <Trash2 size={12} />
              </button>

              <Link to={`/projects/${project.id}`} className="block p-6 pr-10">
                <div className="flex items-center gap-2 mb-2">
                  <FolderKanban size={14} className="text-accent" />
                  <h3 className="font-sans text-sm font-bold text-heading group-hover:text-accent transition-colors truncate">{project.name}</h3>
                </div>

                {project.description && <p className="text-xs text-muted line-clamp-2 mb-3">{project.description}</p>}

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] text-muted font-mono">
                    {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-muted/70 font-mono border border-border px-1 py-0.5 rounded">
                    {project.is_private ? <Lock size={8} /> : <Globe size={8} />}
                    {project.is_private ? 'Private' : 'Public'}
                  </span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <JoinByCodePanel />
      </div>

      {pendingDelete && (
        <ProjectRemovalModal
          project={pendingDelete}
          onRemove={async () => {
            const result = await removeSelfFromProject(pendingDelete.id);
            if (result.result === 'removed') setPendingDelete(null);
            return result;
          }}
          onDelete={async () => {
            await deleteProject(pendingDelete.id);
            setPendingDelete(null);
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
