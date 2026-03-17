import { Plus, FolderKanban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';

export default function ProjectsPage() {
  const { projects, loading } = useProjects();

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
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="bg-surface p-6 hover:bg-surface2 transition-colors group"
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
          ))}
        </div>
      )}
    </div>
  );
}
