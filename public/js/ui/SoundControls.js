import { el } from './dom.js';

// Top-bar sound menu: a button that opens a small panel with Mute and the
// Music / Effects volume sliders. M toggles mute from anywhere in the game.
// It also unlocks audio on the player's first click or key press, because
// browsers do not allow sound before the page has been interacted with.
export class SoundControls {
  constructor({ audio, container, input, gestureTarget = window }) {
    this.audio = audio;
    this.container = container;

    if (!audio.supported) {
      container.replaceChildren(el('span', { class: 'status' }, 'Sound not supported in this browser'));
      return;
    }

    this.toggle = el('button', {
      class: 'btn small sound-toggle', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
      'aria-controls': 'sound-panel', onclick: () => this.setOpen(this.panel.hidden),
    });
    this.mute = el('button', { class: 'btn small', type: 'button', onclick: () => audio.toggleMute() });
    this.music = el('input', { type: 'range', min: '0', max: '100', id: 'music-volume', oninput: (e) => audio.setMusicVolume(e.target.value / 100) });
    this.sfx = el('input', { type: 'range', min: '0', max: '100', id: 'sfx-volume', oninput: (e) => audio.setSfxVolume(e.target.value / 100) });
    this.panel = el('div', { class: 'sound-panel', id: 'sound-panel', role: 'group', 'aria-label': 'Sound settings' },
      this.mute,
      el('label', { for: 'music-volume' }, 'Music', this.music),
      el('label', { for: 'sfx-volume' }, 'Effects', this.sfx),
      el('p', { class: 'sound-hint' }, 'Press M to mute or unmute'));
    this.panel.hidden = true;
    container.replaceChildren(this.toggle, this.panel);

    audio.onChange(() => this.render());
    this.render();

    if (input) input.on('mute', () => audio.toggleMute());
    const unlock = () => audio.unlock();
    gestureTarget.addEventListener('pointerdown', unlock);
    gestureTarget.addEventListener('keydown', unlock);
    // Close the panel when clicking elsewhere or pressing Escape.
    gestureTarget.addEventListener('pointerdown', (e) => {
      if (!this.panel.hidden && !container.contains(e.target)) this.setOpen(false);
    });
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.setOpen(false); this.toggle.focus(); }
    });
  }

  setOpen(open) {
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
  }

  render() {
    const { muted, musicVolume, sfxVolume } = this.audio.settings;
    this.toggle.textContent = muted ? '🔇 Sound off' : '🔊 Sound';
    this.toggle.title = muted ? 'Sound is muted (M)' : 'Sound settings (M to mute)';
    this.mute.textContent = muted ? 'Unmute' : 'Mute';
    this.mute.setAttribute('aria-pressed', String(muted));
    this.music.value = String(Math.round(musicVolume * 100));
    this.sfx.value = String(Math.round(sfxVolume * 100));
  }
}
