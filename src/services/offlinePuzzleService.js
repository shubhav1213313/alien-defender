// Offline fallback puzzles used only when the Banana API is unavailable.
// They imitate the Banana idea (find the value of a fruit from a picture
// of equations) and are clearly labelled OFFLINE in the image itself.
function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Two equations reveal the banana's value: cherry + cherry = 2c, banana + cherry = b + c.
function generateOfflinePuzzle(rng = Math.random) {
  const banana = randomInt(rng, 0, 9);
  const cherry = randomInt(rng, 1, 9);
  const lines = [
    `🍒 + 🍒 = ${cherry * 2}`,
    `🍌 + 🍒 = ${banana + cherry}`,
    '🍌 = ?',
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="360" viewBox="0 0 660 360">
  <rect width="660" height="360" rx="18" fill="#fff8dc"/>
  <rect x="0" y="0" width="660" height="44" rx="18" fill="#ff9f1c"/>
  <text x="330" y="30" font-family="Segoe UI, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#1b1b1b">OFFLINE PUZZLE · Banana API unavailable</text>
  ${lines.map((line, i) => `<text x="330" y="${120 + i * 80}" font-family="Segoe UI Emoji, Segoe UI, sans-serif" font-size="52" text-anchor="middle" fill="#1b1b1b">${escapeXml(line)}</text>`).join('\n  ')}
</svg>`;

  return {
    image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    solution: banana,
    explanation: `🍒 + 🍒 = ${cherry * 2}, so 🍒 = ${cherry}. Then 🍌 = ${banana + cherry} − ${cherry} = ${banana}.`,
    source: 'offline',
    latencyMs: 0,
  };
}

module.exports = { generateOfflinePuzzle };
