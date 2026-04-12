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
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ThesisPage from './pages/ThesisPage';
import NotificationsPage from './pages/NotificationsPage';
import ChatPage from './pages/ChatPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import NewProjectPage from './pages/NewProjectPage';
import SettingsPage from './pages/SettingsPage';
import JoinQRPage from './pages/JoinQRPage';
import TokenUsagePage from './pages/TokenUsagePage';
import { useProfile } from './hooks/useProfile';
import { canViewTokenUsagePage } from './lib/admin-access';

function AppRoutes() {
  const { user, loading } = useAuth();
  const { profile } = useProfile();
  const canSeeTokenUsageRoute = canViewTokenUsagePage(
    [user?.email, profile?.email, user?.user_metadata?.email],
    [profile?.display_name, user?.user_metadata?.display_name, user?.user_metadata?.name, user?.user_metadata?.user_name],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted text-sm tracking-wider uppercase">Loading…</p>
      </div>
    );
  }

  return (
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
        {canSeeTokenUsageRoute && (
          <Route path="token-usage" element={<ErrorBoundary label="Token Usage"><TokenUsagePage /></ErrorBoundary>} />
        )}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
              <AppRoutes />
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
