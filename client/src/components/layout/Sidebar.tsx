import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  LogOut,
  ChevronLeft,
  Plus,
  ChevronsUpDown,
} from 'lucide-react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useProjects } from '../../hooks/useProjects';
import { useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Detect current project from URL
  const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentProjectId = projectMatch?.[1];
  const currentProject = projects.find((p) => p.id === currentProjectId);

  return (
    <aside
      className={`flex flex-col border-r border-border bg-surface h-screen sticky top-0 transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center border-b border-border h-16 px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <span className="font-serif text-4xl font-bold italic text-heading flex-1 text-center">
            <span className="text-accent">Odyssey</span>
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-surface2 text-muted hover:text-heading transition-colors shrink-0"
        >
          <ChevronLeft
            size={16}
            className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* New Project */}
      <div className="px-3 pt-4 pb-2">
        <NavLink
          to="/projects/new"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-sans font-semibold tracking-wider uppercase border border-accent/30 text-accent hover:bg-accent/5 transition-colors"
        >
          <Plus size={14} />
          {!collapsed && 'New Project'}
        </NavLink>
      </div>

      {/* Project Switcher */}
      {!collapsed && projects.length > 0 && (
        <div className="px-3 pb-2 relative">
          <button
            onClick={() => setSwitcherOpen(!switcherOpen)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs border border-border text-muted hover:text-heading hover:bg-surface2 transition-colors"
          >
            <span className="truncate">
              {currentProject?.name ?? 'Select project…'}
            </span>
            <ChevronsUpDown size={12} />
          </button>
          {switcherOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-surface border border-border rounded-md shadow-xl max-h-48 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    navigate(`/projects/${p.id}`);
                    setSwitcherOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-surface2 transition-colors truncate ${
                    p.id === currentProjectId ? 'text-accent bg-surface2' : 'text-heading'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav Links */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-surface2 text-heading font-medium'
                  : 'text-muted hover:text-text hover:bg-surface2'
              }`
            }
          >
            <Icon size={16} />
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      {user && (
        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center gap-2">
            {user.user_metadata?.avatar_url && (
              <img
                src={user.user_metadata.avatar_url as string}
                alt=""
                className="w-7 h-7 rounded-full"
              />
            )}
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading truncate">
                  {user.user_metadata?.user_name ?? user.email}
                </div>
              </div>
            )}
            <button
              onClick={signOut}
              className="p-1 rounded hover:bg-surface2 text-muted hover:text-danger transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
