// Difficulty strategies. Each mode is a bundle of tuning values that the
// engine, enemy factory, wave manager and score manager read from. Swapping
// the strategy object changes how the whole game plays without any
// if (difficulty === 'hard') checks scattered through the code.
export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    id: 'easy',
    label: 'Easy',
    description: 'Slower aliens, weaker shots, a sturdier Earth shield.',
    enemyModifiers: Object.freeze({ speed: 0.8, health: 0.75, fireRate: 0.65, projectileSpeed: 0.8 }),
    playerDamageTaken: 0.6, // multiplier on damage the player receives
    spawnInterval: 1.3,     // multiplier on time between spawns (higher = fewer at once)
    scoreMultiplier: 0.75,
    earthShield: 150,
  }),
  normal: Object.freeze({
    id: 'normal',
    label: 'Normal',
    description: 'The intended challenge.',
    enemyModifiers: Object.freeze({ speed: 1, health: 1, fireRate: 1, projectileSpeed: 1 }),
    playerDamageTaken: 1,
    spawnInterval: 1,
    scoreMultiplier: 1,
    earthShield: 100,
  }),
  hard: Object.freeze({
    id: 'hard',
    label: 'Hard',
    description: 'Faster, tougher aliens that shoot far more often.',
    enemyModifiers: Object.freeze({ speed: 1.25, health: 1.5, fireRate: 1.5, projectileSpeed: 1.3 }),
    playerDamageTaken: 1.4,
    spawnInterval: 0.75,
    scoreMultiplier: 1.5,
    earthShield: 70,
  }),
});

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal;
}
