'use strict';

const GENAI_MIL_BASE_URL = 'https://api.genai.mil/v1';
const MAX_RESPONSE_LENGTH = 4 * 1024 * 1024;
const ALLOWED_PATHS = new Set(['/models', '/chat/completions']);

function isAllowedOdysseyPage(rawUrl) {
  try {
    const url = new URL(rawUrl || '');
    if (url.protocol === 'https:' && url.hostname === 'asterias.ssag.nps.edu') {
      return url.pathname === '/odyssey' || url.pathname.startsWith('/odyssey/');
    }
    return url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      && url.port === '5173';
  } catch {
    return false;
  }
}

function isStarkKey(value) {
  return typeof value === 'string'
    && value.length <= 2048
    && (value.startsWith('STARK_') || value.startsWith('STARK-'));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'genai-mil-request') return false;
  if (!isAllowedOdysseyPage(sender.url || (sender.tab && sender.tab.url))) {
    sendResponse({ ok: false, error: 'The extension rejected a request from an untrusted page.' });
    return false;
  }

  const request = message.request;
  if (!isStarkKey(message.apiKey)) {
    sendResponse({ ok: false, error: 'No valid browser-session STARK key was provided.' });
    return false;
  }
  if (!request || !ALLOWED_PATHS.has(request.path)) {
    sendResponse({ ok: false, error: 'The extension rejected an unsupported GenAI.mil path.' });
    return false;
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    sendResponse({ ok: false, error: 'The extension rejected an unsupported HTTP method.' });
    return false;
  }
  if (request.path === '/models' && request.method !== 'GET') {
    sendResponse({ ok: false, error: 'The GenAI.mil models endpoint requires GET.' });
    return false;
  }
  if (request.path === '/chat/completions' && request.method !== 'POST') {
    sendResponse({ ok: false, error: 'The GenAI.mil chat endpoint requires POST.' });
    return false;
  }

  const controller = new AbortController();
  const requestedTimeout = Number(request.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(5000, Math.min(requestedTimeout, 280000))
    : 280000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  fetch(`${GENAI_MIL_BASE_URL}${request.path}`, {
    method: request.method,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${message.apiKey}`,
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    signal: controller.signal,
  }).then(async (response) => {
    const body = await response.text();
    if (body.length > MAX_RESPONSE_LENGTH) {
      throw new Error('GenAI.mil returned a response larger than the Odyssey bridge limit.');
    }
    sendResponse({
      ok: true,
      response: {
        status: response.status,
        body,
        contentType: response.headers.get('content-type') || undefined,
        retryAfter: response.headers.get('retry-after') || undefined,
        transport: 'extension',
      },
    });
  }).catch((error) => {
    sendResponse({
      ok: false,
      error: controller.signal.aborted
        ? `The GenAI.mil extension request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
        : (error instanceof Error ? error.message : 'The GenAI.mil extension request failed.'),
    });
  }).finally(() => clearTimeout(timeout));

  return true;
});
