import { apiRequest } from '../api/apiClient.js';
import { ABILITIES } from '../game/AbilityDefinitions.js';

// Knowledge Challenge Arena UI.
// Flow: intro (choose difficulty) -> 4 x (puzzle -> feedback) -> results.
// The server holds the answers and calculates rewards; this class only
// displays them and hands the rewards to the engine. If the server cannot be
// reached the player is offered "continue without rewards", so the arena can
// never trap the game.

const TIER_LABEL = { standard: 'Standard', enhanced: 'Enhanced', elite: 'ELITE' };
const ACHIEVEMENT_NAMES = { legendary_defender: 'Legendary Defender' };

// Tiny DOM helper: el('p', { class: 'x' }, 'text', childNode)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function abilityLabel(ability) {
  const def = ABILITIES[ability.id];
  return `${def.name} (${TIER_LABEL[ability.tier]}) - key ${def.slot}`;
}

// Human-readable list of what a reward object grants.
export function describeReward(reward) {
  const items = [];
  if (reward.energy) items.push(`+${reward.energy} Knowledge Energy`);
  if (reward.repair) items.push(`+${reward.repair} hull repair`);
  if (reward.ability) items.push(`Unlock ${abilityLabel(reward.ability)}`);
  if (reward.scoreBonus) items.push(`+${reward.scoreBonus.toLocaleString()} bonus points`);
  for (const id of reward.achievements || []) items.push(`Achievement: ${ACHIEVEMENT_NAMES[id] || id}`);
  return items.length ? items : ['No reward'];
}

export class KnowledgeArena {
  constructor({ engine, root, api = apiRequest }) {
    this.engine = engine;
    this.root = root;
    this.api = api;
    this.title = root.querySelector('[data-arena="title"]');
    this.subtitle = root.querySelector('[data-arena="subtitle"]');
    this.body = root.querySelector('[data-arena="body"]');
    this.timer = null;
    engine.bus.on('arena:open', (info) => this.open(info));
  }

  // ---- Intro: difficulty choice ---------------------------------------------

  async open({ wave, postBoss, nextWave }) {
    this.wave = wave;
    this.postBoss = postBoss;
    this.nextWave = nextWave;
    this.arena = null;
    this.reward = null;
    this.busy = false;
    this.correctSoFar = 0;
    this.title.textContent = postBoss ? 'Victory Bonus Challenge' : 'Knowledge Challenge Arena';
    this.subtitle.textContent = postBoss
      ? 'The Mothership is destroyed. Four final puzzles for bonus points.'
      : `Wave ${wave} cleared. Solve four Banana puzzles before Wave ${nextWave}.`;
    this.showLoading('Loading challenge rules…');
    try {
      this.rules = await this.api(`/api/challenges/rules?wave=${wave}`);
      this.renderIntro();
    } catch (err) {
      this.showError(err.message, () => this.open({ wave, postBoss, nextWave }));
    }
  }

  renderIntro() {
    const { rules } = this;
    const cards = rules.difficulties.map((d, i) => {
      const perfect = d.rewardTable[4];
      return el('label', { class: 'arena-card' },
        el('input', { type: 'radio', name: 'arena-difficulty', value: d.id, checked: i === 1 }),
        el('span', {},
          el('strong', {}, d.label),
          el('small', {}, `${d.timeLimitSeconds}s per puzzle · ${d.hintsAllowed ? '1 hint per puzzle' : 'no hints'}`),
          el('small', { class: 'perfect' }, `4/4: ${describeReward(perfect).join(', ')}`)));
    });

    const tierRows = ['0/4', '1/4', '2/4', '3/4'].map((label, correct) =>
      el('li', {}, el('b', {}, `${label}: `), describeReward(rules.difficulties[1].rewardTable[correct]).join(', ')));

    const abilityInfo = rules.abilities
      ? el('p', { class: 'arena-abilities' },
        `Ability on offer: ${ABILITIES[rules.abilities.standard].name} (3/4 or better). `,
        `Perfect Hard run: ${ABILITIES[rules.abilities.elite].name} - ${ABILITIES[rules.abilities.elite].description}`)
      : el('p', { class: 'arena-abilities' }, 'No more waves: rewards are bonus points. A perfect Hard run earns Legendary Defender.');

    const start = el('button', { class: 'btn primary', type: 'button', onclick: () => {
      const choice = this.body.querySelector('input[name="arena-difficulty"]:checked').value;
      this.start(choice);
    } }, 'Begin Challenge');

    this.body.replaceChildren(
      el('p', { class: 'arena-rules' }, 'Four puzzles. One answer each. Wrong answers show the solution and move on - you always continue to the next stage.'),
      el('fieldset', { class: 'arena-difficulty' }, el('legend', {}, 'Choose puzzle difficulty'), cards),
      abilityInfo,
      el('details', { class: 'arena-tiers' }, el('summary', {}, 'Reward tiers'), el('ul', {}, tierRows)),
      el('p', { class: 'arena-note' }, rules.note),
      start,
    );
    start.focus();
  }

  async start(difficulty) {
    if (this.busy) return;
    this.busy = true;
    this.difficulty = this.rules.difficulties.find((d) => d.id === difficulty);
    this.showLoading('Opening the arena…');
    try {
      this.arena = await this.api('/api/challenges', { method: 'POST', body: { wave: this.wave, difficulty } });
      this.busy = false;
      await this.loadQuestion();
    } catch (err) {
      this.busy = false;
      this.showError(err.message, () => this.start(difficulty));
    }
  }

  // ---- Questions -----------------------------------------------------------

