import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  connectZoteroWithApiKey,
  startZoteroConnection,
  type ZoteroStatus,
} from '../lib/zotero';

type ZoteroSetupModalProps = {
  status: ZoteroStatus | null;
  onClose: () => void;
  onStatus: (status: ZoteroStatus) => void;
  onOpenLibrary?: () => void;
  returnPath?: string;
};

const steps = [
  {
    icon: Laptop,
    title: 'Turn on Zotero Desktop sync',
    detail: 'In Zotero Desktop, open Settings → Sync and sign in. Desktop changes then reach your Zotero account and Odyssey.',
  },
  {
    icon: KeyRound,
    title: 'Create an Odyssey key',
    detail: 'Create a personal key with access to your personal library, notes, and write access. Group access is optional.',
  },
  {
    icon: RefreshCw,
    title: 'Connect and choose sources',
    detail: 'Paste the key here. Odyssey validates it with Zotero, encrypts it, and opens your library for import and sync.',
  },
];

export default function ZoteroSetupModal({
  status,
  onClose,
  onStatus,
  onOpenLibrary,
  returnPath = '/thesis?tab=sources',
}: ZoteroSetupModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState<'oauth' | 'api_key' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(status?.connected === true);

  const connectWithOAuth = async () => {
    setConnecting('oauth');
    setError(null);
    try {
      await startZoteroConnection(returnPath);
    } catch (nextError) {
      setConnecting(null);
      setError(nextError instanceof Error ? nextError.message : 'Could not open Zotero authorization.');
    }
  };

  const connectWithKey = async () => {
    if (!apiKey.trim()) {
      setError('Paste the API key you created in Zotero.');
      return;
    }
    setConnecting('api_key');
    setError(null);
    try {
      const nextStatus = await connectZoteroWithApiKey(apiKey.trim());
      setApiKey('');
      setConnected(true);
      onStatus(nextStatus);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Zotero could not validate this API key.');
    } finally {
      setConnecting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zotero-setup-title"
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto border border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border bg-surface2 px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-accent">
              <BookOpen size={13} /> Thesis sources
            </div>
            <h2 id="zotero-setup-title" className="mt-1 text-xl font-bold text-heading">Connect your Zotero library</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Link once, then import citations, synchronize metadata and notes, and move attachments on demand without leaving Odyssey.
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 border border-border bg-surface p-2 text-muted hover:text-heading" aria-label="Close Zotero setup">
            <X size={16} />
          </button>
        </header>

        {connected ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-accent3/30 bg-accent3/10 text-accent3">
              <CheckCircle2 size={24} />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-heading">Zotero is connected</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
              Your API key is encrypted. Keep Zotero Desktop sync enabled so changes made on this computer continue through your Zotero account into Odyssey.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onClose} className="border border-border bg-paper px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted hover:text-heading">
                Done
              </button>
              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={() => { onOpenLibrary(); onClose(); }}
                  className="inline-flex items-center gap-2 border border-accent bg-accent px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]"
                >
                  Choose sources <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5 sm:p-6">
            <div className="border border-accent/25 bg-accent/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <p className="text-xs font-semibold text-heading">How the desktop connection works</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Browsers cannot safely read Zotero Desktop’s local database. Zotero Desktop syncs to your Zotero account; Odyssey connects to that same account through Zotero’s official API. Your API key is encrypted at rest and is never displayed again.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="border border-border bg-paper p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 font-mono text-[10px] font-bold text-accent">{index + 1}</span>
                      <Icon size={14} className="text-accent" />
                    </div>
                    <h3 className="mt-3 text-xs font-semibold text-heading">{step.title}</h3>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{step.detail}</p>
                  </div>
                );
              })}
            </div>

            {status?.oauthConfigured && (
              <div className="mt-5 flex flex-col gap-3 border border-accent3/25 bg-accent3/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-heading"><Check size={13} className="text-accent3" /> Fast connection</div>
                  <p className="mt-1 text-[11px] text-muted">Authorize Odyssey on Zotero.org—no key copying required.</p>
                </div>
                <button
                  type="button"
                  disabled={connecting !== null}
                  onClick={() => { void connectWithOAuth(); }}
                  className="inline-flex shrink-0 items-center justify-center gap-2 border border-accent3/40 bg-accent3/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-accent3 disabled:opacity-50"
                >
                  {connecting === 'oauth' ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                  Authorize with Zotero
                </button>
              </div>
            )}

            <div className="mt-5 border border-border bg-surface2 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-heading">Connect with a personal API key</h3>
                  <p className="mt-1 text-[11px] text-muted">Works with Zotero Desktop and does not require an Odyssey OAuth registration.</p>
                </div>
                <a
                  href="https://www.zotero.org/settings/keys/new"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 border border-border bg-paper px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent hover:border-accent/40"
                >
                  Create Zotero key <ExternalLink size={12} />
                </a>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="min-w-0 text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
                  Zotero API key
                  <div className="mt-2 flex border border-border bg-paper focus-within:border-accent">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(event) => { setApiKey(event.target.value); setError(null); }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste the key from zotero.org"
                      className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-xs normal-case tracking-normal text-heading outline-none placeholder:text-muted"
                    />
                    <button type="button" onClick={() => setShowKey((value) => !value)} className="px-3 text-muted hover:text-heading" aria-label={showKey ? 'Hide API key' : 'Show API key'}>
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => { void connectWithKey(); }}
                  disabled={connecting !== null || status?.apiKeyConfigured === false}
                  className="inline-flex h-[2.65rem] items-center justify-center gap-2 border border-accent bg-accent px-5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-accent-fg)] disabled:opacity-50"
                >
                  {connecting === 'api_key' ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  Connect library
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">
                On Zotero’s key page, enable “Allow library access,” “Allow notes access,” and “Allow write access.” Your personal library is enough; group permissions are optional.
              </p>
            </div>

            {status?.apiKeyConfigured === false && (
              <div className="mt-4 border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger">
                Odyssey’s secure Zotero credential store is not configured. Ask the site administrator to add the Zotero encryption key.
              </div>
            )}
            {error && <div className="mt-4 border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
