import { useState, useRef, useMemo } from 'react';
import { Plus, FolderKanban, ArrowUpDown, ArrowDownAZ, ArrowUpAZ, CalendarArrowUp, CalendarArrowDown, GripVertical, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import {
  type ProjectSortMode,
  getSortMode, setSortMode as persistSort,
  getCustomOrder, setCustomOrder,
  sortProjects,
} from '../lib/project-sort';
import type { Project } from '../types';

/* ── Delete‑confirmation modal ────────────────────────────────────────────── */

function DeleteModal({ project, onConfirm, onCancel }: { project: Project; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-surface border border-border rounded-lg shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-sans text-sm font-bold text-heading">Delete Project</h3>
          <button type="button" onClick={onCancel} className="text-muted hover:text-heading transition-colors"><X size={16} /></button>
        </div>
        <p className="text-xs text-muted mb-1">
          This will permanently delete <strong className="text-heading">{project.name}</strong> and all its data.
        </p>
        <p className="text-xs text-muted mb-4">Type <strong className="text-danger">delete</strong> below to confirm.</p>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder='Type "delete" to confirm'
          className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 focus:outline-none focus:border-danger/50 rounded mb-4"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 text-xs text-muted border border-border rounded hover:bg-surface2 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            disabled={typed.toLowerCase() !== 'delete'}
            className="px-4 py-1.5 text-xs font-semibold text-[var(--color-accent-fg)] bg-danger rounded hover:bg-danger/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            Delete
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

export default function ProjectsPage() {
  const { projects, loading, deleteProject } = useProjects();
  const [sortMode, setSortModeState] = useState<ProjectSortMode>(getSortMode);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  // Drag state for custom reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragNode = useRef<HTMLDivElement | null>(null);

  const setSort = (mode: ProjectSortMode) => {
    setSortModeState(mode);
    persistSort(mode);
    // When switching to custom, snapshot current order if no custom order exists
    if (mode === 'custom') {
      const existing = getCustomOrder();
      if (existing.length === 0) {
        setCustomOrder(sorted.map((p) => p.id));
      }
    }
  };

  const sorted = useMemo(() => sortProjects(projects, sortMode), [projects, sortMode]);

  /* ── Drag handlers ────────────────────────────────────────────────────── */

  const handleDragStart = (idx: number, e: React.DragEvent<HTMLDivElement>) => {
    setDragIdx(idx);
    dragNode.current = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    // Slight delay so the dragged element renders before the snapshot
    requestAnimationFrame(() => { if (dragNode.current) dragNode.current.style.opacity = '0.4'; });
  };

  const handleDragEnter = (idx: number) => {
    if (dragIdx === null || idx === dragIdx) return;
    setOverIdx(idx);
  };

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = '1';
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const newList = [...sorted];
      const [moved] = newList.splice(dragIdx, 1);
      newList.splice(overIdx, 0, moved);
      setCustomOrder(newList.map((p) => p.id));
    }
    setDragIdx(null);
    setOverIdx(null);
    dragNode.current = null;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteProject(deleteTarget.id);
    // Remove from custom order too
    const order = getCustomOrder().filter((id) => id !== deleteTarget.id);
    setCustomOrder(order);
    setDeleteTarget(null);
  };

  /* ── Sort button config ───────────────────────────────────────────────── */

  const sortButtons: { mode: ProjectSortMode; icon: typeof ArrowUpDown; label: string }[] = [
    { mode: 'alpha-asc', icon: ArrowDownAZ, label: 'A → Z' },
    { mode: 'alpha-desc', icon: ArrowUpAZ, label: 'Z → A' },
    { mode: 'date-desc', icon: CalendarArrowDown, label: 'Newest' },
    { mode: 'date-asc', icon: CalendarArrowUp, label: 'Oldest' },
    { mode: 'custom', icon: GripVertical, label: 'Custom' },
  ];

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
                <span className="text-[10px] text-muted font-mono">
                  {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteModal
          project={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