  async loadQuestion() {
    this.showLoading('Fetching puzzle from the Banana API…');
    try {
      this.question = await this.api(`/api/challenges/${this.arena.arenaId}/question`);
      this.renderQuestion();
    } catch (err) {
      this.showError(err.message, () => this.loadQuestion());
    }
  }

  renderQuestion() {
    const q = this.question;
    const live = q.source === 'banana';
    const badge = live
      ? el('span', { class: 'badge live' }, `Live Banana API · ${q.latencyMs} ms`)
      : el('span', { class: 'badge offline' }, `OFFLINE PUZZLE · Banana API unavailable (${q.fallbackReason})`);

    const input = el('input', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '3', autocomplete: 'off',
      'aria-label': 'Your answer', placeholder: '?', class: 'arena-answer', required: true,
    });
    const submit = el('button', { class: 'btn primary', type: 'submit' }, 'Submit');
    const hintText = el('p', { class: 'arena-hint', 'aria-live': 'polite' });
    const hintButton = q.hintAvailable
      ? el('button', { class: 'btn', type: 'button', onclick: () => this.useHint(hintButton, hintText) }, 'Use hint')
      : null;

    const form = el('form', { class: 'arena-form', onsubmit: (e) => {
      e.preventDefault();
      if (/^\d{1,3}$/.test(input.value.trim())) this.submit(input.value.trim());
    } }, input, submit, hintButton);

    this.timerBar = el('div', { class: 'arena-timer-fill' });
    this.timerText = el('span', { class: 'arena-timer-text' });

    this.body.replaceChildren(
      el('div', { class: 'arena-progress' },
        el('strong', {}, `QUESTION ${q.questionNumber}/${q.totalQuestions}`),
        el('span', {}, `${this.difficulty.label} · ${this.correctSoFar} correct`),
        badge),
      el('div', { class: 'arena-timer' }, this.timerBar, this.timerText),
      el('img', { class: 'arena-puzzle', src: q.image, alt: 'Banana mathematics puzzle: find the value hidden behind the banana' }),
      form,
      hintText,
    );
    input.focus();
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

  // One submission per question: `busy` blocks double clicks / Enter spam,
  // and the server rejects duplicates as well.
  async submit(answer) {
    if (this.busy) return;
    this.busy = true;
    this.stopTimer();
    this.body.querySelectorAll('button, input').forEach((n) => { n.disabled = true; });
    try {
      const result = await this.api(`/api/challenges/${this.arena.arenaId}/answer`, {
        method: 'POST', body: { questionIndex: this.question.questionIndex, answer },
      });
      this.correctSoFar = result.correctCount;
      this.busy = false;
      this.renderFeedback(result);
    } catch (err) {
      this.busy = false;
      // 409 = already answered (e.g. a second tab): just move on.
      if (err.status === 409) this.loadQuestion();
      else this.showError(err.message, () => this.submit(answer));
    }
  }

  renderFeedback(result) {
    const heading = result.correct
      ? el('h3', { class: 'feedback correct' }, '✔ Correct!')
      : el('h3', { class: 'feedback wrong' }, result.timedOut ? '⏱ Time ran out' : '✖ Incorrect');
    const next = el('button', { class: 'btn primary', type: 'button', onclick: () => (result.completed ? this.claim() : this.loadQuestion()) },
      result.completed ? 'See results' : `Next question (${result.answered + 1}/4)`);

    this.body.replaceChildren(
      el('div', { class: 'arena-progress' }, el('strong', {}, `QUESTION ${result.answered}/4`), el('span', {}, `${result.correctCount} correct so far`)),
      heading,
      result.correct ? null : el('p', {}, `The correct answer was ${result.correctAnswer}.`),
      result.explanation ? el('p', { class: 'arena-note' }, result.explanation) : null,
      next,
    );
    next.focus();
  }

  // ---- Results -------------------------------------------------------------

  async claim() {
    if (this.busy) return;
    this.busy = true;
    this.showLoading('Calculating rewards…');
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
    const table = this.difficulty.rewardTable;
    const missed = table.slice(reward.correct + 1).map((tier) =>
      el('li', {}, el('b', {}, `${tier.correct}/4: `), describeReward(tier).join(', ')));

    const continueLabel = this.postBoss ? 'See final results' : `Continue to Wave ${this.nextWave}`;
    const button = el('button', { class: 'btn primary', type: 'button', onclick: () => this.close() }, continueLabel);

    this.body.replaceChildren(
      el('p', { class: 'arena-score' }, `${reward.correct} / ${reward.total}`),
      el('p', { class: 'arena-note' }, reward.correct === 0
        ? 'No reward this time - but you continue to the next stage as normal.'
        : `${this.difficulty.label} challenge complete.`),
      el('h3', {}, 'Earned'),
      el('ul', { class: 'rewards earned' }, describeReward(reward).map((t) => el('li', {}, t))),
      missed.length ? el('h3', {}, 'Missed') : null,
      missed.length ? el('ul', { class: 'rewards missed' }, missed) : null,
      button,
    );
    button.focus();
  }

  close() {
    this.stopTimer();
    this.engine.finishArena();
  }

  // ---- Shared views ----------------------------------------------------------

  showLoading(message) {
    this.body.replaceChildren(el('div', { class: 'arena-loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), message));
  }

  // Errors offer a retry, and always a way out so the game is never stuck.
  showError(message, retry) {
    this.stopTimer();
    this.body.replaceChildren(
      el('p', { class: 'feedback wrong' }, `Problem: ${message}`),
      el('div', { class: 'arena-actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Try again'),
        el('button', { class: 'btn', type: 'button', onclick: () => this.close() }, 'Continue without rewards')),
    );
  }
}
