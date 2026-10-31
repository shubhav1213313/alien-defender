import { WORLD_WIDTH, WORLD_HEIGHT, clamp } from './constants.js';

// The player's spaceship. update() holds the pure movement logic; draw()
// only renders, so the logic can be unit tested without a canvas.
export class Player {
  constructor(x = WORLD_WIDTH / 2, y = WORLD_HEIGHT - 80) {
    this.width = 44;
    this.height = 48;
    this.x = x;
    this.y = y;
    this.speed = 340; // logical pixels per second
  }

  // dt is in seconds, so movement is identical at 30fps or 144fps.
  update(dt, input) {
    let dx = 0;
    let dy = 0;
    if (input.isDown('left')) dx -= 1;
    if (input.isDown('right')) dx += 1;
    if (input.isDown('up')) dy -= 1;
    if (input.isDown('down')) dy += 1;

    // Normalise diagonals so moving diagonally is not ~41% faster.
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
    this.clampToBounds();
  }

  clampToBounds() {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    // The player is confined to the lower 60% of the screen.
    this.x = clamp(this.x, halfW, WORLD_WIDTH - halfW);
    this.y = clamp(this.y, WORLD_HEIGHT * 0.4, WORLD_HEIGHT - halfH);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // Engine glow
    ctx.fillStyle = 'rgba(57, 243, 196, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 24, 8, 14 + Math.random() * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hull
    ctx.fillStyle = '#d9e7ff';
    ctx.strokeStyle = '#39f3c4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(20, 18);
    ctx.lineTo(6, 12);
    ctx.lineTo(0, 20);
    ctx.lineTo(-6, 12);
    ctx.lineTo(-20, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cockpit
    ctx.fillStyle = '#1b6cff';
    ctx.beginPath();
    ctx.ellipse(0, -4, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
