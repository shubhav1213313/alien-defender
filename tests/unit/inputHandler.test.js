import { InputHandler } from '../../public/js/game/InputHandler.js';

// Node provides EventTarget/Event, so we can dispatch fake keyboard events
// exactly as the browser would.
function key(type, code, extra = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, ...extra });
  return event;
}

describe('InputHandler (keyboard events -> game actions)', () => {
  let target;
  let input;

  beforeEach(() => {
    target = new EventTarget();
    input = new InputHandler(target);
  });

  afterEach(() => input.destroy());

  test('maps both WASD and arrow keys to the same action', () => {
    target.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.isDown('left')).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyA'));
    target.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(input.isDown('left')).toBe(true);
  });

  test('keyup releases the action', () => {
    target.dispatchEvent(key('keydown', 'Space'));
    target.dispatchEvent(key('keyup', 'Space'));
    expect(input.isDown('fire')).toBe(false);
  });

  test('one-shot listeners fire once per press, ignoring auto-repeat', () => {
    const onPause = jest.fn();
    input.on('pause', onPause);
    target.dispatchEvent(key('keydown', 'KeyP'));
    target.dispatchEvent(key('keydown', 'KeyP', { repeat: true }));
    target.dispatchEvent(key('keyup', 'KeyP'));
    target.dispatchEvent(key('keydown', 'Escape'));
    expect(onPause).toHaveBeenCalledTimes(2);
  });

  test('prevents default scrolling for bound keys', () => {
    const event = key('keydown', 'ArrowDown');
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('ignores keys typed into form inputs', () => {
    // Event.target is read-only on real Events, so call the handler directly
    // with an event-shaped object whose target is a text input.
    input.onKeyDown({ code: 'KeyW', target: { tagName: 'INPUT' } });
    expect(input.isDown('up')).toBe(false);
  });

  test('window blur releases all held keys', () => {
    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('right')).toBe(false);
  });

  test('virtual (touch) buttons use the same action system', () => {
    const onFire = jest.fn();
    input.on('fire', onFire);
    input.setVirtual('fire', true);
    expect(input.isDown('fire')).toBe(true);
    input.setVirtual('fire', false);
    expect(input.isDown('fire')).toBe(false);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
