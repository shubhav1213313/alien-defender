// One-off tool: saves SIX genuine Marc Conrad Banana API puzzles for the
// compulsory quizzes after waves 1-3 (two per wave), so those quizzes show
// the same puzzles, in the same order, in every game.
//
//   node scripts/cacheFixedPuzzles.js          (refuses to overwrite)
//   node scripts/cacheFixedPuzzles.js --force  (replace the saved set)
//
// Each puzzle is fetched from the live API and saved exactly as received:
// the PNG image goes to data/banana-fixed/, and the API's own `solution` is
// recorded in manifest.json with the fetch time and the image's SHA-256.
// The folder is outside public/, so the answers are never served.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchBananaPuzzle, BANANA_URL } = require('../src/services/bananaService');

const DIR = path.join(__dirname, '..', 'data', 'banana-fixed');
const MANIFEST = path.join(DIR, 'manifest.json');
const SLOTS = [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2]];

async function main() {
  if (fs.existsSync(MANIFEST) && !process.argv.includes('--force')) {
    console.error('data/banana-fixed/manifest.json already exists - the fixed puzzles must not change. Use --force to replace them.');
    process.exit(1);
  }
  fs.mkdirSync(DIR, { recursive: true });
  const seen = new Set();
  const puzzles = [];
  for (const [wave, question] of SLOTS) {
    // Keep fetching until the API gives a puzzle not already in the set.
    for (;;) {
      const puzzle = await fetchBananaPuzzle({ timeoutMs: 8000 });
      const png = Buffer.from(puzzle.image.replace(/^data:image\/png;base64,/, ''), 'base64');
      const hash = crypto.createHash('sha256').update(png).digest('hex');
      if (seen.has(hash)) continue;
      seen.add(hash);
      const file = `wave${wave}-q${question}.png`;
      fs.writeFileSync(path.join(DIR, file), png);
      puzzles.push({ id: `W${wave}-Q${question}`, wave, question, file, solution: puzzle.solution, sha256: hash, fetchedAt: new Date().toISOString() });
      console.log(`W${wave}-Q${question}: ${file} solution ${puzzle.solution} (${png.length} bytes, ${puzzle.latencyMs} ms)`);
      break;
    }
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify({ source: BANANA_URL, puzzles }, null, 2)}\n`);
  console.log(`Saved ${puzzles.length} puzzles to data/banana-fixed/`);
}

main().catch((err) => {
  console.error('Could not cache puzzles:', err.message);
  process.exit(1);
});
