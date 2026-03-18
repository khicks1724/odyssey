import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ThemeSwitcher from '../ThemeSwitcher';
import AIAgentDropdown from '../AIAgentDropdown';
import DateTime from '../DateTime';

export default function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 h-11 shrink-0
                            border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <DateTime />
          <div className="flex items-center gap-2">
            <AIAgentDropdown />
            <ThemeSwitcher />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
