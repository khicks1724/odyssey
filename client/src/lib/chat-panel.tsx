import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface MessageAttachment {
  type: 'image' | 'text-file' | 'document' | 'repo';
  name: string;
  /** For display: data URL (images) */
  previewUrl?: string;
  mimeType?: string;
  repo?: string;
  repoType?: 'github' | 'gitlab';
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
    setProjectId(null);
    setProjectName(null);
    setOnGoalMutated(null);
    setOpen(false);
    setIuOpen(false);
    // Messages intentionally kept so they're there if you navigate back quickly
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
