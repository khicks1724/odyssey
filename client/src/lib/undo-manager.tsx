import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

type UndoAction = {
  id: string;
  label: string;
  undo: () => void | Promise<void>;
};

type UndoContextValue = {
  canUndo: boolean;
  latestLabel: string | null;
  undoLatest: () => Promise<void>;
};

const UndoContext = createContext<UndoContextValue | null>(null);

const MAX_UNDO_STACK = 50;
const UNDO_TOAST_TIMEOUT_MS = 10_000;
const undoSubscribers = new Set<() => void>();
let undoStack: UndoAction[] = [];

function emitUndoStackChange() {
  for (const subscriber of undoSubscribers) {
    subscriber();
  }
}

function subscribeUndoStack(listener: () => void) {
  undoSubscribers.add(listener);
  return () => {
    undoSubscribers.delete(listener);
  };
}

function getUndoStackSnapshot() {
  return undoStack;
}

function restoreUndoAction(action: UndoAction) {
  undoStack = [...undoStack, action].slice(-MAX_UNDO_STACK);
  emitUndoStackChange();
}

function shiftLatestUndoAction() {
  const action = undoStack.at(-1) ?? null;
  if (!action) return null;
  undoStack = undoStack.slice(0, -1);
  emitUndoStackChange();
  return action;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const editableAncestor = element.closest('input, textarea, select, [contenteditable="true"], .monaco-editor');
  return Boolean(editableAncestor);
}

function createUndoId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function pushUndoAction(action: Omit<UndoAction, 'id'>) {
  undoStack = [
    ...undoStack,
    {
      id: createUndoId(),
      label: action.label,
      undo: action.undo,
    },
  ].slice(-MAX_UNDO_STACK);
  emitUndoStackChange();
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<UndoAction[]>(() => getUndoStackSnapshot());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedActionId, setDismissedActionId] = useState<string | null>(null);
  const [isErrorVisible, setIsErrorVisible] = useState(false);

  useEffect(() => subscribeUndoStack(() => setStack([...getUndoStackSnapshot()])), []);

  const undoLatest = async () => {
    if (busy) return;
    const action = shiftLatestUndoAction();
    if (!action) return;

    setBusy(true);
    setError(null);
    try {
      await action.undo();
    } catch (undoError) {
      restoreUndoAction(action);
      setError(undoError instanceof Error ? undoError.message : 'Undo failed.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUndoChord = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
      if (!isUndoChord || isEditableTarget(event.target) || undoStack.length === 0) return;
      event.preventDefault();
      void undoLatest();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, stack.length]);

  const latestAction = stack.at(-1) ?? null;
  const shouldShowActionToast = Boolean(latestAction && !error && latestAction.id !== dismissedActionId);
  const shouldShowErrorToast = Boolean(error && isErrorVisible);

  useEffect(() => {
    if (!latestAction) {
      setDismissedActionId(null);
      return;
    }
    setDismissedActionId((current) => (current === latestAction.id ? current : null));
  }, [latestAction?.id]);

  useEffect(() => {
    if (!error) {
      setIsErrorVisible(false);
      return;
    }
    setIsErrorVisible(true);
  }, [error]);

  useEffect(() => {
    if (!shouldShowActionToast || !latestAction) return;
    const timeoutId = window.setTimeout(() => {
      setDismissedActionId(latestAction.id);
    }, UNDO_TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [latestAction, shouldShowActionToast]);

  useEffect(() => {
    if (!shouldShowErrorToast) return;
    const timeoutId = window.setTimeout(() => {
      setIsErrorVisible(false);
    }, UNDO_TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [shouldShowErrorToast]);

  const value = useMemo<UndoContextValue>(() => ({
    canUndo: stack.length > 0 && !busy,
    latestLabel: latestAction?.label ?? null,
    undoLatest,
  }), [busy, latestAction?.label, stack.length]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {(shouldShowActionToast || shouldShowErrorToast) && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[90] max-w-sm">
          <div className="pointer-events-auto border border-border bg-surface/95 px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                      {error ? 'Undo failed' : 'Deletion undo available'}
                    </p>
                    <p className="mt-1 text-sm text-heading">
                      {error || latestAction?.label}
                    </p>
                    {!error && (
                      <p className="mt-1 text-xs text-muted">Press Ctrl+Z or use the undo button.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (error) {
                        setIsErrorVisible(false);
                        return;
                      }
                      if (latestAction) {
                        setDismissedActionId(latestAction.id);
                      }
                    }}
                    className="inline-flex shrink-0 items-center justify-center text-muted transition-colors hover:text-heading"
                    aria-label="Dismiss undo notification"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {!error && latestAction && (
                <button
                  type="button"
                  onClick={() => { void undoLatest(); }}
                  disabled={busy}
                  className="odyssey-fill-accent inline-flex shrink-0 items-center justify-center border border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </UndoContext.Provider>
  );
}

export function useUndoManager() {
  const context = useContext(UndoContext);
  if (!context) {
    throw new Error('useUndoManager must be used within UndoProvider');
  }
  return context;
}
