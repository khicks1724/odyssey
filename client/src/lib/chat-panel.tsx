import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ReportContent } from './report-download';

export type ReportFormat = 'docx' | 'pptx' | 'pdf';
export type ChatPanelMode = 'project' | 'thesis';

export interface MessageAttachment {
  type: 'image' | 'text-file' | 'document' | 'repo';
  name: string;
  /** For display: data URL (images) */
  previewUrl?: string;
  mimeType?: string;
  base64?: string;
  textContent?: string;
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

export type TaskProposalType =
  | 'create_goal'
  | 'update_goal'
  | 'delete_goal'
  | 'review_redundancy'
  | 'extend_deadline'
  | 'contract_deadline'
  | 'update_paper_draft'
  | 'add_thesis_source';
export type TaskProposalState = 'pending' | 'approved' | 'denied' | 'executing';

export interface TaskProposal {
  id?: string;
  type: TaskProposalType;
  title?: string;
  description: string;
  reasoning?: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  attachments?: MessageAttachment[];
  pendingActions?: TaskProposal[];
  actionStates?: Record<string, TaskProposalState>;
  /** Populated when the AI generated a downloadable report */
  reportReady?: { data: ReportContent; format: ReportFormat; autoDownloadKey?: string };
  /** Populated when the AI generated task suggestions from meeting notes */
  suggestedTasks?: SuggestedTask[];
  /** Tracks which suggested task indices the user has accepted/rejected */
  taskSelections?: Record<number, 'accepted' | 'rejected'>;
  /** Overall state of the task suggestion panel */
  taskState?: 'pending' | 'adding' | 'done';
}

interface ChatPanelRegistration {
  projectId: string | null;
  projectName: string | null;
  onGoalMutated?: (() => void) | null;
  mode?: ChatPanelMode;
  panelTitle?: string;
  panelSubtitle?: string | null;
  workspaceContext?: string | null;
  inputPlaceholder?: string;
  allowProjectSwitching?: boolean;
}

interface ChatPanelCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  iuOpen: boolean;
  setIuOpen: (v: boolean) => void;
  mode: ChatPanelMode;
  projectId: string | null;
  projectName: string | null;
  panelTitle: string;
  panelSubtitle: string | null;
  workspaceContext: string | null;
  inputPlaceholder: string;
  allowProjectSwitching: boolean;
  onGoalMutated: (() => void) | null;
  messages: ChatMessage[];
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  register: (config: ChatPanelRegistration) => void;
  unregister: () => void;
}

const ChatPanelContext = createContext<ChatPanelCtx>({
  open: false,
  setOpen: () => {},
  iuOpen: false,
  setIuOpen: () => {},
  mode: 'project',
  projectId: null,
  projectName: null,
  panelTitle: 'Project AI',
  panelSubtitle: null,
  workspaceContext: null,
  inputPlaceholder: 'Prompt or add files…',
  allowProjectSwitching: true,
  onGoalMutated: null,
  messages: [],
  setMessages: () => {},
  register: () => {},
  unregister: () => {},
});

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [iuOpen, setIuOpen] = useState(false);
  const [mode, setMode] = useState<ChatPanelMode>('project');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [panelTitle, setPanelTitle] = useState('Project AI');
  const [panelSubtitle, setPanelSubtitle] = useState<string | null>(null);
  const [workspaceContext, setWorkspaceContext] = useState<string | null>(null);
  const [inputPlaceholder, setInputPlaceholder] = useState('Prompt or add files…');
  const [allowProjectSwitching, setAllowProjectSwitching] = useState(true);
  const [onGoalMutated, setOnGoalMutated] = useState<(() => void) | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contextKey, setContextKey] = useState('project:none');

  // Panels are mutually exclusive — opening one closes the other
  const openChat = useCallback((v: boolean) => { setOpen(v); if (v) setIuOpen(false); }, []);
  const openIu   = useCallback((v: boolean) => { setIuOpen(v); if (v) setOpen(false); }, []);

  const register = useCallback((config: ChatPanelRegistration) => {
    const nextMode = config.mode ?? 'project';
    const nextProjectId = config.projectId ?? null;
    const nextKey = `${nextMode}:${nextProjectId ?? 'none'}`;

    setContextKey((prev) => {
      if (prev !== nextKey) setMessages([]);
      return nextKey;
    });
    setMode(nextMode);
    setProjectId(nextProjectId);
    setProjectName(config.projectName ?? null);
    setPanelTitle(config.panelTitle ?? (nextMode === 'thesis' ? 'Thesis AI' : 'Project AI'));
    setPanelSubtitle(config.panelSubtitle ?? null);
    setWorkspaceContext(config.workspaceContext ?? null);
    setInputPlaceholder(config.inputPlaceholder ?? 'Prompt or add files…');
    setAllowProjectSwitching(config.allowProjectSwitching ?? nextMode !== 'thesis');
    setOnGoalMutated(() => config.onGoalMutated ?? null);
  }, []);

  const unregister = useCallback(() => {
    setOnGoalMutated(null);
    setIuOpen(false);
    setMode('project');
    setPanelTitle('Project AI');
    setPanelSubtitle(null);
    setWorkspaceContext(null);
    setInputPlaceholder('Prompt or add files…');
    setAllowProjectSwitching(true);
  }, []);

  return (
    <ChatPanelContext.Provider value={{
      open,
      setOpen: openChat,
      iuOpen,
      setIuOpen: openIu,
      mode,
      projectId,
      projectName,
      panelTitle,
      panelSubtitle,
      workspaceContext,
      inputPlaceholder,
      allowProjectSwitching,
      onGoalMutated,
      messages,
      setMessages,
      register,
      unregister,
    }}>
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  return useContext(ChatPanelContext);
}
