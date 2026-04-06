import { useRef, useCallback, useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MessageCircle, X } from 'lucide-react';
import Sidebar from './Sidebar';
import ThemeSwitcher from '../ThemeSwitcher';
import FontSwitcher from '../FontSwitcher';
import FontSizeControl from '../FontSizeControl';
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
  const { open, setOpen, iuOpen, setIuOpen, projectId, projectName, onGoalMutated } = useChatPanel();
  const { projects } = useProjects();
  const anyPanelOpen = open || iuOpen;
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Sync panel width to CSS variable so the chat-panel class can read it
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-panel-w', `${panelWidth}px`);
  }, [panelWidth]);

  const onDividerMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX; // dragging left = panel grows
    const availableW = window.innerWidth - MAIN_MIN;
    const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.min(availableW, dragRef.current.startW + dx)));
    setPanelWidth(next);
  }, []);

  const onDividerUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onDividerMove);
    window.removeEventListener('mouseup', onDividerUp);
  }, [onDividerMove]);

  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onDividerMove);
    window.addEventListener('mouseup', onDividerUp);
  }, [panelWidth, onDividerMove, onDividerUp]);

  return (
    <div className="flex h-screen overflow-hidden app-scalable">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header — counter-zoomed so A+/A- never shifts its contents */}
        <header className="app-header-fixed flex items-center justify-between px-6 h-11 shrink-0
                            border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <DateTime />
          <div className="flex items-center gap-2">
            <AIAgentDropdown />
            <FontSizeControl />
            <FontSwitcher />
            <ThemeSwitcher />
            {/* Chat toggle — only shown when a project is active */}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              title={open ? 'Close AI Chat' : 'Open AI Chat'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors cursor-pointer
                ${open
                  ? 'bg-[var(--color-surface2)] border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                  : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-heading)] hover:bg-[var(--color-surface2)]'
                }`}
            >
              {open ? <X size={13} /> : <MessageCircle size={13} />}
              <span className="text-xs font-medium">AI Chat</span>
            </button>
          </div>
        </header>

        {/* Content row: main + optional chat panel */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          <main className={`flex-1 overflow-y-auto min-w-0 ${location.pathname.startsWith('/chat') ? 'bg-surface' : ''}`}>
            <div key={location.pathname}>
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
            {iuOpen && (
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
