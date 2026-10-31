import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';

// Draws the curved Earth horizon along the bottom of the battlefield, with
// its atmosphere glow and the energy-shield arc whose brightness shows the
// Earth shield. Purely visual: game logic still treats "past the bottom of
// the screen" as reaching Earth.
//
// Earth is a huge circle whose top edge rises just above the bottom of the
// screen, so only a gentle curve of it is visible.
export const EARTH = Object.freeze({
  radius: 2400,
  // Top of the curve (centre of the screen). The curve drops ~48 px towards
  // the sides, so this keeps Earth visible across the full width.
  horizonY: WORLD_HEIGHT - 56,
});

const CENTRE_X = WORLD_WIDTH / 2;
const CENTRE_Y = EARTH.horizonY + EARTH.radius;

// Small deterministic random generator so the continents look the same
// every frame (and in every test run).
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class EarthRenderer {
  constructor(seed = 20261031) {
    const rand = seeded(seed);
    // Continents and cloud bands sit on the visible part of the curve.
    this.continents = Array.from({ length: 14 }, () => ({
      x: rand() * WORLD_WIDTH,
      y: EARTH.horizonY + 14 + rand() * 26,
      rx: 30 + rand() * 70,
      ry: 5 + rand() * 7,
    }));
    this.clouds = Array.from({ length: 8 }, () => ({
      x: rand() * WORLD_WIDTH,
      y: EARTH.horizonY + 8 + rand() * 16,
      rx: 40 + rand() * 90,
      speed: 4 + rand() * 6,
    }));
  }

  // Height of the Earth's surface at a given x (for the curve).
  static surfaceY(x) {
    const dx = x - CENTRE_X;
    return CENTRE_Y - Math.sqrt(EARTH.radius * EARTH.radius - dx * dx);
  }

  update(dt) {
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x - c.rx > WORLD_WIDTH) c.x = -c.rx;
    }
  }

  // shieldRatio 0..1; hitFlash > 0 makes the shield flicker after a breach.
  draw(ctx, { shieldRatio = 1, hitFlash = 0, time = 0 } = {}) {
    ctx.save();

    // Atmosphere glow above the horizon.
    const air = ctx.createLinearGradient(0, EARTH.horizonY - 60, 0, EARTH.horizonY + 10);
    air.addColorStop(0, 'rgba(47, 168, 255, 0)');
    air.addColorStop(1, 'rgba(47, 168, 255, 0.28)');
    ctx.fillStyle = air;
    ctx.fillRect(0, EARTH.horizonY - 60, WORLD_WIDTH, 70);

    // The planet: deep ocean blue fading to a bright rim.
    const ocean = ctx.createRadialGradient(CENTRE_X, CENTRE_Y, EARTH.radius - 120, CENTRE_X, CENTRE_Y, EARTH.radius);
    ocean.addColorStop(0, '#04122e');
    ocean.addColorStop(0.7, '#0b3d7a');
    ocean.addColorStop(1, '#2fa8ff');
    ctx.fillStyle = ocean;
    ctx.beginPath();
    ctx.arc(CENTRE_X, CENTRE_Y, EARTH.radius, 0, Math.PI * 2);
    ctx.fill();

    // Continents and drifting clouds, clipped to the planet.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTRE_X, CENTRE_Y, EARTH.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(40, 170, 110, 0.38)';
    for (const c of this.continents) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    for (const c of this.clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Energy shield arc: cyan when healthy, red and flickering when low or hit.
    if (shieldRatio > 0) {
      const flicker = hitFlash > 0 ? 0.45 + 0.55 * Math.abs(Math.sin(time * 60)) : 1;
      const color = shieldRatio > 0.35 ? `rgba(0, 220, 255, ${0.25 + shieldRatio * 0.5})` : `rgba(255, 70, 90, ${0.35 + shieldRatio})`;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flicker;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3 + shieldRatio * 3;
      ctx.beginPath();
      ctx.arc(CENTRE_X, CENTRE_Y, EARTH.radius + 16, Math.PI * 1.3, Math.PI * 1.7);
      ctx.stroke();
    }
    ctx.restore();
  }
}
