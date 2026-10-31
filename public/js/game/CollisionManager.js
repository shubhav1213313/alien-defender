// Collision detection. Entities use centre-based coordinates:
//   circles: { x, y, radius }      rectangles: { x, y, width, height }
// The manager does not apply damage itself - it emits collision events and
// lets the engine (and anything else listening) decide what happens.

export function circlesOverlap(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy <= r * r;
}

export function rectsOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

// Finds the point on the rectangle closest to the circle centre and checks
// whether it lies within the radius.
export function circleRectOverlap(circle, rect) {
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const closestX = Math.max(rect.x - halfW, Math.min(circle.x, rect.x + halfW));
  const closestY = Math.max(rect.y - halfH, Math.min(circle.y, rect.y + halfH));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

// Player hitbox is shrunk slightly so near-misses feel fair.
function playerHitbox(player) {
  return { x: player.x, y: player.y, width: player.width * 0.7, height: player.height * 0.7 };
}

export class CollisionManager {
  constructor(bus) {
    this.bus = bus;
  }

  // Player bullets vs enemies. Each bullet can hit at most one enemy.
  checkPlayerProjectiles(projectiles, enemies) {
    for (const p of projectiles) {
      if (!p.active || p.owner !== 'player') continue;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (circleRectOverlap(p, enemy)) {
          p.active = false;
          this.bus.emit('collision:enemyHit', { projectile: p, enemy });
          break;
        }
      }
    }
  }

  // Enemy bullets vs the player.
  checkEnemyProjectiles(projectiles, player) {
    const box = playerHitbox(player);
    for (const p of projectiles) {
      if (!p.active || p.owner !== 'enemy') continue;
      if (circleRectOverlap(p, box)) {
        p.active = false;
        this.bus.emit('collision:playerHit', { source: p, damage: p.damage });
      }
    }
  }

  // Enemies ramming the player.
  checkEnemyContact(enemies, player) {
    const box = playerHitbox(player);
    for (const enemy of enemies) {
      if (enemy.alive && rectsOverlap(enemy, box)) {
        this.bus.emit('collision:playerRammed', { enemy, damage: enemy.contactDamage || 20 });
      }
    }
  }
}
