// The six fixed puzzles for waves 1-3: genuine Banana API puzzles saved in
// data/banana-fixed/ (see scripts/cacheFixedPuzzles.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { loadFixedPuzzles, fixedQuestionsFor } = require('../../src/services/fixedQuizQuestions');
const { BANANA_URL } = require('../../src/services/bananaService');
const { createTestApp } = require('../helpers/testApp');

const DIR = path.join(__dirname, '../../data/banana-fixed');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

describe('Fixed Banana puzzles', () => {
  test('six puzzles, two per wave 1-3, recorded as coming from the Banana API', () => {
    expect(manifest.source).toBe(BANANA_URL);
    expect(manifest.puzzles.map((p) => p.id)).toEqual(['W1-Q1', 'W1-Q2', 'W2-Q1', 'W2-Q2', 'W3-Q1', 'W3-Q2']);
    for (const p of manifest.puzzles) {
      expect(Number.isInteger(p.solution) && p.solution >= 0 && p.solution <= 9).toBe(true);
      expect(new Date(p.fetchedAt).toString()).not.toBe('Invalid Date');
    }
  });

  test('every image is a distinct PNG matching its recorded SHA-256', () => {
    const puzzles = loadFixedPuzzles();
    const images = [1, 2, 3].flatMap((w) => puzzles[w].map((p) => p.image));
    expect(images).toHaveLength(6);
    expect(new Set(images).size).toBe(6);
    for (const image of images) expect(image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });

  test('a modified image is detected instead of being shown with the wrong answer', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-fixed-'));
    for (const f of fs.readdirSync(DIR)) fs.copyFileSync(path.join(DIR, f), path.join(tmp, f));
    fs.appendFileSync(path.join(tmp, 'wave2-q1.png'), 'x');
    expect(() => loadFixedPuzzles(tmp)).toThrow('wave2-q1.png does not match');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('only waves 1-3 of the compulsory quiz are fixed; wave 4, bonus and special stay live', () => {
    expect(fixedQuestionsFor('wave', 1)).toHaveLength(2);
    expect(fixedQuestionsFor('wave', 3)).toHaveLength(2);
    expect(fixedQuestionsFor('wave', 4)).toBeNull();
    expect(fixedQuestionsFor('bonus', 5)).toBeNull();
    expect(fixedQuestionsFor('special', 1)).toBeNull();
  });

  test.each([
    '/data/banana-fixed/manifest.json', '/banana-fixed/manifest.json', '/manifest.json',
    '/data/banana-fixed/wave1-q1.png', '/DEMO_QUIZ_ANSWERS.md',
  ])('%s is never served to the browser', async (url) => {
    expect((await request(createTestApp().app).get(url)).status).toBe(404);
  });
});
