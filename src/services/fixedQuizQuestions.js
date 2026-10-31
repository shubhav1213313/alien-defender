const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// FIXED puzzles for the compulsory quizzes after waves 1-3: six GENUINE
// Marc Conrad Banana API puzzles (two per wave), saved once from the live
// API by scripts/cacheFixedPuzzles.js. The same images, in the same order,
// are used in every game. They are labelled "cached" in the game - they
// are NOT fetched live each time. Wave 4 (and the bonus / special puzzles)
// still use the live API.
//
// The images and the API's solutions live in data/banana-fixed/, outside
// public/, so the browser only ever receives an image, never an answer.
const DIR = path.join(__dirname, '..', '..', 'data', 'banana-fixed');
const FIXED_SOURCE = 'banana-cached';

// Loads the manifest and images once, checking every image against the
// SHA-256 recorded when it was fetched, so a changed file is caught.
function loadFixedPuzzles(dir = DIR) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const byWave = {};
  for (const p of manifest.puzzles) {
    const png = fs.readFileSync(path.join(dir, p.file));
    const hash = crypto.createHash('sha256').update(png).digest('hex');
    if (hash !== p.sha256) throw new Error(`Fixed puzzle ${p.file} does not match its recorded SHA-256`);
    (byWave[p.wave] = byWave[p.wave] || [])[p.question - 1] = Object.freeze({
      id: p.id, file: p.file, solution: p.solution, image: `data:image/png;base64,${png.toString('base64')}`,
    });
  }
  return Object.freeze(byWave);
}

let cache = null;
const fixedPuzzles = () => {
  if (!cache) cache = loadFixedPuzzles();
  return cache;
};

// The fixed puzzles for a challenge, or null when it uses the live API.
function fixedQuestionsFor(kind, wave) {
  if (kind !== 'wave' || ![1, 2, 3].includes(wave)) return null;
  return fixedPuzzles()[wave];
}

module.exports = { FIXED_SOURCE, fixedQuestionsFor, loadFixedPuzzles };
