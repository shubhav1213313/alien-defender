import { EarthRenderer, EARTH } from '../../public/js/game/EarthRenderer.js';
import { GameEngine } from '../../public/js/game/GameEngine.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../public/js/game/constants.js';

// Records canvas calls so drawing can be checked without a browser.
function recordingContext() {
  const calls = [];
  const target = {
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : (...args) => calls.push([prop, ...args])),
    set: (t, prop, value) => { t[prop] = value; calls.push([`set:${String(prop)}`, value]); return true; },
  });
  return { ctx, calls };
}

describe('Earth horizon', () => {
  test('only a gentle curve of Earth is visible at the bottom of the screen', () => {
    expect(EarthRenderer.surfaceY(WORLD_WIDTH / 2)).toBeCloseTo(EARTH.horizonY);
    const edge = EarthRenderer.surfaceY(0);
    expect(edge).toBeGreaterThan(EARTH.horizonY); // curves away at the sides
    expect(edge).toBeLessThan(WORLD_HEIGHT); // but is still on screen
  });

  test('continents are the same every frame and every run (seeded)', () => {
    expect(new EarthRenderer().continents).toEqual(new EarthRenderer().continents);
  });

  test('the shield arc is cyan when healthy, red when low, absent when gone', () => {
    const strokes = (ratio) => {
      const { ctx, calls } = recordingContext();
      new EarthRenderer().draw(ctx, { shieldRatio: ratio });
      return calls.filter((c) => c[0] === 'set:strokeStyle').map((c) => c[1]);
    };
    expect(strokes(1)[0]).toMatch(/^rgba\(0, 220, 255/);
    expect(strokes(0.2)[0]).toMatch(/^rgba\(255, 70, 90/);
    expect(strokes(0)).toEqual([]);
  });

  test('clouds drift and wrap around', () => {
    const earth = new EarthRenderer();
    const before = earth.clouds.map((c) => c.x);
    earth.update(1);
    expect(earth.clouds.map((c) => c.x)).not.toEqual(before);
    earth.update(10000);
    for (const c of earth.clouds) expect(c.x).toBeLessThanOrEqual(WORLD_WIDTH + c.rx);
  });
});

describe('Engine visuals', () => {
  function engineWithRecorder() {
    const { ctx, calls } = recordingContext();
    const input = { isDown: () => false, on: () => {}, releaseAll: () => {} };
    return { engine: new GameEngine({ canvas: { getContext: () => ctx }, input }), calls };
  }

  test('Earth is drawn on the menu too (behind the title)', () => {
    const { engine, calls } = engineWithRecorder();
    engine.render();
    expect(calls.some((c) => c[0] === 'arc' && c[3] === EARTH.radius)).toBe(true);
  });

  test('an alien reaching Earth makes the shield flicker for a moment', () => {
    const { engine } = engineWithRecorder();
    engine.startGame();
    engine.damageEarth(10);
    expect(engine.earthHitFlash).toBeGreaterThan(0);
    engine.update(1);
    expect(engine.earthHitFlash).toBe(0);
  });

  test('a red danger vignette appears only when the hull is low', () => {
    const { engine, calls } = engineWithRecorder();
    engine.startGame();
    const vignettes = () => calls.filter((c) => c[0] === 'fillRect').length;
    engine.render();
    const healthy = vignettes();
    calls.length = 0;
    engine.player.health = 20;
    engine.render();
    expect(vignettes()).toBe(healthy + 1);
  });
});
