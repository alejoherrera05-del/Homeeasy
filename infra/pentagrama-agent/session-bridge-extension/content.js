'use strict';

(async () => {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('homeeasy') !== '1') return;
    const login = document.querySelector('input[name="Login"]');
    const password = document.querySelector('input[name="Password"]');
    const button = document.querySelector('[name="LoginButton"]');
    if (!login || !password || !button) return;

    const response = await chrome.runtime.sendMessage({ type: 'HOMEEASY_LOGIN_PAGE_READY' });
    if (!response || !response.ok) return;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(login, response.login || '');
    login.dispatchEvent(new Event('input', { bubbles: true }));
    login.dispatchEvent(new Event('change', { bubbles: true }));

    setter.call(password, response.password || '');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 250));

    const captcha = document.querySelector('#CaptchaValue, input[name="CaptchaValue"]');
    const captchaVisible = Boolean(captcha && captcha.getClientRects().length && getComputedStyle(captcha).visibility !== 'hidden');
    if (captchaVisible) {
      try { captcha.focus(); } catch (_) {}
      await chrome.runtime.sendMessage({ type: 'HOMEEASY_CAPTCHA_REQUIRED' }).catch(() => null);
      return;
    }

    button.click();
  } catch (_) {}
})();
