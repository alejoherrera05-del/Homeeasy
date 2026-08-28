(() => {
  'use strict';

  const HOMMY_BACKEND = 'https://homeeasy-hommy-staging.onrender.com';
  const HEALTH_TIMEOUT_MS = 75_000;
  const API_TIMEOUT_MS = 120_000;
  const upstreamFetch = window.fetch.bind(window);

  window.fetch = function hommyResilientFetch(resource, init) {
    const rawUrl = typeof resource === 'string'
      ? resource
      : (resource && resource.url ? resource.url : '');

    if (!rawUrl.startsWith(HOMMY_BACKEND)) {
      return upstreamFetch(resource, init);
    }

    const options = { ...(init || {}) };
    const controller = new AbortController();
    const timeoutMs = rawUrl.includes('/api/health') ? HEALTH_TIMEOUT_MS : API_TIMEOUT_MS;
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    // Hommy's UI uses shorter local timers. Render Free can need ~50s to wake,
    // so replace that signal only for the isolated Hommy staging backend.
    options.signal = controller.signal;

    return upstreamFetch(resource, options).finally(() => window.clearTimeout(timer));
  };
})();
