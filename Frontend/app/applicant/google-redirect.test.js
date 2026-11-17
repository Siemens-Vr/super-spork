import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

test('Google browser returns reach the applicant app and preserve only safe outcomes', async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.execPath, ['server.mjs', 'applicant'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Frontend startup timed out')), 15000);
      server.stdout.on('data', chunk => {
        if (chunk.toString().includes('VML NEXUS applicant:')) { clearTimeout(timeout); resolve(); }
      });
      server.once('error', error => { clearTimeout(timeout); reject(error); });
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Frontend exited ${code}: ${stderr}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const cases = [
      ['/auth/google/callback?status=authenticated', '/auth/google/callback?status=authenticated'],
      ['/auth/google/callback?status=linked', '/auth/google/callback?status=linked'],
      ['/register/google?status=registrationRequired', '/register/google?status=registrationRequired'],
      ['/login?error=ACCOUNT_LINK_REQUIRED', '/login?error=ACCOUNT_LINK_REQUIRED'],
      ['/login?error=GOOGLE_FLOW_INVALID&code=private-code&returnTo=https://untrusted.test', '/login?error=GOOGLE_FLOW_INVALID'],
      ['/login?error=%3Cscript%3E', '/login'],
    ];
    for (const [path, destination] of cases) {
      const response = await fetch(base + path, { redirect: 'manual' });
      assert.equal(response.status, path === destination ? 200 : 302, path);
      if (path !== destination) assert.equal(response.headers.get('location'), destination, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const shell = await fetch(base + destination);
      assert.equal(shell.status, 200);
      assert.ok((await shell.text()).includes('/dist/app.js'));
    }
    for (const path of ['/booking', '/documents', '/document?id=doc-1', '/upload?replace=doc-1', '/career?id=career-1', '/target?career=career-1', '/dist/app.js', '/dist/app.css', '/styles/auth.css']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    assert.equal((await fetch(base + '/dist/missing.js')).status, 404);
    assert.equal((await fetch(base + '/api/v1/not-a-frontend-page')).status, 404);
    assert.equal((await fetch(base + '/register/google', { method: 'POST', redirect: 'manual' })).status, 405);
    const head = await fetch(base + '/auth/google/callback?status=authenticated', { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, 'exit');
      server.kill('SIGTERM');
      await stopped;
    }
  }
});
