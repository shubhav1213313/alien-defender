import { GameStateManager, GameState } from '../../public/js/game/GameStateManager.js';
import { EventBus } from '../../public/js/game/EventBus.js';

describe('EventBus (observer pattern)', () => {
  test('delivers payloads to every subscriber', () => {
    const bus = new EventBus();
    const a = jest.fn();
    const b = jest.fn();
    bus.on('enemy:destroyed', a);
    bus.on('enemy:destroyed', b);
    bus.emit('enemy:destroyed', { points: 100 });
    expect(a).toHaveBeenCalledWith({ points: 100 });
    expect(b).toHaveBeenCalledWith({ points: 100 });
  });

  test('unsubscribe function and once() stop further deliveries', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const onceHandler = jest.fn();
    const off = bus.on('x', handler);
    bus.once('x', onceHandler);
    bus.emit('x');
    off();
    bus.emit('x');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onceHandler).toHaveBeenCalledTimes(1);
  });

  test('emitting an event nobody listens to is harmless', () => {
    expect(() => new EventBus().emit('nothing')).not.toThrow();
  });
});

describe('GameStateManager (state pattern)', () => {
  test('starts in the menu', () => {
    expect(new GameStateManager().state).toBe(GameState.MENU);
  });

  test('allows valid transitions and emits state:change', () => {
    const bus = new EventBus();
    const changes = [];
    bus.on('state:change', (c) => changes.push(c));
    const sm = new GameStateManager(bus);
    sm.transition(GameState.PLAYING);
    sm.transition(GameState.PAUSED);
    sm.transition(GameState.PLAYING);
    expect(changes).toEqual([
      { from: 'menu', to: 'playing' },
      { from: 'playing', to: 'paused' },
      { from: 'paused', to: 'playing' },
    ]);
  });

  test.each([
    [GameState.MENU, GameState.VICTORY],
    [GameState.MENU, GameState.PAUSED],
    [GameState.PAUSED, GameState.GAME_OVER],
  ])('rejects invalid transition %s -> %s', (from, to) => {
    const sm = new GameStateManager();
    sm.state = from;
    expect(() => sm.transition(to)).toThrow(/Invalid game state transition/);
    expect(sm.tryTransition(to)).toBe(false);
    expect(sm.state).toBe(from);
  });

  test('simulation only runs while playing or between waves', () => {
    const sm = new GameStateManager();
    expect(sm.isSimulating).toBe(false);
    sm.transition(GameState.PLAYING);
    expect(sm.isSimulating).toBe(true);
    sm.transition(GameState.PAUSED);
    expect(sm.isSimulating).toBe(false);
  });
});
