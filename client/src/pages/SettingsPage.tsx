import { useState, useEffect } from 'react';
import { useAuth, type OAuthProvider } from '../lib/auth';
import { useProfile } from '../hooks/useProfile';
import { useMicrosoftIntegration } from '../hooks/useMicrosoftIntegration';
import { useTimeFormat, type HourCycle } from '../lib/time-format';
import TimezoneGlobe from '../components/TimezoneGlobe';
import { supabase } from '../lib/supabase';
import { Github, Monitor, Bell, Palette, Shield, Check, Loader2, Link, Unlink, Clock, KeyRound, Eye, EyeOff, Trash2, LogIn, ExternalLink, RefreshCw } from 'lucide-react';

// ── AI Provider key management ─────────────────────────────────────────────

type AiServiceProvider = 'anthropic' | 'openai' | 'google';

interface AiKeyStatus {
  provider: AiServiceProvider;
  hasKey: boolean;
  lastUpdated: string | null;
  credentialType: 'api_key' | 'oauth';
}

const AI_PROVIDER_META: Record<AiServiceProvider, { label: string; hint: string; placeholder: string; keyUrl: string }> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    hint: 'Used for Claude Haiku, Sonnet, and Opus models',
    placeholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI (GPT-4o)',
    hint: 'Used for GPT-4o model',
    placeholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'Google / GenAI.mil (Gemini 2.5 Flash)',
    hint: 'Gemini 2.5 Flash — supports Google AI Studio keys (AIza…) and GenAI.mil DoD keys (STARK_…)',
    placeholder: 'AIza… (Google AI Studio) or STARK_… (GenAI.mil)',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
};

async function getAuthHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

