'use strict';

(async () => {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('homeeasy') !== '1') return;
    if (sessionStorage.getItem('homeeasy-login-attempted') === '1') return;

    const login = document.querySelector('input[name="Login"]');
    const password = document.querySelector('input[name="Password"]');
    const button = document.querySelector('[name="LoginButton"]');
    if (!login || !password || !button) return;

    const response = await chrome.runtime.sendMessage({ type: 'HOMEEASY_LOGIN_PAGE_READY' });
    if (!response || !response.ok) return;

    sessionStorage.setItem('homeeasy-login-attempted', '1');

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(login, response.login || '');
    login.dispatchEvent(new Event('input', { bubbles: true }));
    login.dispatchEvent(new Event('change', { bubbles: true }));

    setter.call(password, response.password || '');
    password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 250));
    button.click();
  } catch (_) {}
})();
