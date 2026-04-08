import { Suspense, useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { useProfile } from '../hooks/useProfile';
import { useTimeFormat, type HourCycle } from '../lib/time-format';
import { useAIAgent } from '../lib/ai-agent';
import { canonicalizeOpenAiModelId, normalizeOpenAiModelIds } from '../lib/openai-models';
import { supabase } from '../lib/supabase';
import { lazyWithRetry } from '../lib/lazy-with-retry';
import { Monitor, Bell, Palette, Shield, Check, ChevronDown, Loader2, Clock, KeyRound, Eye, EyeOff, Trash2, ExternalLink, RefreshCw, Camera, X } from 'lucide-react';

const TimezoneGlobe = lazyWithRetry(() => import('../components/TimezoneGlobe'), 'settings-timezone-globe');

// ── AI Provider key management ─────────────────────────────────────────────

type AiServiceProvider = 'anthropic' | 'openai' | 'google' | 'google_ai';
type OpenAiCredentialMode = 'openai' | 'azure_openai';

interface AiKeyConfig {
  mode?: OpenAiCredentialMode;
  endpoint?: string;
  preferredModel?: string;
  enabledModels?: string[];
}

interface AiKeyStatus {
  provider: AiServiceProvider;
  hasKey: boolean;
  lastUpdated: string | null;
  credentialType: 'api_key' | 'oauth';
  config?: AiKeyConfig;
}

interface ProviderModelOption {
  id: string;
  label: string;
  description: string;
}

const ANTHROPIC_MODEL_OPTIONS: ProviderModelOption[] = [
  { id: 'claude-haiku', label: 'Claude Haiku', description: 'Fastest option for quick questions and summaries' },
  { id: 'claude-sonnet', label: 'Claude Sonnet 4.6', description: 'Balanced option for analysis and general chat' },
  { id: 'claude-opus', label: 'Claude Opus 4.6', description: 'Deepest option for heavy reasoning and project work' },
];

const GOOGLE_AI_MODEL_OPTIONS: ProviderModelOption[] = [
  { id: 'gemini-pro', label: 'Gemini 2.5 Flash', description: 'Google AI Studio chat model' },
];

const GENAI_MIL_MODEL_OPTIONS: ProviderModelOption[] = [
  { id: 'genai-mil', label: 'GenAI.mil', description: 'STARK-backed DoD model access' },
];

function uniqueModelIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getModelCapabilityScore(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  let score = 0;

  if (normalized.includes('claude-opus')) score = 1000;
  else if (normalized.startsWith('gpt-5')) score = 900;
  else if (normalized.startsWith('o4')) score = 850;
  else if (normalized.includes('claude-sonnet')) score = 800;
  else if (normalized.startsWith('o3')) score = 780;
  else if (normalized.startsWith('codex')) score = 760;
  else if (normalized.startsWith('o1')) score = 740;
  else if (normalized.startsWith('gpt-4.1')) score = 700;
  else if (normalized.startsWith('gpt-4o')) score = 650;
  else if (normalized.includes('gemini')) score = 600;
  else if (normalized.includes('claude-haiku')) score = 500;
  else if (normalized.includes('genai-mil')) score = 450;
  else if (normalized.startsWith('gpt-4')) score = 400;
  else if (normalized.startsWith('gpt-3.5')) score = 300;

  if (/(^|[-_.])nano($|[-_.])/.test(normalized)) score -= 40;
  if (/(^|[-_.])mini($|[-_.])/.test(normalized)) score -= 25;
  if (/(^|[-_.])flash($|[-_.])/.test(normalized)) score -= 20;

  const datedVersion = normalized.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (datedVersion) {
    score += Number(`${datedVersion[1]}${datedVersion[2]}${datedVersion[3]}`) / 100000000;
  }

  return score;
}

function pickMostCapableModelId(modelIds: string[]): string {
  const uniqueIds = uniqueModelIds(modelIds);
  if (uniqueIds.length === 0) return '';

  return [...uniqueIds].sort((a, b) => {
    const diff = getModelCapabilityScore(b) - getModelCapabilityScore(a);
    return diff !== 0 ? diff : a.localeCompare(b);
  })[0];
}

function getDefaultSelectedModelIds(options: ProviderModelOption[], preferredModel?: string): string[] {
  const explicitPreferred = preferredModel?.trim() ?? '';
  if (explicitPreferred) return [explicitPreferred];

  const strongest = pickMostCapableModelId(options.map((option) => option.id));
  return strongest ? [strongest] : [];
}

function canonicalizeSelectedModelIds(modelIds: string[], availableModelIds: string[]): string[] {
  return normalizeOpenAiModelIds(modelIds.map((modelId) => canonicalizeOpenAiModelId(modelId, availableModelIds)));
}

const AI_PROVIDER_META: Record<AiServiceProvider, { label: string; hint: string; placeholder: string; keyUrl: string }> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    hint: 'Used for Claude Haiku, Sonnet, and Opus models',
    placeholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI',
    hint: 'Used to load and select the chat models available on your OpenAI account',
    placeholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'GenAI.mil (DoD)',
    hint: 'DoD GenAI.mil platform — requires a STARK API key (STARK_… or STARK-…)',
    placeholder: 'STARK_…',
    keyUrl: 'https://ai.dod.mil',
  },
  google_ai: {
    label: 'Google AI Studio (Gemini)',
    hint: 'Gemini 2.5 Flash via Google AI Studio',
    placeholder: 'AIza…',
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
  modelOptions,
  onSaved,
  onRemoved,
  onConnectGoogle,
  isGoogleLinked,
}: {
  provider: AiServiceProvider;
  status: AiKeyStatus | undefined;
  modelOptions: ProviderModelOption[];
  onSaved: (provider: AiServiceProvider) => void;
  onRemoved: (provider: AiServiceProvider) => void;
  onConnectGoogle?: () => void;
  isGoogleLinked?: boolean;
}) {
  const meta = AI_PROVIDER_META[provider];
  const [inputKey, setInputKey] = useState('');
  const [openAiMode, setOpenAiMode] = useState<OpenAiCredentialMode>(
    provider === 'openai' && status?.config?.mode === 'azure_openai' ? 'azure_openai' : 'openai',
  );
  const [azureEndpoint, setAzureEndpoint] = useState(
    provider === 'openai' ? status?.config?.endpoint ?? '' : '',
  );
  const [selectedModels, setSelectedModels] = useState<string[]>(
    uniqueModelIds(
      status?.config?.enabledModels?.length
        ? status.config.enabledModels
        : getDefaultSelectedModelIds(
            modelOptions,
            provider === 'openai' ? status?.config?.preferredModel : undefined,
          ),
    ),
  );
  const [azureDeploymentInput, setAzureDeploymentInput] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const hasKey = status?.hasKey ?? false;
  const isOAuth = status?.credentialType === 'oauth';
  const isAzureOpenAi = provider === 'openai' && openAiMode === 'azure_openai';
  const keyValue = inputKey;
  const keyPlaceholder = hasKey && !isOAuth
    ? '••••••••••••••••'
    : provider === 'openai' && isAzureOpenAi
      ? 'Azure OpenAI API key'
      : meta.placeholder;
  const canSave = provider === 'openai'
    ? (!!inputKey.trim() || hasKey) && (!isAzureOpenAi || !!azureEndpoint.trim()) && selectedModels.length > 0
    : (!!inputKey.trim() || hasKey) && selectedModels.length > 0;
  const availableModelIds = modelOptions.map((option) => option.id);
  const azureDeploymentOptions = isAzureOpenAi
    ? uniqueModelIds([...selectedModels, ...availableModelIds]).map((id) => ({
        id,
        label: id,
        description: 'Azure OpenAI deployment name',
      }))
    : modelOptions;

  useEffect(() => {
    if (provider !== 'openai') return;
    setOpenAiMode(status?.config?.mode === 'azure_openai' ? 'azure_openai' : 'openai');
    setAzureEndpoint(status?.config?.endpoint ?? '');
  }, [provider, status?.config?.endpoint, status?.config?.mode]);

  useEffect(() => {
    const defaults = getDefaultSelectedModelIds(
      modelOptions,
      provider === 'openai' ? status?.config?.preferredModel : undefined,
    );
    const nextSelectedModels = uniqueModelIds(status?.config?.enabledModels?.length ? status.config.enabledModels : defaults);
    if (provider === 'openai' && openAiMode !== 'azure_openai') {
      setSelectedModels(canonicalizeSelectedModelIds(nextSelectedModels, modelOptions.map((option) => option.id)));
      return;
    }
    setSelectedModels(nextSelectedModels);
  }, [modelOptions, openAiMode, provider, status?.config?.enabledModels, status?.config?.preferredModel]);

  useEffect(() => {
    if (!modelPickerOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(event.target as Node)) {
        setModelPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelPickerOpen]);

  const toggleSelectedModel = (modelId: string) => {
    setSelectedModels((current) => {
      if (current.includes(modelId)) {
        return current.length === 1 ? current : current.filter((id) => id !== modelId);
      }
      const next = [...current, modelId];
      if (provider === 'openai' && openAiMode !== 'azure_openai') {
        return canonicalizeSelectedModelIds(next, modelOptions.map((option) => option.id));
      }
      return next;
    });
  };

  const handleAddAzureDeployment = () => {
    const deployment = azureDeploymentInput.trim();
    if (!deployment) return;
    setSelectedModels((current) => uniqueModelIds([...current, deployment]));
    setAzureDeploymentInput('');
    setModelPickerOpen(true);
  };

  const handleToggleReveal = async () => {
    if (!inputKey && hasKey && !isOAuth) {
      setError('Stored keys cannot be revealed. Enter a new key to replace the saved one.');
      return;
    }
    setShowKey((value) => !value);
  };

  const handleSave = async () => {
    const trimmed = inputKey.trim();
    if (!trimmed && !hasKey) {
      setError('API key cannot be empty');
      return;
    }
    const trimmedEndpoint = azureEndpoint.trim();
    if (provider === 'openai' && isAzureOpenAi && !trimmedEndpoint) {
      setError('Azure OpenAI endpoint cannot be empty');
      return;
    }
    setError(null);
    setTestResult(null);
    setSaving(true);
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) throw new Error('Not authenticated');
      const config: AiKeyConfig = {
        ...(provider === 'openai'
          ? {
              mode: openAiMode,
              ...(isAzureOpenAi ? { endpoint: trimmedEndpoint } : {}),
              ...(selectedModels[0] ? { preferredModel: selectedModels[0] } : {}),
            }
          : {}),
        enabledModels: uniqueModelIds(selectedModels),
      };

      const res = trimmed
        ? await fetch('/api/user/ai-keys', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({
              provider,
              apiKey: trimmed,
              config,
            }),
          })
        : await fetch(`/api/user/ai-keys/${provider}/config`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({ config }),
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
    setTestResult(null);
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
      if (provider === 'openai') {
        setAzureEndpoint('');
      }
      onRemoved(provider);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    }
    setRemoving(false);
  };

  const handleTest = async () => {
    setError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) throw new Error('Not authenticated');
      const trimmedKey = inputKey.trim();
      const config: AiKeyConfig = {
        ...(provider === 'openai'
          ? {
              mode: openAiMode,
              ...(isAzureOpenAi ? { endpoint: azureEndpoint.trim() } : {}),
              ...(selectedModels[0] ? { preferredModel: selectedModels[0] } : {}),
            }
          : {}),
        enabledModels: uniqueModelIds(selectedModels),
      };

      const res = await fetch(`/api/user/ai-keys/${provider}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          ...(trimmedKey ? { apiKey: trimmedKey } : {}),
          config,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = body as { message?: string; model?: string };
      setTestResult({
        ok: true,
        message: data.model ? `${data.message ?? 'Credential is valid.'} Model: ${data.model}` : (data.message ?? 'Credential is valid.'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Credential test failed';
      setError(message);
      setTestResult({ ok: false, message });
    }
    setTesting(false);
  };

  const selectedModelSummary = selectedModels.length === 1
    ? (modelOptions.find((option) => option.id === selectedModels[0])?.label ?? selectedModels[0] ?? 'Choose a model')
    : selectedModels.length > 1
      ? `${selectedModels.length} models selected`
      : 'Choose a model';

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
          <span className="text-[10px] text-danger font-mono border border-danger/30 px-2 py-0.5 rounded shrink-0">
            No key
          </span>
        )}
      </div>

      {/* Google OAuth option — only for google_ai (Google AI Studio) provider */}
      {provider === 'google_ai' && isGoogleLinked && (
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

      {provider === 'openai' && (
        <div className="space-y-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted">Credential type</span>
            <span className="text-[10px] text-muted/70">OpenAI key or Azure OpenAI endpoint + key</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpenAiMode('openai')}
              className={`px-3 py-1.5 border text-[10px] font-sans font-semibold tracking-wider uppercase rounded transition-colors ${
                openAiMode === 'openai'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted hover:text-heading hover:border-accent/20'
              }`}
            >
              OpenAI Key
            </button>
            <button
              type="button"
              onClick={() => setOpenAiMode('azure_openai')}
              className={`px-3 py-1.5 border text-[10px] font-sans font-semibold tracking-wider uppercase rounded transition-colors ${
                openAiMode === 'azure_openai'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted hover:text-heading hover:border-accent/20'
              }`}
            >
              Azure OpenAI
            </button>
          </div>
          {isAzureOpenAi && (
            <div className="space-y-1">
              <label className="block text-[10px] text-muted">Azure endpoint</label>
              <input
                type="text"
                value={azureEndpoint}
                onChange={(e) => setAzureEndpoint(e.target.value)}
                placeholder="https://your-resource.openai.azure.com/openai/v1"
                className="w-full px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors"
              />
              <p className="text-[10px] text-muted">
                Use the Azure OpenAI base URL ending in <span className="font-mono">/openai/v1</span>, matching your Codex config format.
              </p>
            </div>
          )}
        </div>
      )}

      {provider === 'openai' && isAzureOpenAi && (
        <div className="space-y-2 border-b border-border/50 pb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted">Azure deployment names</span>
            <span className="text-[10px] text-muted/70">Use the exact deployment IDs from Azure, not the base model family</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={azureDeploymentInput}
              onChange={(e) => setAzureDeploymentInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddAzureDeployment();
                }
              }}
              placeholder="gpt-5.4-2"
              className="flex-1 px-3 py-1.5 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors"
            />
            <button
              type="button"
              onClick={handleAddAzureDeployment}
              disabled={!azureDeploymentInput.trim()}
              className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <p className="text-[10px] text-muted">
            Odyssey will send the selected deployment name exactly as entered when it calls Azure OpenAI.
          </p>
        </div>
      )}

      <div className="space-y-2 border-b border-border/50 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted">Show these models in the top AI dropdown</span>
          <span className="text-[10px] text-muted font-mono">{selectedModels.length} selected</span>
        </div>
        <div ref={modelPickerRef} className="relative">
          <button
            type="button"
            onClick={() => setModelPickerOpen((current) => !current)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-surface border border-border text-left rounded hover:border-accent/30 hover:bg-surface2 transition-colors"
          >
            <span className="min-w-0">
              <span className="block text-[10px] text-muted uppercase tracking-[0.16em] font-semibold">Choose a model</span>
              <span className="block text-[11px] text-heading font-mono truncate">{selectedModelSummary}</span>
            </span>
            <ChevronDown
              size={14}
              className={`shrink-0 text-muted transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {modelPickerOpen && (
            <div className="absolute left-0 right-0 top-full mt-2 z-20 border border-border bg-surface rounded shadow-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-border/60 bg-surface2">
                <span className="block text-[10px] text-heading font-semibold">
                  {provider === 'openai'
                    ? isAzureOpenAi ? 'Choose Azure deployments' : 'Choose OpenAI models'
                    : 'Choose models'}
                </span>
                <span className="block text-[10px] text-muted">
                  Check each box to add it to the top AI dropdown.
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {azureDeploymentOptions.length > 0 ? (
                  <div className="divide-y divide-border/60">
                    {azureDeploymentOptions.map((option) => {
                      const checked = selectedModels.includes(option.id);
                      return (
                        <label key={option.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-surface2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelectedModel(option.id)}
                            className="mt-0.5 accent-[var(--color-accent)]"
                          />
                          <span className="min-w-0">
                            <span className="block text-[11px] text-heading font-mono">{option.label}</span>
                            <span className="block text-[10px] text-muted">{option.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-3 text-[10px] text-muted">
                    {provider === 'openai' && isAzureOpenAi
                      ? 'Add at least one Azure deployment name above.'
                      : 'Save and test your credential first to load model choices for this provider.'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted">
          The first selected model is used as this provider&apos;s default, and new keys start with the most capable model selected by itself.
        </p>
      </div>

      {/* API key input row */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[10px] text-muted">
            {provider === 'openai' && isAzureOpenAi ? 'Azure OpenAI key' : 'API key'}
          </span>
          {(!isAzureOpenAi || provider !== 'openai') && (
            <a
              href={meta.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-[10px] text-accent/70 hover:text-accent transition-colors ml-1"
            >
              Get key <ExternalLink size={9} />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyValue}
              onChange={(e) => { setError(null); setInputKey(e.target.value); }}
              placeholder={keyPlaceholder}
              className="w-full px-3 py-1.5 pr-8 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <button
              type="button"
              onClick={handleToggleReveal}
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
            disabled={saving || !canSave}
            className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-40 flex items-center gap-1"
          >
            {saving ? <Loader2 size={10} className="animate-spin" /> : savedFlash ? <Check size={10} /> : null}
            {savedFlash ? 'Saved' : 'Save'}
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !hasKey}
            className="px-3 py-1.5 border border-border text-heading text-[10px] font-sans font-semibold tracking-wider uppercase hover:bg-surface2 transition-colors rounded disabled:opacity-40 flex items-center gap-1"
            title={hasKey ? 'Test stored credential' : 'Save a key first'}
          >
            {testing ? <Loader2 size={10} className="animate-spin" /> : null}
            {testing ? 'Testing' : 'Test'}
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

      {testResult && testResult.ok && (
        <p className="text-[10px] text-accent3 font-mono">{testResult.message}</p>
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

// ── Main SettingsPage ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user, connectGoogleAI } = useAuth();
  const { profile, updateProfile } = useProfile();
  const { providers: aiProviders, refreshProviders } = useAIAgent();
  const { settings: tfSettings, setTimezone, setHourCycle } = useTimeFormat();
  const [displayName, setDisplayName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Avatar editor state
  const [avatarEditing, setAvatarEditing] = useState(false);
  const [avatarMode, setAvatarMode] = useState<'initials' | 'photo'>('initials');
  const [avatarInitials, setAvatarInitials] = useState('');
  const [avatarColor, setAvatarColor] = useState('#1d4ed8');
  const [avatarPhotoDataUrl, setAvatarPhotoDataUrl] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  // AI key status state
  const [aiKeyStatuses, setAiKeyStatuses] = useState<AiKeyStatus[]>([]);
  const [aiKeysLoading, setAiKeysLoading] = useState(true);

  // Load profile display name once
  if (profile && !nameLoaded) {
    setDisplayName(profile.display_name ?? '');
    setNameLoaded(true);
    // Init avatar state from saved value
    const saved = profile.avatar_url ?? '';
    if (saved.startsWith('{')) {
      try {
        const parsed = JSON.parse(saved) as { initials?: string; color?: string };
        setAvatarMode('initials');
        setAvatarInitials(parsed.initials ?? '');
        setAvatarColor(parsed.color ?? '#1d4ed8');
      } catch { /* ignore */ }
    } else if (saved.startsWith('data:') || saved.startsWith('http')) {
      setAvatarMode('photo');
      setAvatarPhotoDataUrl(saved);
    }
  }

  // Derive a readable text color from a hex background
  function contrastColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Pick a lightened or darkened version of the same hue for the text
    if (luminance > 0.5) {
      // dark text: darken significantly
      const darken = (c: number) => Math.max(0, Math.round(c * 0.35));
      return `rgb(${darken(r)},${darken(g)},${darken(b)})`;
    } else {
      // light text: lighten significantly
      const lighten = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.75));
      return `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
    }
  }

  const handleAvatarPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatarPhotoDataUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAvatar = async () => {
    setAvatarSaving(true);
    try {
      let avatarValue: string;
      if (avatarMode === 'photo' && avatarPhotoDataUrl) {
        avatarValue = avatarPhotoDataUrl;
      } else {
        avatarValue = JSON.stringify({ initials: avatarInitials.slice(0, 2).toUpperCase(), color: avatarColor });
      }
      await updateProfile({ avatar_url: avatarValue });
      setAvatarEditing(false);
    } catch { /* silently fail */ }
    setAvatarSaving(false);
  };

  const currentAvatarUrl = profile?.avatar_url ?? null;
  const avatarIsCustomJson = currentAvatarUrl?.startsWith('{') ?? false;
  let avatarCustom: { initials: string; color: string } | null = null;
  if (avatarIsCustomJson && currentAvatarUrl) {
    try { avatarCustom = JSON.parse(currentAvatarUrl); } catch { /* ignore */ }
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

  const getModelOptionsForProvider = (provider: AiServiceProvider, currentStatus?: AiKeyStatus): ProviderModelOption[] => {
    if (provider === 'anthropic') return ANTHROPIC_MODEL_OPTIONS;
    if (provider === 'google_ai') return GOOGLE_AI_MODEL_OPTIONS;
    if (provider === 'google') return GENAI_MIL_MODEL_OPTIONS;

    const openAiProvider = aiProviders.find((entry) => entry.id === 'gpt-4o');
    const rawIds = uniqueModelIds([
      ...(openAiProvider?.models ?? []),
      ...(currentStatus?.config?.enabledModels ?? []),
      ...(currentStatus?.config?.preferredModel ? [currentStatus.config.preferredModel] : []),
    ]);
    const ids = currentStatus?.config?.mode === 'azure_openai'
      ? rawIds
      : normalizeOpenAiModelIds(rawIds);
    return ids.map((id) => ({
      id,
      label: id,
      description: currentStatus?.config?.mode === 'azure_openai'
        ? `Azure deployment ${id}`
        : `OpenAI model ${id}`,
    }));
  };

  const AI_SERVICE_PROVIDERS: AiServiceProvider[] = ['anthropic', 'openai', 'google_ai', 'google'];
  const isGoogleIdentityLinked = (user?.identities ?? []).some((identity) => identity.provider === 'google');

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
          <div className="flex gap-6 items-start">
            {/* Avatar column */}
            <div className="shrink-0 flex flex-col items-center gap-2">
              {/* Current avatar preview */}
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden border border-border cursor-pointer relative group"
                style={avatarCustom ? { backgroundColor: avatarCustom.color } : {}}
                onClick={() => setAvatarEditing((v) => !v)}
              >
                {currentAvatarUrl && !avatarIsCustomJson ? (
                  <img src={currentAvatarUrl} alt="" className="w-full h-full object-cover" />
                ) : avatarCustom ? (
                  <span className="text-lg font-bold select-none" style={{ color: contrastColor(avatarCustom.color) }}>
                    {avatarCustom.initials}
                  </span>
                ) : (
                  <span className="text-lg font-bold text-accent2 select-none">
                    {(displayName || user?.email || '?')[0]?.toUpperCase()}
                  </span>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
                  <Camera size={16} className="text-white" />
                </div>
              </div>
              <button type="button" onClick={() => setAvatarEditing((v) => !v)} className="text-[10px] text-accent hover:underline">
                {avatarEditing ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {/* Fields column */}
            <div className="flex-1 min-w-0">
              <div className="grid gap-4 sm:grid-cols-[minmax(120px,160px)_minmax(0,1fr)] sm:items-start">
                <div className="space-y-1 sm:pt-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                    Email
                  </span>
                  <span className="hidden sm:block text-[10px] text-muted/70">
                    Primary sign-in address
                  </span>
                </div>
                <div className="min-w-0 rounded border border-border/70 bg-surface/50 px-4 py-3">
                  <span className="block truncate text-sm text-heading font-mono">
                    {user?.email ?? 'Not signed in'}
                  </span>
                </div>

                <div className="space-y-1 sm:pt-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                    Display Name
                  </span>
                  <span className="hidden sm:block text-[10px] text-muted/70">
                    Used across comments, tasks, and activity
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="min-w-0 flex-1 px-4 py-2.5 bg-surface border border-border text-sm text-heading font-mono focus:outline-none focus:border-accent/50 transition-colors"
                    placeholder="Your name"
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={saving}
                    className="px-4 py-2.5 border border-accent/30 text-accent text-[11px] font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
                  >
                    {saved ? <Check size={12} /> : saving ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Avatar editor */}
          {avatarEditing && (
            <div className="mt-5 pt-5 border-t border-border space-y-4">
              {/* Mode tabs */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setAvatarMode('initials')}
                  className={`px-3 py-1 text-[11px] font-semibold rounded border transition-colors ${avatarMode === 'initials' ? 'bg-accent/10 border-accent/30 text-accent' : 'border-border text-muted hover:border-accent/20'}`}>
                  Initials
                </button>
                <button type="button" onClick={() => setAvatarMode('photo')}
                  className={`px-3 py-1 text-[11px] font-semibold rounded border transition-colors ${avatarMode === 'photo' ? 'bg-accent/10 border-accent/30 text-accent' : 'border-border text-muted hover:border-accent/20'}`}>
                  Photo
                </button>
              </div>

              {avatarMode === 'initials' && (
                <div className="flex items-center gap-4">
                  {/* Live preview */}
                  <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 border border-border"
                    style={{ backgroundColor: avatarColor }}>
                    <span className="text-base font-bold select-none" style={{ color: contrastColor(avatarColor) }}>
                      {avatarInitials.slice(0, 2).toUpperCase() || '??'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted w-16 shrink-0">Initials</label>
                      <input
                        type="text"
                        maxLength={2}
                        value={avatarInitials}
                        onChange={(e) => setAvatarInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/gi, ''))}
                        className="px-2 py-1 bg-surface border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 w-16 uppercase"
                        placeholder="AB"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted w-16 shrink-0">Color</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={avatarColor} onChange={(e) => setAvatarColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent p-0.5" />
                        <div className="flex gap-1">
                          {['#1d4ed8','#7c3aed','#be123c','#047857','#b45309','#0e7490','#374151'].map((c) => (
                            <button key={c} type="button" onClick={() => setAvatarColor(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${avatarColor === c ? 'border-heading' : 'border-transparent'}`}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {avatarMode === 'photo' && (
                <div className="flex items-center gap-4">
                  {avatarPhotoDataUrl && (
                    <div className="relative shrink-0">
                      <img src={avatarPhotoDataUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-border" />
                      <button type="button" onClick={() => setAvatarPhotoDataUrl(null)}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-surface border border-border rounded-full flex items-center justify-center hover:bg-surface2">
                        <X size={8} />
                      </button>
                    </div>
                  )}
                  <button type="button" onClick={() => avatarFileRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-[11px] text-muted hover:border-accent/30 hover:text-accent transition-colors rounded">
                    <Camera size={12} />
                    {avatarPhotoDataUrl ? 'Change photo' : 'Upload photo'}
                  </button>
                  <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarPhotoChange} />
                </div>
              )}

              <button type="button" onClick={handleSaveAvatar} disabled={avatarSaving}
                className="px-4 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50">
                {avatarSaving ? '…' : 'Save Avatar'}
              </button>
            </div>
          )}
        </div>

        {/* AI Providers */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound size={14} className="text-accent" />
            <h2 className="font-sans text-sm font-bold text-heading">AI Providers</h2>
          </div>
          <p className="text-[11px] text-muted mb-5">
            AI access now uses only personal keys linked to your account. Check which models should appear in the top AI dropdown for each provider here. Keys are stored encrypted.
          </p>
          {aiKeysLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-3">
              {AI_SERVICE_PROVIDERS.map((p) => {
                const providerStatus = aiKeyStatuses.find((s) => s.provider === p);
                return (
                <AiProviderCard
                  key={p}
                  provider={p}
                  status={providerStatus}
                  modelOptions={getModelOptionsForProvider(p, providerStatus)}
                  onSaved={() => { void refreshAiKeyStatus(); refreshProviders(); }}
                  onRemoved={() => { void refreshAiKeyStatus(); refreshProviders(); }}
                  onConnectGoogle={connectGoogleAI}
                  isGoogleLinked={isGoogleIdentityLinked}
                />
                );
              })}
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
                <Suspense fallback={<div className="h-[360px] border border-border bg-surface2 animate-pulse" />}>
                  <TimezoneGlobe value={tfSettings.timezone} onChange={setTimezone} />
                </Suspense>
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
