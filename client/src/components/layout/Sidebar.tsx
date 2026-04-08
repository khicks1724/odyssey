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
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { withBasePath } from '../../lib/base-path';
import { useAuth } from '../../lib/auth';
import { useProfile } from '../../hooks/useProfile';
import { useProjects } from '../../hooks/useProjects';
import { useNotifications } from '../../hooks/useNotifications';
import UserAvatar from '../UserAvatar';
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
  const { profile } = useProfile();
  const { projects } = useProjects();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const routeCollapsed = location.pathname.startsWith('/chat');
  const sidebarCollapsed = routeCollapsed || collapsed;
  const userLabel = profile?.display_name ?? user?.user_metadata?.user_name ?? user?.email ?? 'You';
  const userAvatar = profile?.avatar_url ?? user?.user_metadata?.avatar_url ?? null;

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

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      window.location.replace(withBasePath('/login'));
    }
  };

  return (
    <aside
      className={`relative z-40 pointer-events-auto flex flex-col border-r border-border bg-surface h-full shrink-0 transition-all duration-200 ${
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
          <Link
            to="/projects/new"
            className="flex w-full items-center gap-2 px-3 py-2 rounded-md text-xs font-sans font-semibold tracking-wider uppercase border border-accent/30 text-accent hover:bg-accent/5 transition-colors"
          >
            <Plus size={14} />
            {!sidebarCollapsed && 'New Project'}
          </Link>
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
      <nav className="relative z-40 flex-1 px-3 py-2 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                isActive
                  ? 'bg-surface2 text-heading font-medium'
                  : 'text-muted hover:text-text hover:bg-surface2'
              }`
            }
          >
            <span className="relative shrink-0 overflow-visible">
              <Icon size={16} />
              {to === '/notifications' && unreadCount > 0 && (
                <span className="absolute -right-2.5 -top-2.5 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-[#f3c7c7] text-[#a61b1b] border border-[#e7a8a8] shadow-sm text-[9px] font-semibold leading-[18px] text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
            {!sidebarCollapsed && (
              <span className="flex items-center justify-between gap-2 min-w-0 flex-1">
                <span className="truncate">{label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      {user && (
        <div className="border-t border-border px-3 py-3">
          {sidebarCollapsed ? (
            <div className="flex justify-center">
              <UserAvatar label={userLabel} avatar={userAvatar} className="w-7 h-7" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <UserAvatar label={userLabel} avatar={userAvatar} className="w-7 h-7 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading truncate">{userLabel}</div>
              </div>
              <button
                type="button"
                onClick={() => { void handleSignOut(); }}
                disabled={signingOut}
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
