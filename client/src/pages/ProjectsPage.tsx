<<<<<<< HEAD
import { useState, useRef, useMemo } from 'react';
import { Plus, FolderKanban, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, CalendarArrowUp, CalendarArrowDown, GripVertical, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useState } from 'react';
import { Plus, FolderKanban, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, CalendarArrowUp, CalendarArrowDown, GripVertical, Trash2, X, Loader2, LogIn, Lock, Globe } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';

function DeleteProjectModal({
  project,
  onConfirm,
  onClose,
}: {
  project: Project;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped]     = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const valid = typed.trim().toLowerCase() === 'delete';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete project. Please try again.');
    }
    setDeleting(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Trash2 size={14} className="text-danger" />
            <h2 className="font-sans text-sm font-bold text-heading">Delete Project</h2>
          </div>
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={onClose}
            className="text-muted hover:text-heading transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <p className="text-xs text-muted leading-relaxed">
            This will permanently delete{' '}
            <span className="font-semibold text-heading">{project.name}</span>{' '}
            and all associated tasks, events, reports, and data. This cannot be undone.
          </p>

          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
              Type <span className="text-danger font-mono">delete</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder="delete"
              className="w-full px-4 py-2.5 bg-surface2 border border-border text-heading text-sm font-mono placeholder:text-muted/40 focus:outline-none focus:border-danger/50 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-danger font-mono">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || deleting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-danger/10 border border-danger/40 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function JoinByCodePanel() {
  const navigate = useNavigate();
  const [code, setCode]           = useState('');
  const [joining, setJoining]     = useState(false);
  const [result, setResult]       = useState<string | null>(null);
  const [isError, setIsError]     = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
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
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setResult(msg);
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
      <p className="text-[11px] text-muted mb-4">
        Enter the 8-character invite code shared by a project owner.
      </p>
      <form onSubmit={handleJoin} className="flex gap-2 max-w-sm">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXXXXXX"
          maxLength={8}
          className="flex-1 px-4 py-2.5 bg-surface border border-border text-heading text-sm font-mono tracking-widest placeholder:text-muted/40 placeholder:tracking-normal focus:outline-none focus:border-accent2/50 transition-colors uppercase"
        />
        <button
          type="submit"
          disabled={joining || code.trim().length < 6}
          className="px-4 py-2.5 bg-accent2/10 border border-accent2/30 text-accent2 text-xs font-semibold tracking-wider uppercase hover:bg-accent2/20 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {joining ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
          Join
        </button>
      </form>
      {result && (
        <p className={`mt-3 text-xs font-mono ${isError ? 'text-danger' : 'text-accent2'}`}>
          {result}
        </p>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const { projects, loading, deleteProject } = useProjects();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder="delete"
              className="w-full px-4 py-2.5 bg-surface2 border border-border text-heading text-sm font-mono placeholder:text-muted/40 focus:outline-none focus:border-danger/50 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-danger font-mono">{error}</p>
          )}

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
          ) : projects.length === 0 ? (
            <div className="border border-border bg-surface p-16 text-center">
              <FolderKanban size={40} className="text-border mx-auto mb-4" />
              <h3 className="font-sans text-lg font-bold text-heading mb-2">No projects yet</h3>
              <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
                Create your first project and connect a GitHub repo to start tracking everything.
              </p>
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
              {projects.map((project) => (
                <div key={project.id} className="relative bg-surface hover:bg-surface2 transition-colors group">
                  {/* Delete X button — top-right corner */}
                  <button
                    type="button"
                    title="Delete project"
                    onClick={(e) => { e.preventDefault(); setPendingDelete(project); }}
                    className="absolute top-3 right-3 z-10 p-1 text-muted/0 group-hover:text-muted hover:!text-danger transition-colors rounded"
                  >
                    <X size={13} />
                  </button>

                  {/* Project card link */}
                  <Link
                    to={`/projects/${project.id}`}
                    className="block p-6 pr-8"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <FolderKanban size={14} className="text-accent" />
                      <h3 className="font-sans text-sm font-bold text-heading group-hover:text-accent transition-colors truncate">
                        {project.name}
                      </h3>
                    </div>
                    {project.description && (
                      <p className="text-xs text-muted line-clamp-2 mb-3">{project.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted font-mono">
                        {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      {project.is_private ? (
                        <span className="inline-flex items-center gap-0.5 text-[9px] text-muted/70 font-mono border border-border px-1 py-0.5 rounded">
                          <Lock size={8} />
                          Private
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Join a Project */}
          <div className="mt-8">
            <JoinByCodePanel />
          </div>

          {/* Delete confirmation modal */}
          {pendingDelete && (
            <DeleteProjectModal
              project={pendingDelete}
              onConfirm={async () => {
                await deleteProject(pendingDelete.id);
                setPendingDelete(null);
              }}
              onClose={() => setPendingDelete(null)}
            />
          )}
  };

  /* ── Sort button config ───────────────────────────────────────────────── */

  const sortButtons: { mode: ProjectSortMode; icon: typeof ArrowUpDown; label: string }[] = [
    { mode: 'alpha-asc', icon: ArrowDownAZ, label: 'A → Z' },
    { mode: 'alpha-desc', icon: ArrowUpAZ, label: 'Z → A' },
    { mode: 'date-desc', icon: CalendarArrowDown, label: 'Newest' },
    { mode: 'date-asc', icon: CalendarArrowUp, label: 'Oldest' },
    { mode: 'custom', icon: GripVertical, label: 'Custom' },
  ];
=======
function JoinByCodePanel() {
  const navigate = useNavigate();
  const [code, setCode]           = useState('');
  const [joining, setJoining]     = useState(false);
  const [result, setResult]       = useState<string | null>(null);
  const [isError, setIsError]     = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
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
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setResult(msg);
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
      <p className="text-[11px] text-muted mb-4">
        Enter the 8-character invite code shared by a project owner.
      </p>
      <form onSubmit={handleJoin} className="flex gap-2 max-w-sm">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXXXXXX"
          maxLength={8}
          className="flex-1 px-4 py-2.5 bg-surface border border-border text-heading text-sm font-mono tracking-widest placeholder:text-muted/40 placeholder:tracking-normal focus:outline-none focus:border-accent2/50 transition-colors uppercase"
        />
        <button
          type="submit"
          disabled={joining || code.trim().length < 6}
          className="px-4 py-2.5 bg-accent2/10 border border-accent2/30 text-accent2 text-xs font-semibold tracking-wider uppercase hover:bg-accent2/20 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {joining ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
          Join
        </button>
      </form>
      {result && (
        <p className={`mt-3 text-xs font-mono ${isError ? 'text-danger' : 'text-accent2'}`}>
          {result}
        </p>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const { projects, loading, deleteProject } = useProjects();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
>>>>>>> 95942f7 (Save all changes)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase text-accent2 mb-2 font-mono">
            Projects
          </p>
          <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
            Your Projects
          </h1>
        </div>
        <Link
          to="/projects/new"
          className="inline-flex items-center gap-2 px-5 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
        >
          <Plus size={14} />
          New Project
        </Link>
      </div>

      {/* Sort bar */}
      {!loading && projects.length > 0 && (
        <div className="flex items-center gap-1 mb-4">
          <ArrowUpDown size={11} className="text-muted mr-1" />
          <span className="text-[10px] text-muted uppercase tracking-wider mr-2 font-mono">Sort</span>
          {sortButtons.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSort(mode)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono border rounded transition-colors ${
                sortMode === mode
                  ? 'bg-accent text-[var(--color-accent-fg)] border-accent'
                  : 'text-muted border-border hover:text-heading hover:bg-surface2'
              }`}
            >
              <Icon size={10} />
              {label}
            </button>
          ))}
        </div>
      )}

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
      ) : projects.length === 0 ? (
        <div className="border border-border bg-surface p-16 text-center">
          <FolderKanban size={40} className="text-border mx-auto mb-4" />
          <h3 className="font-sans text-lg font-bold text-heading mb-2">No projects yet</h3>
          <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
            Create your first project and connect a GitHub repo to start tracking everything.
          </p>
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
<<<<<<< HEAD
          {sorted.map((project, idx) => (
            <div
              key={project.id}
              className={`bg-surface hover:bg-surface2 transition-colors group relative ${
                overIdx === idx && dragIdx !== null ? 'ring-2 ring-accent ring-inset' : ''
              }`}
              draggable={sortMode === 'custom'}
              onDragStart={(e) => handleDragStart(idx, e)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
            >
              {/* Drag handle (only in custom mode) */}
              {sortMode === 'custom' && (
                <div className="absolute top-3 right-3 text-muted/40 cursor-grab active:cursor-grabbing">
                  <GripVertical size={14} />
                </div>
              )}

              {/* Delete button */}
              <button
                type="button"
                title="Delete project"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(project); }}
                className="absolute bottom-3 right-3 p-1.5 text-muted/30 hover:text-danger hover:bg-danger/10 rounded transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>

              <Link
                to={`/projects/${project.id}`}
                className="block p-6"
=======
          {projects.map((project) => (
            <div key={project.id} className="relative bg-surface hover:bg-surface2 transition-colors group">
              {/* Delete X button — top-right corner */}
              <button
                type="button"
                title="Delete project"
                onClick={(e) => { e.preventDefault(); setPendingDelete(project); }}
                className="absolute top-3 right-3 z-10 p-1 text-muted/0 group-hover:text-muted hover:!text-danger transition-colors rounded"
              >
                <X size={13} />
              </button>

              {/* Project card link */}
              <Link
                to={`/projects/${project.id}`}
                className="block p-6 pr-8"
>>>>>>> 95942f7 (Save all changes)
              >
                <div className="flex items-center gap-2 mb-2">
                  <FolderKanban size={14} className="text-accent" />
                  <h3 className="font-sans text-sm font-bold text-heading group-hover:text-accent transition-colors truncate">
                    {project.name}
                  </h3>
                </div>
                {project.description && (
                  <p className="text-xs text-muted line-clamp-2 mb-3">{project.description}</p>
                )}
<<<<<<< HEAD
                <span className="text-[10px] text-muted font-mono">
                  {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
=======
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted font-mono">
                    {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {project.is_private ? (
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-muted/70 font-mono border border-border px-1 py-0.5 rounded">
                      <Lock size={8} />
                      Private
                    </span>
                  ) : null}
                </div>
>>>>>>> 95942f7 (Save all changes)
              </Link>
            </div>
          ))}
        </div>
      )}

<<<<<<< HEAD
      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteModal
          project={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
=======
      {/* Join a Project */}
      <div className="mt-8">
        <JoinByCodePanel />
      </div>

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <DeleteProjectModal
          project={pendingDelete}
          onConfirm={async () => {
            await deleteProject(pendingDelete.id);
            setPendingDelete(null);
          }}
          onClose={() => setPendingDelete(null)}
>>>>>>> 95942f7 (Save all changes)
        />
      )}
    </div>
  );
}
