import { apiRequest } from '../api/apiClient.js';
import { el } from './dom.js';

// Virtual identity in the browser: who is logged in, the login/register
// panel and the account bar. The browser only ever knows what the server
// tells it via /api/auth/me - it never decides who the user is.
export class AccountUI {
  constructor({ api = apiRequest, bus, panels, root = document }) {
    this.api = api;
    this.bus = bus; // emits 'account:change' { user }
    this.panels = panels;
    this.root = root;
    this.user = null;
    this.bar = root.getElementById('account-bar');
    this.welcome = root.getElementById('menu-welcome');
    this.loginForm = root.getElementById('form-login');
    this.registerForm = root.getElementById('form-register');

    root.querySelectorAll('[data-auth-tab]').forEach((tab) => {
      tab.addEventListener('click', () => this.showTab(tab.dataset.authTab));
    });
    this.loginForm.addEventListener('submit', (e) => this.submit(e, this.loginForm, '/api/auth/login'));
    this.registerForm.addEventListener('submit', (e) => this.submit(e, this.registerForm, '/api/auth/register'));
  }

  // Restores the session after a page reload.
  async restore() {
    try {
      const { user } = await this.api('/api/auth/me');
      this.setUser(user);
    } catch {
      this.setUser(null);
    }
  }

  setUser(user, message) {
    this.user = user;
    this.renderBar(message);
    this.root.querySelectorAll('[data-requires-login]').forEach((n) => { n.hidden = !user; });
    this.root.querySelectorAll('[data-guest-only]').forEach((n) => { n.hidden = Boolean(user); });
    // UI convenience only - the server enforces the admin role itself.
    this.root.querySelectorAll('[data-requires-admin]').forEach((n) => { n.hidden = !user || user.role !== 'admin'; });
    this.welcome.textContent = user
      ? `Welcome back, ${user.username}. Your scores and trophies are saved.`
      : 'Playing as guest - log in to save scores and unlock trophies.';
    this.bus.emit('account:change', { user });
  }

  // Called when the server reports an expired session (401).
  sessionExpired(message) {
    this.setUser(null, message || 'Session expired - please log in again.');
  }

  renderBar(message) {
    const children = this.user
      ? [
        el('span', { class: 'pilot' }, `🚀 ${this.user.username}`, this.user.role === 'admin' ? el('em', {}, ' (admin)') : null),
        el('button', { class: 'link', type: 'button', onclick: () => this.logout() }, 'Log out'),
      ]
      : [
        message ? el('span', { class: 'warn' }, message) : null,
        el('button', { class: 'link', type: 'button', onclick: () => this.panels.open('auth') }, 'Log in'),
      ];
    this.bar.replaceChildren(...children.filter(Boolean));
  }

  showTab(name) {
    this.root.querySelectorAll('[data-auth-tab]').forEach((t) => {
      const active = t.dataset.authTab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
    this.loginForm.hidden = name !== 'login';
    this.registerForm.hidden = name !== 'register';
    (name === 'login' ? this.loginForm : this.registerForm).querySelector('input').focus();
  }

  async submit(event, form, path) {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const errorBox = form.querySelector('[data-form-error]');
    form.querySelectorAll('[data-field-error]').forEach((n) => { n.textContent = ''; });
    errorBox.textContent = '';
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const { user } = await this.api(path, { method: 'POST', body });
      form.reset();
      this.setUser(user);
      this.panels.close();
    } catch (err) {
      errorBox.textContent = err.message;
      for (const [field, text] of Object.entries(err.details || {})) {
        const slot = form.querySelector(`[data-field-error="${field}"]`);
        if (slot) slot.textContent = text;
      }
    } finally {
      button.disabled = false;
    }
  }

  async logout() {
    try {
      await this.api('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setUser(null);
    }
  }
}
