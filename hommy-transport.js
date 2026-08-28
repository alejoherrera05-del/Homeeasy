(() => {
  'use strict';

  const HOMMY_BACKEND = 'https://homeeasy-hommy-staging.onrender.com';
  const HEALTH_TIMEOUT_MS = 75_000;
  const API_TIMEOUT_MS = 120_000;
  const upstreamFetch = window.fetch.bind(window);

  function targetsHommy(rawUrl) {
    try {
      return new URL(rawUrl, window.location.href).origin === HOMMY_BACKEND;
    } catch (_) {
      return false;
    }
  }

  window.fetch = function hommyResilientFetch(resource, init) {
    const rawUrl = typeof resource === 'string'
      ? resource
      : (resource && resource.url ? resource.url : '');

    if (!targetsHommy(rawUrl)) {
      return upstreamFetch(resource, init);
    }

    const options = { ...(init || {}) };
    const controller = new AbortController();
    const upstreamSignal = options.signal || (resource && resource.signal) || null;
    const timeoutMs = rawUrl.includes('/api/health') ? HEALTH_TIMEOUT_MS : API_TIMEOUT_MS;
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort(upstreamSignal?.reason);

    // Preserve the caller's cancellation while enforcing an absolute ceiling.
    // Hommy's own health and API timers are deliberately below these limits.
    if (upstreamSignal?.aborted) forwardAbort();
    else upstreamSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    options.signal = controller.signal;

    return upstreamFetch(resource, options).finally(() => {
      window.clearTimeout(timer);
      upstreamSignal?.removeEventListener?.('abort', forwardAbort);
    });
  };
})();
