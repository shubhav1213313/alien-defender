import { apiRequest } from '../api/apiClient.js';
import { ABILITIES } from '../game/AbilityDefinitions.js';
import { el } from './dom.js';

// Knowledge Challenge screen (Banana API puzzles).
//   wave    - compulsory after waves 1-4: 2 puzzles, 2/2 unlocks the ability
//   bonus   - Victory Bonus Challenge after the boss: 2 puzzles for points
//   special - optional VOID STORM puzzle: 1 puzzle, 20 s, no hint
// Flow: instructions + reward preview -> puzzle(s) with 0-9 buttons ->
// feedback -> result. The server holds the answers and calculates rewards.
// If the Banana API (or our server) is unavailable the player can Retry or
// Continue without the ability, so the game can never get stuck.
const ACHIEVEMENT_NAMES = { legendary_defender: 'Legendary Defender' };
const TITLES = { wave: 'Knowledge Challenge', bonus: 'Victory Bonus Challenge', special: '⚡ Special Puzzle' };

export function describeReward(reward) {
  const items = [];
  if (reward.ability) items.push(`Unlocked ${ABILITIES[reward.ability.id].name} - press ${ABILITIES[reward.ability.id].slot} in combat`);
  if (reward.energy) items.push(`+${reward.energy} Knowledge Energy`);
  if (reward.scoreBonus) items.push(`+${reward.scoreBonus.toLocaleString()} bonus points`);
  for (const id of reward.achievements || []) items.push(`Achievement: ${ACHIEVEMENT_NAMES[id] || id}`);
  return items.length ? items : ['No reward this time'];
}

export class KnowledgeArena {
  // getGameSessionId: the saved game's id for logged-in players (server
  // records results against it). getDifficulty: the current game difficulty.
  constructor({ engine, root, api = apiRequest, getGameSessionId = () => null, getDifficulty = () => 'normal', keyTarget = document }) {
    this.engine = engine;
    this.root = root;
    this.api = api;
    this.getGameSessionId = getGameSessionId;
    this.getDifficulty = getDifficulty;
    this.title = root.querySelector('[data-arena="title"]');
    this.subtitle = root.querySelector('[data-arena="subtitle"]');
    this.body = root.querySelector('[data-arena="body"]');
    this.timer = null;
    this.answerable = false;
    engine.bus.on('arena:open', (info) => this.open(info));
    // Number keys 0-9 answer the puzzle on screen.
    keyTarget.addEventListener('keydown', (e) => {
      if (!this.answerable || this.root.hidden || !/^[0-9]$/.test(e.key)) return;
      e.preventDefault();
      this.submit(Number(e.key));
    });
  }

  // ---- Intro: instructions and reward preview -------------------------------

  async open({ kind = 'wave', wave, nextWave }) {
    Object.assign(this, { kind, wave, nextWave, arena: null, reward: null, busy: false, correctSoFar: 0, answerable: false });
    this.title.textContent = TITLES[kind];
    this.subtitle.textContent = kind === 'wave'
      ? `Wave ${wave} cleared! Combat is paused. Solve the Banana puzzles before Wave ${nextWave}.`
      : kind === 'bonus'
        ? 'The Mothership is destroyed. Two final puzzles for bonus points.'
        : 'Combat is paused while you solve this puzzle.';
    this.showLoading('Loading challenge…');
    try {
      this.rules = await this.api(`/api/challenges/rules?kind=${kind}&wave=${wave}`);
      this.renderIntro();
    } catch (err) {
      this.showError(err.message, () => this.open({ kind, wave, nextWave }));
    }
  }

