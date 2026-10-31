const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');

describe('Express application foundation', () => {
  const { app } = createTestApp();

  test('GET /api/health returns ok JSON', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toMatchObject({ success: true, status: 'ok' });
  });

  test('unknown API routes return structured 404 JSON', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Not found' });
  });

  test('serves the game page with a canvas', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<canvas id="game-canvas"');
  });

  test('serves game ES modules as JavaScript', async () => {
    const res = await request(app).get('/js/game/Player.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  test.each(['/src/app.js', '/../src/app.js', '/.env', '/package.json', '/database/schema.sql'])(
    'does not expose server-side file %s',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
    }
  );

  test('sends Helmet security headers and hides X-Powered-By', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
