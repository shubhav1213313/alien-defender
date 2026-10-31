// Fixed "world" size. The canvas is scaled with CSS, so game logic always
// works in these logical units regardless of the browser window size.
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 640;

// Clamp a value into [min, max].
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
