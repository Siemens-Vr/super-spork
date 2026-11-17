import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

test('admin portal builds and serves its own assets and safe sign-in return paths', async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.execPath, ['server.mjs', 'admin'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = ''; server.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Admin server startup timed out')), 15000);
      server.stdout.on('data', chunk => { if (chunk.toString().includes('VML NEXUS admin:')) { clearTimeout(timer); resolve(); } });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Admin server exited ${code}: ${stderr}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const entry = await fetch(base);
    assert.equal(entry.status, 200); assert.ok((await entry.text()).includes('/dist/admin/app.js'));
    for (const path of ['/dashboard', '/assessment-reviews', '/assessment-review?id=session-1', '/availability', '/bookings', '/booking?id=booking-1', '/documents?status=UNDER_REVIEW', '/document?id=doc-1', '/applicants?page=2', '/applicant?id=user-1', '/settings', '/login', '/dist/admin/app.js', '/dist/admin/app.css', '/styles/globals.css', '/styles/auth.css']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    for (const path of ['/dist/app.js', '/context/auth.js', '/app/admin/admin.test.js', '/register/google', '/package.json']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const login = await fetch(base + '/login?code=private-code&returnTo=https://untrusted.test', { redirect: 'manual' });
    assert.equal(login.status, 302); assert.equal(login.headers.get('location'), '/login');
    assert.equal(login.headers.get('cache-control'), 'no-store');
    for (const path of ['/login', '/applicants', '/documents', '/document?id=example', '/identity']) {
      const page = await fetch(base + path);
      assert.equal(page.status, 200, path); assert.ok((await page.text()).includes('/dist/admin/app.js'));
    }
    const method = await fetch(base, { method: 'POST' }); assert.equal(method.status, 405);
  } finally {
    if (server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  }
});
