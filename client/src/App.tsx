import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, useEffect } from 'react';
import { useAuth, AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { FontThemeProvider } from './lib/font-theme';
import { TimeFormatProvider } from './lib/time-format';
import { AIAgentProvider } from './lib/ai-agent';
import { ChatPanelProvider } from './lib/chat-panel';
import { lazyWithRetry } from './lib/lazy-with-retry';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';

const loadLoginPage = () => import('./pages/LoginPage');
const loadAuthCallbackPage = () => import('./pages/AuthCallbackPage');
const loadDashboardPage = () => import('./pages/DashboardPage');
const loadProjectsPage = () => import('./pages/ProjectsPage');
const loadNotificationsPage = () => import('./pages/NotificationsPage');
const loadChatPage = () => import('./pages/ChatPage');
const loadProjectDetailPage = () => import('./pages/ProjectDetailPage');
const loadNewProjectPage = () => import('./pages/NewProjectPage');
const loadSettingsPage = () => import('./pages/SettingsPage');
const loadJoinQRPage = () => import('./pages/JoinQRPage');

const LoginPage = lazyWithRetry(loadLoginPage, 'page-login');
const AuthCallbackPage = lazyWithRetry(loadAuthCallbackPage, 'page-auth-callback');
const DashboardPage = lazyWithRetry(loadDashboardPage, 'page-dashboard');
const ProjectsPage = lazyWithRetry(loadProjectsPage, 'page-projects');
const NotificationsPage = lazyWithRetry(loadNotificationsPage, 'page-notifications');
const ChatPage = lazyWithRetry(loadChatPage, 'page-chat');
const ProjectDetailPage = lazyWithRetry(loadProjectDetailPage, 'page-project-detail');
const NewProjectPage = lazyWithRetry(loadNewProjectPage, 'page-project-new');
const SettingsPage = lazyWithRetry(loadSettingsPage, 'page-settings');
const JoinQRPage = lazyWithRetry(loadJoinQRPage, 'page-join-qr');

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <p className="text-muted text-sm tracking-wider uppercase">Loading…</p>
  </div>
);

function SignedInRoutePreloader() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user || typeof window === 'undefined') return;

    const preload = () => {
      void Promise.allSettled([
        loadDashboardPage(),
        loadProjectsPage(),
        loadNotificationsPage(),
        loadChatPage(),
        loadNewProjectPage(),
        loadSettingsPage(),
        loadProjectDetailPage(),
      ]);
    };

    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(preload, 250);
    return () => window.clearTimeout(timeoutId);
  }, [loading, user]);

  return null;
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
    <Suspense fallback={<PageFallback />}>
      <SignedInRoutePreloader />
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
    </Suspense>
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
