import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ReportContent } from './report-download';

export type ReportFormat = 'docx' | 'pptx' | 'pdf';

export interface MessageAttachment {
  type: 'image' | 'text-file' | 'document' | 'repo';
  name: string;
  /** For display: data URL (images) */
  previewUrl?: string;
  mimeType?: string;
  repo?: string;
  repoType?: 'github' | 'gitlab';
}

export interface SuggestedTask {
  title: string;
  description: string;
  category: string | null;
  loe: string | null;
  deadline: string | null;
  priority?: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  attachments?: MessageAttachment[];
  pendingAction?: {
    type: 'create_goal' | 'update_goal' | 'delete_goal';
    description: string;
    args: Record<string, unknown>;
  };
  actionState?: 'pending' | 'approved' | 'denied';
  /** Populated when the AI generated a downloadable report */
  reportReady?: { data: ReportContent; format: ReportFormat };
  /** Populated when the AI generated task suggestions from meeting notes */
  suggestedTasks?: SuggestedTask[];
  /** Tracks which suggested task indices the user has accepted/rejected */
  taskSelections?: Record<number, 'accepted' | 'rejected'>;
  /** Overall state of the task suggestion panel */
  taskState?: 'pending' | 'adding' | 'done';
}

interface ChatPanelCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  iuOpen: boolean;
  setIuOpen: (v: boolean) => void;
  projectId: string | null;
  projectName: string | null;
  onGoalMutated: (() => void) | null;
  messages: ChatMessage[];
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  register: (projectId: string, projectName: string, onGoalMutated: () => void) => void;
  unregister: () => void;
}

const ChatPanelContext = createContext<ChatPanelCtx>({
  open: false,
  setOpen: () => {},
  iuOpen: false,
  setIuOpen: () => {},
  projectId: null,
  projectName: null,
  onGoalMutated: null,
  messages: [],
  setMessages: () => {},
  register: () => {},
  unregister: () => {},
});

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [iuOpen, setIuOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [onGoalMutated, setOnGoalMutated] = useState<(() => void) | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Panels are mutually exclusive — opening one closes the other
  const openChat = useCallback((v: boolean) => { setOpen(v); if (v) setIuOpen(false); }, []);
  const openIu   = useCallback((v: boolean) => { setIuOpen(v); if (v) setOpen(false); }, []);

  const register = useCallback((pid: string, pname: string, cb: () => void) => {
    setProjectId((prev) => {
      // Clear chat history when switching to a different project
      if (prev && prev !== pid) setMessages([]);
      return pid;
    });
    setProjectName(pname);
    setOnGoalMutated(() => cb);
  }, []);

  const unregister = useCallback(() => {
    setOnGoalMutated(null);
    setIuOpen(false);
  }, []);

  return (
    <ChatPanelContext.Provider value={{ open, setOpen: openChat, iuOpen, setIuOpen: openIu, projectId, projectName, onGoalMutated, messages, setMessages, register, unregister }}>
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  return useContext(ChatPanelContext);
}