  renderIntro() {
    const { rules } = this;
    const ability = rules.ability ? ABILITIES[rules.ability.id] : null;
    const start = el('button', { class: 'btn primary', type: 'button', onclick: () => this.start() },
      rules.questions === 1 ? 'Show the puzzle' : 'Start the quiz');
    this.body.replaceChildren(
      el('p', { class: 'reward-preview' }, rules.preview),
      ability ? el('p', { class: 'arena-abilities' }, `${ability.name} (key ${ability.slot}, ${ability.cost} energy): ${ability.description}`) : null,
      el('ol', { class: 'arena-instructions' },
        el('li', {}, 'Each picture is a real Banana puzzle: work out the number hidden behind the banana.'),
        el('li', {}, 'Answer with the 0-9 buttons or your keyboard. You get ONE answer per puzzle.'),
        el('li', {}, `You have ${rules.timeLimitSeconds} seconds per puzzle.${rules.hintsAllowed ? ' Stuck? Use the hint button once per puzzle.' : ''}`),
        el('li', {}, `Every correct answer also gives +${rules.energyPerCorrect} Knowledge Energy for using abilities.`),
        rules.kind === 'wave' ? el('li', {}, 'Whatever your score, the next wave starts afterwards.') : null),
      el('p', { class: 'arena-note' }, rules.note),
      start,
    );
    start.focus();
  }

  async start() {
    if (this.busy) return;
    this.busy = true;
    this.showLoading('Opening the challenge…');
    try {
      const body = { kind: this.kind, wave: this.wave, difficulty: this.getDifficulty() };
      const gameSessionId = this.getGameSessionId();
      if (gameSessionId) body.gameSessionId = gameSessionId;
      this.arena = await this.api('/api/challenges', { method: 'POST', body });
      this.busy = false;
      await this.loadQuestion();
    } catch (err) {
      this.busy = false;
      this.showError(err.message, () => this.start());
    }
  }

  // ---- Questions -----------------------------------------------------------

  async loadQuestion() {
    this.showLoading('Fetching a puzzle from the Banana API…');
    try {
      this.question = await this.api(`/api/challenges/${this.arena.arenaId}/question`);
      this.renderQuestion();
    } catch (err) {
      this.showError(err.message, () => this.loadQuestion());
    }
  }

  renderQuestion() {
    const q = this.question;
    const buttons = Array.from({ length: 10 }, (_, digit) => el('button', {
      class: 'digit', type: 'button', 'data-digit': digit, 'aria-label': `Answer ${digit}`,
      onclick: () => this.submit(digit),
    }, String(digit)));
    const hintText = el('p', { class: 'arena-hint', 'aria-live': 'polite' });
    const hintButton = q.hintAvailable
      ? el('button', { class: 'btn small', type: 'button', onclick: () => this.useHint(hintButton, hintText) }, 'Show a hint')
      : null;
    this.timerBar = el('div', { class: 'arena-timer-fill' });
    this.timerText = el('span', { class: 'arena-timer-text' });

    this.body.replaceChildren(
      el('div', { class: 'arena-progress' },
        el('strong', {}, `PUZZLE ${q.questionNumber} OF ${q.totalQuestions}`),
        el('span', {}, `${this.correctSoFar} correct so far`),
        el('span', { class: 'badge live' }, `Live Banana API · ${q.latencyMs} ms`)),
      el('div', { class: 'arena-timer' }, this.timerBar, this.timerText),
      el('img', { class: 'arena-puzzle', src: q.image, alt: 'Banana mathematics puzzle: find the number hidden behind the banana' }),
      el('p', { class: 'arena-ask' }, 'What number is hidden behind the banana?'),
      el('div', { class: 'digit-pad', role: 'group', 'aria-label': 'Answer buttons 0 to 9' }, buttons),
      hintButton,
      hintText,
    );
    this.answerable = true;
    buttons[0].focus();
    this.startTimer(q.secondsRemaining, q.timeLimitSeconds);
  }

