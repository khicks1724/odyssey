import { useState } from 'react';
import type { ReactNode } from 'react';
import Modal from '../components/Modal';
import { isOpenAIAgentValue, type AIAgentValue, type FixedAIProvider } from './ai-agent';

interface ProviderInfo {
  id: FixedAIProvider;
  name: string;
  available: boolean;
}

interface AIErrorState {
  title: string;
  message: string;
  detail?: string;
}

function getModelLabel(agent: AIAgentValue): string {
  if (agent === 'auto') return 'Auto';
  if (isOpenAIAgentValue(agent)) return `OpenAI ${agent.slice('openai:'.length)}`;

  switch (agent) {
    case 'claude-haiku':
      return 'Claude Haiku';
    case 'claude-sonnet':
      return 'Claude Sonnet 4.6';
    case 'claude-opus':
      return 'Claude Opus 4.6';
    case 'gpt-4o':
      return 'OpenAI GPT-4o';
    case 'gemini-pro':
      return 'Google Gemini 2.5 Flash';
    case 'genai-mil':
      return 'GenAI.mil';
  }
}

function normalizeErrorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'The AI request failed unexpectedly.';
}

function buildAIErrorState(agent: AIAgentValue, providers: ProviderInfo[], error: unknown, status?: number): AIErrorState {
  const detail = normalizeErrorMessage(error);
  const selectedModel = getModelLabel(agent);
  const providerInfo = agent === 'auto' ? null : providers.find((provider) => provider.id === (isOpenAIAgentValue(agent) ? 'gpt-4o' : agent));
  const lower = detail.toLowerCase();

  if (agent !== 'auto' && providerInfo && !providerInfo.available) {
    return {
      title: `${selectedModel} Unavailable`,
      message: `${selectedModel} is not available on your account right now. Add or fix your personal API key in Settings → AI Providers, then retry.`,
      detail,
    };
  }

  if (status === 402 || lower.includes('no credits') || lower.includes('insufficient_quota') || lower.includes('billing') || lower.includes('credit')) {
    return {
      title: 'AI Credits Required',
      message: agent === 'auto'
        ? 'The selected provider in Auto mode does not have usable credits. Try another model or add billing credits for this provider.'
        : `${selectedModel} has no usable credits on your configured API key. Add credits or switch to another checked model in Settings → AI Providers.`,
      detail,
    };
  }

  if (status === 401 || status === 403 || lower.includes('api key') || lower.includes('not set') || lower.includes('no key') || lower.includes('unauthorized')) {
    return {
      title: 'AI Key Missing',
      message: agent === 'auto'
        ? 'An AI provider required for this request is missing an API key or is not authorized.'
        : `${selectedModel} is missing a valid personal API key or is not authorized.`,
      detail,
    };
  }

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      title: 'AI Rate Limited',
      message: agent === 'auto'
        ? 'The current AI provider is rate limited right now. Wait a moment and try again.'
        : `${selectedModel} is being rate limited right now. Wait a moment and try again, or switch models.`,
      detail,
    };
  }

  if (status === 502 || status === 503 || status === 504 || lower.includes('failed to fetch') || lower.includes('network error') || lower.includes('server running') || lower.includes('bad gateway')) {
    return {
      title: 'AI Service Unreachable',
      message: 'Odyssey could not reach the AI service. Check that the API server is running and the provider is reachable, then retry.',
      detail,
    };
  }

  if (status === 404 && lower.includes('deployment')) {
    return {
      title: 'Azure Deployment Not Found',
      message: agent === 'auto'
        ? 'The selected Azure OpenAI deployment does not exist for this account. Update the deployment name in Settings → AI Providers.'
        : `${selectedModel} points to an Azure OpenAI deployment that does not exist. Update the deployment name in Settings → AI Providers.`,
      detail,
    };
  }

  return {
    title: 'AI Request Failed',
    message: agent === 'auto'
      ? 'The AI request could not be completed. Try again or switch to a specific model.'
      : `${selectedModel} could not complete this request. Try again or switch to another model.`,
    detail,
  };
}

export function useAIErrorDialog(agent: AIAgentValue, providers: ProviderInfo[]) {
  const [errorState, setErrorState] = useState<AIErrorState | null>(null);

  const showAIError = (error: unknown, status?: number) => {
    setErrorState(buildAIErrorState(agent, providers, error, status));
  };

  const dialog: ReactNode = (
    <Modal
      open={!!errorState}
      onClose={() => setErrorState(null)}
      title={errorState?.title ?? 'AI Request Failed'}
    >
      {errorState && (
        <div className="space-y-3">
          <p className="text-sm text-heading leading-relaxed">{errorState.message}</p>
          {errorState.detail && (
            <div className="border border-danger/20 bg-danger/5 rounded px-3 py-2">
              <p className="text-[11px] text-danger font-mono break-words">{errorState.detail}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );

  return { showAIError, aiErrorDialog: dialog };
}
