// Regression test for the "registration fails" bug of 2026-10-31.
// Root cause: an older copy of the game (another folder) was still running on
// port 3000, so `npm start` here could not listen and the browser was talking
// to the OLD server. Start-up must now fail loudly and explain why.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');

jest.setTimeout(30000);

function runServer(port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('start-up stops with a clear message when the port is taken by another server', async () => {
  // Pretend to be the old game: answers /api/health WITHOUT an app name.
  const impostor = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
  });
  await new Promise((r) => impostor.listen(0, r));
  const { port } = impostor.address();
  try {
    const { code, output } = await runServer(port);
    expect(code).toBe(1);
    expect(output).toContain(`port ${port} is already in use`);
    expect(output).toContain('probably an older copy of the game');
    expect(output).toContain('did NOT start');
    expect(output).not.toContain('running at http://localhost');
  } finally {
    impostor.close();
  }
});

test('/api/health identifies this application by name', async () => {
  const res = await request(createTestApp().app).get('/api/health');
  expect(res.body).toMatchObject({ app: 'alienn-defender', version: expect.any(String) });
});
