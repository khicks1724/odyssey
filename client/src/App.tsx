import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { FontThemeProvider } from './lib/font-theme';
import { TimeFormatProvider } from './lib/time-format';
import { AIAgentProvider } from './lib/ai-agent';
import { ChatPanelProvider } from './lib/chat-panel';
import { UndoProvider } from './lib/undo-manager';
import { routerBasename } from './lib/base-path';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { ChatThreadsProvider } from './hooks/useChatThreads';
import { lazyWithRetry } from './lib/lazy-with-retry';

const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'), 'route-login');
const AuthCallbackPage = lazyWithRetry(() => import('./pages/AuthCallbackPage'), 'route-auth-callback');
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'), 'route-dashboard');
const ProjectsPage = lazyWithRetry(() => import('./pages/ProjectsPage'), 'route-projects');
const ThesisPage = lazyWithRetry(() => import('./pages/ThesisPage'), 'route-thesis');
const NotificationsPage = lazyWithRetry(() => import('./pages/NotificationsPage'), 'route-notifications');
const ChatPage = lazyWithRetry(() => import('./pages/ChatPage'), 'route-chat');
const ProjectDetailPage = lazyWithRetry(() => import('./pages/ProjectDetailPage'), 'route-project-detail');
const NewProjectPage = lazyWithRetry(() => import('./pages/NewProjectPage'), 'route-new-project');
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'), 'route-settings');
const JoinQRPage = lazyWithRetry(() => import('./pages/JoinQRPage'), 'route-join-qr');
const TokenUsagePage = lazyWithRetry(() => import('./pages/TokenUsagePage'), 'route-token-usage');

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted text-sm tracking-wider uppercase">Loading…</p>
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted text-sm tracking-wider uppercase">Loading…</p>
      </div>
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        {/* QR join — accessible outside AppLayout so unauthenticated users land here */}
        <Route path="/join/qr/:token" element={<JoinQRPage />} />
        <Route element={user ? <AppLayout /> : <Navigate to="/login" replace />}>
          <Route index element={<ErrorBoundary label="Dashboard"><DashboardPage /></ErrorBoundary>} />
          <Route path="projects" element={<ErrorBoundary label="Projects"><ProjectsPage /></ErrorBoundary>} />
          <Route path="thesis" element={<ErrorBoundary label="Thesis"><ThesisPage /></ErrorBoundary>} />
          <Route path="notifications" element={<ErrorBoundary label="Notifications"><NotificationsPage /></ErrorBoundary>} />
          <Route path="chat" element={<ErrorBoundary label="Chat"><ChatPage /></ErrorBoundary>} />
          <Route path="projects/new" element={<ErrorBoundary label="New Project"><NewProjectPage /></ErrorBoundary>} />
          <Route path="projects/:projectId" element={<ErrorBoundary label="Project"><ProjectDetailPage /></ErrorBoundary>} />
          <Route path="settings" element={<ErrorBoundary label="Settings"><SettingsPage /></ErrorBoundary>} />
          <Route path="token-usage" element={<ErrorBoundary label="Token Usage"><TokenUsagePage /></ErrorBoundary>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <FontThemeProvider>
      <ThemeProvider>
        <TimeFormatProvider>
        <AIAgentProvider>
          <UndoProvider>
          <ChatPanelProvider>
            <AuthProvider>
              <ChatThreadsProvider>
                <AppRoutes />
              </ChatThreadsProvider>
            </AuthProvider>
          </ChatPanelProvider>
          </UndoProvider>
        </AIAgentProvider>
        </TimeFormatProvider>
      </ThemeProvider>
      </FontThemeProvider>
    </BrowserRouter>
  );
}