  startTimer(secondsRemaining, total) {
    this.stopTimer();
    const deadline = Date.now() + secondsRemaining * 1000;
    const tick = () => {
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      this.timerBar.style.width = `${(left / total) * 100}%`;
      this.timerBar.classList.toggle('low', left < 5);
      this.timerText.textContent = `${Math.ceil(left)}s`;
      if (left <= 0) this.submit(null); // time's up: counts as incorrect
    };
    tick();
    this.timer = setInterval(tick, 200);
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async useHint(button, output) {
    button.disabled = true;
    try {
      const { hint } = await this.api(`/api/challenges/${this.arena.arenaId}/hint`, { method: 'POST' });
      output.textContent = `Hint: ${hint}`;
    } catch (err) {
      output.textContent = err.message;
    }
  }

  // One submission per puzzle: `busy` blocks double clicks and key spam,
  // and the server rejects duplicates as well.
  async submit(answer) {
    if (this.busy || !this.answerable) return;
    this.busy = true;
    this.answerable = false;
    this.stopTimer();
    this.body.querySelectorAll('button').forEach((n) => { n.disabled = true; });
    try {
      const result = await this.api(`/api/challenges/${this.arena.arenaId}/answer`, {
        method: 'POST', body: { questionIndex: this.question.questionIndex, answer },
      });
      this.correctSoFar = result.correctCount;
      this.busy = false;
      this.renderFeedback(result);
    } catch (err) {
      this.busy = false;
      // 409 = this puzzle was already answered (e.g. a second tab): move on.
      if (err.status === 409) this.loadQuestion();
      else this.showError(err.message, () => { this.answerable = true; this.submit(answer); });
    }
  }

  renderFeedback(result) {
    const heading = result.correct
      ? el('h3', { class: 'feedback correct' }, '✔ Correct!')
      : el('h3', { class: 'feedback wrong' }, result.timedOut ? '⏱ Time ran out' : '✖ Not quite');
    const next = el('button', { class: 'btn primary', type: 'button', onclick: () => (result.completed ? this.claim() : this.loadQuestion()) },
      result.completed ? 'See the result' : `Next puzzle (${result.answered + 1} of ${result.totalQuestions})`);
    this.body.replaceChildren(
      heading,
      result.correct ? null : el('p', {}, `The answer was ${result.correctAnswer}.`),
      next,
    );
    next.focus();
  }

  // ---- Result --------------------------------------------------------------

  async claim() {
    if (this.busy) return;
    this.busy = true;
    this.showLoading('Checking your answers…');
    try {
      this.reward = await this.api(`/api/challenges/${this.arena.arenaId}/claim`, { method: 'POST' });
      this.engine.applyArenaRewards(this.arena.arenaId, this.reward);
      this.busy = false;
      this.renderResults();
    } catch (err) {
      this.busy = false;
      this.showError(err.message, () => this.claim());
    }
  }

  renderResults() {
    const { reward } = this;
    const abilityName = this.rules.ability ? this.rules.ability.name : null;
    let verdict;
    if (reward.ability) verdict = el('p', { class: 'unlock' }, `⚡ ${reward.ability.name} UNLOCKED!`);
    else if (abilityName) verdict = el('p', { class: 'arena-note' }, `${abilityName} stays locked - ${this.kind === 'wave' ? 'you need both puzzles right' : 'the answer was not correct'}. ${this.kind === 'wave' ? 'The next wave starts as normal.' : 'Back to the battle!'}`);
    else verdict = null;

    this.body.replaceChildren(
      el('p', { class: 'arena-score' }, `${reward.correct} / ${reward.total}`),
      verdict,
      el('ul', { class: 'rewards earned' }, describeReward(reward).map((t) => el('li', {}, t))),
      el('button', { class: 'btn primary', type: 'button', onclick: () => this.close() }, this.continueLabel()),
    );
    this.body.querySelector('button').focus();
  }

  continueLabel() {
    if (this.kind === 'bonus') return 'See final results';
    if (this.kind === 'special') return 'Back to the battle';
    return `Start Wave ${this.nextWave}`;
  }

  close() {
    this.stopTimer();
    this.answerable = false;
    this.engine.finishArena();
  }

  // ---- Shared views ----------------------------------------------------------

  showLoading(message) {
    this.answerable = false;
    this.body.replaceChildren(el('div', { class: 'arena-loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), message));
  }

  // Errors offer Retry, and always a way out so the game is never stuck.
  showError(message, retry) {
    this.stopTimer();
    this.answerable = false;
    const leave = this.kind === 'bonus' ? 'Continue without bonus' : this.kind === 'special' ? 'Back to the battle' : 'Continue without ability';
    this.body.replaceChildren(
      el('p', { class: 'feedback wrong' }, message),
      el('div', { class: 'arena-actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Retry'),
        el('button', { class: 'btn', type: 'button', onclick: () => this.close() }, leave)),
    );
  }
}
