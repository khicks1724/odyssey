(() => {
  'use strict';

  const PAGE_SOURCE = 'odyssey-genai-mil-page-v1';
  const EXTENSION_SOURCE = 'odyssey-genai-mil-extension-v1';

  function reply(message) {
    window.postMessage({ source: EXTENSION_SOURCE, ...message }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE || typeof message.requestId !== 'string') return;

    if (message.type === 'ping') {
      reply({ type: 'pong', requestId: message.requestId });
      return;
    }
    if (message.type !== 'request') return;

    reply({ type: 'accepted', requestId: message.requestId });
    chrome.runtime.sendMessage({
      type: 'genai-mil-request',
      requestId: message.requestId,
      apiKey: message.apiKey,
      request: message.request,
    }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reply({
          type: 'result',
          requestId: message.requestId,
          ok: false,
          error: runtimeError.message || 'The GenAI.mil extension worker did not respond.',
        });
        return;
      }
      reply({
        type: 'result',
        requestId: message.requestId,
        ...(response && typeof response === 'object'
          ? response
          : { ok: false, error: 'The GenAI.mil extension returned an invalid response.' }),
      });
    });
  });

  reply({ type: 'ready', requestId: 'startup' });
})();
