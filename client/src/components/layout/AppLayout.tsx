import { useRef, useCallback, useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MessageCircle, X } from 'lucide-react';
import Sidebar from './Sidebar';
import ThemeSwitcher from '../ThemeSwitcher';
import FontSwitcher from '../FontSwitcher';
import FontSizeControl from '../FontSizeControl';
import ViewModeToggle from '../ViewModeToggle';
import AIAgentDropdown from '../AIAgentDropdown';
import DateTime from '../DateTime';
import ProjectChat from '../ProjectChat';
import IntelligentUpdatePanel from '../IntelligentUpdatePanel';
import { useChatPanel } from '../../lib/chat-panel';
import { useProjects } from '../../hooks/useProjects';
import './AppLayout.css';

const PANEL_MIN = 280;
const PANEL_MAX = 640;
const PANEL_DEFAULT = 380;
// Keep main content at least this wide before chat panel is clamped
const MAIN_MIN = 500;

export default function AppLayout() {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith('/chat');
  const { open, setOpen, iuOpen, setIuOpen, projectId, projectName, onGoalMutated, mode, panelTitle } = useChatPanel();
  const { projects } = useProjects();
  const anyPanelOpen = open || iuOpen;
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Sync panel width to CSS variable so the chat-panel class can read it
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-panel-w', `${panelWidth}px`);
  }, [panelWidth]);

  useEffect(() => {
    document.body.style.userSelect = isDragging ? 'none' : '';
    document.body.style.cursor = isDragging ? 'col-resize' : '';
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging]);

  const onDividerMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX; // dragging left = panel grows
    const availableW = window.innerWidth - MAIN_MIN;
    const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.min(availableW, dragRef.current.startW + dx)));
    setPanelWidth(next);
  }, []);

  const onDividerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    window.addEventListener('mousemove', onDividerMove);
    window.addEventListener('mouseup', onDividerUp);
    return () => {
      window.removeEventListener('mousemove', onDividerMove);
      window.removeEventListener('mouseup', onDividerUp);
    };
  }, [isDragging, onDividerMove, onDividerUp]);

  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    setIsDragging(true);
  }, [panelWidth]);

  return (
    <div className="flex h-screen overflow-hidden app-scalable">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header — counter-zoomed so A+/A- never shifts its contents */}
        <header className="app-header-fixed relative z-30 flex items-center justify-between px-6 h-11 shrink-0
                            border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center gap-3 min-w-0">
            <DateTime />
          </div>
          <div className="flex items-center gap-2">
            <AIAgentDropdown />
            <ViewModeToggle />
            <FontSizeControl />
            <FontSwitcher />
            <ThemeSwitcher />
            {/* Chat toggle — only shown when a project is active */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              title={open ? `Close ${panelTitle}` : `Open ${panelTitle}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors cursor-pointer
                ${open
                  ? 'bg-[var(--color-surface2)] border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                  : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-heading)] hover:bg-[var(--color-surface2)]'
                }`}
            >
              {open ? <X size={13} /> : <MessageCircle size={13} />}
              <span className="text-xs font-medium">{mode === 'thesis' ? 'Thesis AI' : 'AI Chat'}</span>
            </button>
          </div>
        </header>

        {/* Content row: main + optional chat panel */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          <main className={`flex-1 min-w-0 ${isChatRoute ? 'flex flex-col overflow-hidden bg-surface' : 'overflow-y-auto'}`}>
            <div
              key={location.pathname}
              className={`app-route-shell ${isChatRoute ? 'app-route-shell--chat flex-1 min-h-0' : 'app-route-shell--page'}`}
            >
              <Outlet />
            </div>
          </main>

          {/* Draggable divider — hidden when no panel is open */}
          <div
            onMouseDown={onDividerDown}
            className={`chat-divider shrink-0 w-1 hover:w-1.5 cursor-col-resize transition-all
                        bg-[var(--color-border)] hover:bg-[var(--color-accent)]/50 active:bg-[var(--color-accent)]
                        ${anyPanelOpen ? '' : 'hidden'}`}
            title="Drag to resize"
          />

          {/* Right panel — always in DOM, width collapses to 0 when closed to avoid scroll reset */}
          <div
            className={`chat-panel shrink-0 flex flex-col overflow-hidden min-w-0 border-l border-[var(--color-border)] bg-[var(--color-surface)]
                        transition-[width] duration-200
                        ${anyPanelOpen ? '' : 'chat-panel--closed'}`}
          >
            {open && (
              <ProjectChat
                projectId={projectId}
                projectName={projectName ?? ''}
                projects={projects}
                onGoalMutated={onGoalMutated ?? undefined}
              />
            )}
            {iuOpen && projectId && (
              <IntelligentUpdatePanel
                projectId={projectId}
                onClose={() => setIuOpen(false)}
                onGoalMutated={onGoalMutated ?? (() => {})}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
