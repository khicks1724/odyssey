import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { FontThemeProvider } from './lib/font-theme';
import { TimeFormatProvider } from './lib/time-format';
import { AIAgentProvider } from './lib/ai-agent';
import { ChatPanelProvider } from './lib/chat-panel';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import NotificationsPage from './pages/NotificationsPage';
import ChatPage from './pages/ChatPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import NewProjectPage from './pages/NewProjectPage';
import SettingsPage from './pages/SettingsPage';
import JoinQRPage from './pages/JoinQRPage';

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
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      {/* QR join — accessible outside AppLayout so unauthenticated users land here */}
      <Route path="/join/qr/:token" element={<JoinQRPage />} />
      <Route element={user ? <AppLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<ErrorBoundary label="Dashboard"><DashboardPage /></ErrorBoundary>} />
        <Route path="projects" element={<ErrorBoundary label="Projects"><ProjectsPage /></ErrorBoundary>} />
        <Route path="notifications" element={<ErrorBoundary label="Notifications"><NotificationsPage /></ErrorBoundary>} />
        <Route path="chat" element={<ErrorBoundary label="Chat"><ChatPage /></ErrorBoundary>} />
        <Route path="projects/new" element={<ErrorBoundary label="New Project"><NewProjectPage /></ErrorBoundary>} />
        <Route path="projects/:projectId" element={<ErrorBoundary label="Project"><ProjectDetailPage /></ErrorBoundary>} />
        <Route path="settings" element={<ErrorBoundary label="Settings"><SettingsPage /></ErrorBoundary>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <FontThemeProvider>
      <ThemeProvider>
        <TimeFormatProvider>
        <AIAgentProvider>
          <ChatPanelProvider>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </ChatPanelProvider>
        </AIAgentProvider>
        </TimeFormatProvider>
      </ThemeProvider>
      </FontThemeProvider>
    </BrowserRouter>
  );
}
