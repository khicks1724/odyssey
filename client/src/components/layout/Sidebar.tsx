import {
  LayoutDashboard,
  FolderKanban,
  Bell,
  MessageSquare,
  Settings,
  LogOut,
  ChevronLeft,
  Plus,
  ChevronsUpDown,
} from 'lucide-react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useProjects } from '../../hooks/useProjects';
import { useEffect, useRef, useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const routeCollapsed = location.pathname.startsWith('/chat');
  const sidebarCollapsed = routeCollapsed || collapsed;

  // Detect current project from URL
  const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentProjectId = projectMatch?.[1];
  const currentProject = projects.find((p) => p.id === currentProjectId);

  useEffect(() => {
    if (!switcherOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!switcherRef.current) return;
      if (!switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [switcherOpen]);

  useEffect(() => {
    setSwitcherOpen(false);
  }, [location.pathname]);

  return (
    <aside
      className={`flex flex-col border-r border-border bg-surface h-screen sticky top-0 transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center border-b border-border h-16 px-3 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!sidebarCollapsed && (
          <NavLink to="/" end className="font-serif text-4xl font-bold italic text-heading flex-1 text-center hover:opacity-80 transition-opacity">
            <span className="text-accent">Odyssey</span>
          </NavLink>
        )}
        <button
          onClick={() => {
            if (routeCollapsed) return;
            setCollapsed(!collapsed);
          }}
          className="p-1 rounded hover:bg-surface2 text-muted hover:text-heading transition-colors shrink-0"
          disabled={routeCollapsed}
        >
          <ChevronLeft
            size={16}
            className={`transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* New Project */}
      {projects.length === 0 && (
        <div className="px-3 pt-4 pb-2">
          <NavLink
            to="/projects/new"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-sans font-semibold tracking-wider uppercase border border-accent/30 text-accent hover:bg-accent/5 transition-colors"
          >
            <Plus size={14} />
            {!sidebarCollapsed && 'New Project'}
          </NavLink>
        </div>
      )}

      {/* Project Switcher */}
      {!sidebarCollapsed && projects.length > 0 && (
        <div ref={switcherRef} className="px-3 pt-5 pb-3 relative">
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
            {!sidebarCollapsed && label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      {user && (
        <div className="border-t border-border px-3 py-3">
          {sidebarCollapsed ? (
            <div className="flex justify-center">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url as string}
                  alt=""
                  className="w-7 h-7 rounded-full"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-surface2 flex items-center justify-center text-[10px] text-muted font-semibold">
                  {(user.user_metadata?.user_name ?? user.email ?? '?')[0].toUpperCase()}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url as string}
                  alt=""
                  className="w-7 h-7 rounded-full shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-surface2 flex items-center justify-center text-[10px] text-muted font-semibold shrink-0">
                  {(user.user_metadata?.user_name ?? user.email ?? '?')[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading truncate">
                  {user.user_metadata?.user_name ?? user.email}
                </div>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="p-1 rounded hover:bg-surface2 text-muted hover:text-danger transition-colors shrink-0"
                title="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
