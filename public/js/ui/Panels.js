// Opens and closes the menu panels (login, profile, leaderboard).
// Panels sit on top of the menu; only one is open at a time.
export class Panels {
  constructor(root = document) {
    this.root = root;
    this.handlers = {}; // name -> callback run each time the panel opens
    this.current = null;
    root.querySelectorAll('[data-panel]').forEach((button) => {
      button.addEventListener('click', () => this.open(button.dataset.panel));
    });
    root.querySelectorAll('.panel [data-close]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.current) this.close();
    });
  }

  onOpen(name, handler) {
    this.handlers[name] = handler;
  }

  open(name) {
    this.close();
    const panel = this.root.getElementById(`panel-${name}`);
    if (!panel) return;
    panel.hidden = false;
    this.current = panel;
    if (this.handlers[name]) this.handlers[name]();
    const focusable = panel.querySelector('input, button.tab.active, button:not(.panel-close)');
    if (focusable) focusable.focus();
  }

  close() {
    if (this.current) this.current.hidden = true;
    this.current = null;
  }
}