function AiProviderCard({
  provider,
  status,
  onSaved,
  onRemoved,
  onConnectGoogle,
  isGoogleLinked,
}: {
  provider: AiServiceProvider;
  status: AiKeyStatus | undefined;
  onSaved: (provider: AiServiceProvider) => void;
  onRemoved: (provider: AiServiceProvider) => void;
  onConnectGoogle?: () => void;
  isGoogleLinked?: boolean;
}) {
  const meta = AI_PROVIDER_META[provider];
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasKey = status?.hasKey ?? false;
  const isOAuth = status?.credentialType === 'oauth';

  const handleSave = async () => {
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setError('API key cannot be empty');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) throw new Error('Not authenticated');

      const res = await fetch('/api/user/ai-keys', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ provider, apiKey: trimmed }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      setInputKey('');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      onSaved(provider);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
    setSaving(false);
  };

  const handleRemove = async () => {
    setError(null);
    setRemoving(true);
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) throw new Error('Not authenticated');

      const res = await fetch(`/api/user/ai-keys/${provider}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      setInputKey('');
      onRemoved(provider);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    }
    setRemoving(false);
  };

  return (
    <div className="border border-border p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-heading">{meta.label}</span>
          <p className="text-[10px] text-muted mt-0.5">{meta.hint}</p>
        </div>
        {hasKey ? (
          <span className={`flex items-center gap-1 text-[10px] font-mono border px-2 py-0.5 rounded shrink-0 ${isOAuth ? 'text-accent border-accent/30' : 'text-accent3 border-accent3/30'}`}>
            <Check size={9} /> {isOAuth ? 'Google account' : 'API key set'}
          </span>
        ) : (
          <span className="text-[10px] text-muted font-mono border border-border px-2 py-0.5 rounded shrink-0">
            Server key
          </span>
        )}
      </div>

      {/* Google OAuth option — shown only for Google provider when Google account is linked */}
      {provider === 'google' && isGoogleLinked && (
        <div className="flex items-center gap-2 py-1.5 border-b border-border/50">
          <button
            type="button"
            onClick={onConnectGoogle}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded"
          >
            <RefreshCw size={10} />
            {isOAuth ? 'Reconnect Google account' : 'Use Google account'}
          </button>
          <span className="text-[10px] text-muted">
            {isOAuth ? 'Token expires after ~1hr — reconnect to refresh' : 'Sign in with Google to use Gemini without an API key'}
          </span>
        </div>
      )}

      {/* API key input row */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[10px] text-muted">API key</span>
          <a
            href={meta.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-[10px] text-accent/70 hover:text-accent transition-colors ml-1"
          >
            Get key <ExternalLink size={9} />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder={hasKey && !isOAuth ? '••••••••••••••••' : meta.placeholder}
              className="w-full px-3 py-1.5 pr-8 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-heading transition-colors"
              tabIndex={-1}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !inputKey.trim()}
            className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-40 flex items-center gap-1"
          >
            {saving ? <Loader2 size={10} className="animate-spin" /> : savedFlash ? <Check size={10} /> : null}
            {savedFlash ? 'Saved' : 'Save'}
          </button>

          {hasKey && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="px-3 py-1.5 border border-danger/30 text-danger text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-danger/5 transition-colors rounded disabled:opacity-40 flex items-center gap-1"
              title="Remove stored key"
            >
              {removing ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-[10px] text-danger font-mono">{error}</p>
      )}

      {/* Last updated */}
      {hasKey && status?.lastUpdated && (
        <p className="text-[10px] text-muted font-mono">
          {isOAuth ? 'Connected' : 'Last updated'}: {new Date(status.lastUpdated).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ── Sign-in provider metadata ───────────────────────────────────────────────

const SIGN_IN_PROVIDERS: { id: OAuthProvider; label: string; note: string }[] = [
  { id: 'github',  label: 'GitHub',    note: 'Link for GitHub-based sign-in and repo access' },
  { id: 'google',  label: 'Google',    note: 'Link for Google account sign-in' },
  { id: 'azure',   label: 'Microsoft', note: 'Link for Microsoft account sign-in' },
];

// ── Main SettingsPage ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, linkIdentity, unlinkIdentity, connectGoogleAI } = useAuth();
  const { profile, updateProfile } = useProfile();
  const { status: msStatus, loading: msLoading, connecting: msConnecting, connectError: msError, connect: msConnect, disconnect: msDisconnect } = useMicrosoftIntegration();
  const { settings: tfSettings, setTimezone, setHourCycle } = useTimeFormat();
  const [displayName, setDisplayName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Identity linking state
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<OAuthProvider | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const linkedProviders = new Set((user?.identities ?? []).map((id) => id.provider));
  const canUnlink = (user?.identities?.length ?? 0) > 1;

  const handleLink = async (provider: OAuthProvider) => {
    setLinkError(null);
    setLinkingProvider(provider);
    try {
      await linkIdentity(provider);
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link');
      setLinkingProvider(null);
    }
  };

  const handleUnlink = async (provider: OAuthProvider) => {
    setLinkError(null);
    setUnlinkingProvider(provider);
    try {
      const identity = user?.identities?.find((id) => id.provider === provider);
      if (!identity) throw new Error('Identity not found');
      await unlinkIdentity(identity);
    } catch (err: unknown) {
      setLinkError(err instanceof Error ? err.message : 'Failed to unlink');
    }
    setUnlinkingProvider(null);
  };

  // AI key status state
  const [aiKeyStatuses, setAiKeyStatuses] = useState<AiKeyStatus[]>([]);
  const [aiKeysLoading, setAiKeysLoading] = useState(true);

  // Load profile display name once
  if (profile && !nameLoaded) {
    setDisplayName(profile.display_name ?? '');
    setNameLoaded(true);
  }

  const handleSaveName = async () => {
    setSaving(true);
    try {
      await updateProfile({ display_name: displayName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silently fail for now
    }
    setSaving(false);
  };

  // Load AI key statuses on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAiKeysLoading(true);
      try {
        const authHeader = await getAuthHeader();
        if (!authHeader) return;
        const res = await fetch('/api/user/ai-keys', {
          headers: { Authorization: authHeader },
        });
        if (!res.ok || cancelled) return;
        const data: AiKeyStatus[] = await res.json();
        if (!cancelled) setAiKeyStatuses(data);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setAiKeysLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshAiKeyStatus = async () => {
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) return;
      const res = await fetch('/api/user/ai-keys', { headers: { Authorization: authHeader } });
      if (!res.ok) return;
      const data: AiKeyStatus[] = await res.json();
      setAiKeyStatuses(data);
    } catch {
      // silently fail
    }
  };

  const AI_SERVICE_PROVIDERS: AiServiceProvider[] = ['anthropic', 'openai', 'google'];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] uppercase text-muted mb-2 font-mono">
          Settings
        </p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
          Configuration
        </h1>
      </div>

      <div className="space-y-px border border-border bg-border">
        {/* Account */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Shield size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Account</h2>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Email</span>
              <span className="text-xs text-heading font-mono">{user?.email ?? 'Not signed in'}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-xs text-muted shrink-0">Display Name</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors w-48"
                  placeholder="Your name"
                />
                <button
                  type="button"
                  onClick={handleSaveName}
                  disabled={saving}
                  className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                >
                  {saved ? <Check size={12} /> : saving ? '…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sign-in Methods */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-2">
            <LogIn size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Sign-in Methods</h2>
          </div>
          <p className="text-[11px] text-muted mb-5">
            Link multiple accounts to your profile. You can sign in with any linked provider and access the same projects and data.
            {!canUnlink && (
              <span className="block mt-1 text-muted/70">Link a second provider before you can unlink this one.</span>
            )}
          </p>
          {linkError && (
            <p className="text-[10px] text-danger font-mono mb-3">{linkError}</p>
          )}
          <div className="space-y-3">
            {SIGN_IN_PROVIDERS.map(({ id, label, note }) => {
              const linked = linkedProviders.has(id);
              const isLinking = linkingProvider === id;
              const isUnlinking = unlinkingProvider === id;
              return (
                <div key={id} className="flex items-center justify-between gap-4 py-2 border-b border-border/50 last:border-0">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-heading">{label}</span>
                    <p className="text-[10px] text-muted mt-0.5">{note}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {linked && (
                      <span className="flex items-center gap-1 text-[10px] text-accent3 font-mono">
                        <Check size={9} /> Linked
                      </span>
                    )}
                    {linked ? (
                      <button
                        type="button"
                        onClick={() => handleUnlink(id)}
                        disabled={!canUnlink || isUnlinking}
                        title={!canUnlink ? 'Link another provider first' : `Unlink ${label}`}
                        className="flex items-center gap-1 px-2.5 py-1 border border-danger/30 text-danger text-[10px] font-sans font-semibold uppercase hover:bg-danger/5 transition-colors rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {isUnlinking ? <Loader2 size={9} className="animate-spin" /> : <Unlink size={9} />}
                        Unlink
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleLink(id)}
                        disabled={!!linkingProvider || isLinking}
                        className="flex items-center gap-1 px-2.5 py-1 border border-accent/30 text-accent text-[10px] font-sans font-semibold uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-40"
                      >
                        {isLinking ? <Loader2 size={9} className="animate-spin" /> : <Link size={9} />}
                        {isLinking ? 'Redirecting…' : 'Link'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Microsoft 365 Integration */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Github size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Microsoft 365</h2>
          </div>
          <p className="text-[11px] text-muted mb-4">Connect your Microsoft 365 account to import OneNote pages and OneDrive files into projects.</p>
          <div className="flex justify-between items-center">
            <div>
              <span className="text-xs text-muted block">OneDrive &amp; OneNote</span>
              {msStatus?.connected && (
                <span className="text-[10px] text-muted font-mono">{msStatus.email}</span>
              )}
            </div>
            {msLoading ? (
              <Loader2 size={12} className="animate-spin text-muted" />
            ) : msStatus?.connected ? (
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-accent3 font-mono">Connected</span>
                <button
                  type="button"
                  onClick={msDisconnect}
                  className="flex items-center gap-1 text-[10px] text-danger hover:underline"
                >
                  <Unlink size={10} /> Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={msConnect}
                  disabled={msConnecting}
                  className="flex items-center gap-1 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                >
                  {msConnecting ? <Loader2 size={10} className="animate-spin" /> : <Link size={10} />}
                  {msConnecting ? 'Redirecting…' : 'Connect'}
                </button>
                {msError && (
                  <span className="text-[10px] text-danger font-mono max-w-[240px] text-right">{msError}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI Providers */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">AI Providers</h2>
          </div>
          <p className="text-[11px] text-muted mb-5">
            Optionally supply your own API keys. When set, your key is used instead of the server's shared key for all AI requests you make. Keys are stored encrypted.
          </p>
          {aiKeysLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-3">
              {AI_SERVICE_PROVIDERS.map((p) => (
                <AiProviderCard
                  key={p}
                  provider={p}
                  status={aiKeyStatuses.find((s) => s.provider === p)}
                  onSaved={() => refreshAiKeyStatus()}
                  onRemoved={() => refreshAiKeyStatus()}
                  onConnectGoogle={connectGoogleAI}
                  isGoogleLinked={linkedProviders.has('google')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Preferences */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Palette size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Preferences</h2>
          </div>
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Theme</span>
              <span className="text-xs text-heading font-mono">Managed via theme switcher</span>
            </div>

            {/* Timezone */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Clock size={11} className="text-muted" />
                <span className="text-xs text-muted">Timezone</span>
              </div>
              <div className="max-w-[560px] mx-auto">
                <TimezoneGlobe value={tfSettings.timezone} onChange={setTimezone} />
              </div>
            </div>

            {/* Time format */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <Clock size={11} className="text-muted" />
                <span className="text-xs text-muted">Time Format</span>
              </div>
              <div className="flex border border-border rounded overflow-hidden text-[10px] font-mono">
                {(['h12', 'h23'] as HourCycle[]).map((hc) => (
                  <button
                    key={hc}
                    type="button"
                    onClick={() => setHourCycle(hc)}
                    className={`px-3 py-1.5 transition-colors ${
                      tfSettings.hourCycle === hc
                        ? 'bg-accent text-[var(--color-accent-fg)]'
                        : 'text-muted hover:text-heading hover:bg-surface2'
                    }`}
                  >
                    {hc === 'h12' ? '12h' : '24h'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-5">
            <Bell size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">Notifications</h2>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Deadline Alerts</span>
              <span className="text-xs text-heading font-mono">Enabled</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Weekly Digest</span>
              <span className="text-xs text-heading font-mono">Enabled</span>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-8 border border-danger/30 bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Monitor size={14} className="text-danger" />
          <h2 className="font-sans text-sm font-bold text-danger">Danger Zone</h2>
        </div>
        <p className="text-xs text-muted mb-4">
          Delete your account and all associated data. This action cannot be undone.
        </p>
        <button type="button" className="px-5 py-2 border border-danger/30 text-danger text-xs font-sans font-semibold tracking-wider uppercase hover:bg-danger/5 transition-colors rounded-md">
          Delete Account
        </button>
      </div>
    </div>
  );
}
