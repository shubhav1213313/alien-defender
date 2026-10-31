import { Player } from '../../public/js/game/Player.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../public/js/game/constants.js';

// Minimal stand-in for InputHandler: a set of held actions.
const held = (...actions) => ({ isDown: (a) => actions.includes(a) });

describe('Player movement', () => {
  test('moves right at its speed using delta time', () => {
    const p = new Player(400, 500);
    p.update(0.5, held('right'));
    expect(p.x).toBeCloseTo(400 + p.speed * 0.5);
    expect(p.y).toBe(500);
  });

  test('movement is frame-rate independent', () => {
    const a = new Player(400, 500);
    const b = new Player(400, 500);
    for (let i = 0; i < 60; i += 1) a.update(1 / 60, held('left'));
    for (let i = 0; i < 30; i += 1) b.update(1 / 30, held('left'));
    expect(a.x).toBeCloseTo(b.x, 5);
  });

  test('diagonal movement is normalised', () => {
    const p = new Player(400, 500);
    p.update(0.1, held('right', 'up'));
    const distance = Math.hypot(p.x - 400, p.y - 500);
    expect(distance).toBeCloseTo(p.speed * 0.1);
  });

  test('cannot leave the left or right edge', () => {
    const p = new Player(30, 500);
    p.update(5, held('left'));
    expect(p.x).toBe(p.width / 2);
    p.update(10, held('right'));
    expect(p.x).toBe(WORLD_WIDTH - p.width / 2);
  });

  test('is confined to the lower part of the screen', () => {
    const p = new Player(400, 500);
    p.update(10, held('up'));
    expect(p.y).toBe(WORLD_HEIGHT * 0.4);
    p.update(10, held('down'));
    expect(p.y).toBe(WORLD_HEIGHT - p.height / 2);
  });

  test('does not move without input', () => {
    const p = new Player(400, 500);
    p.update(1, held());
    expect([p.x, p.y]).toEqual([400, 500]);
  });
});
