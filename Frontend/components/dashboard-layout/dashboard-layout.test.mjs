import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('shared layout renders each role with only its configured links and escapes labels', async () => {
  const result = await build({
    stdin: {
      contents: `export { dashboardLayout } from './components/dashboard-layout/dashboard-layout';`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    },
    bundle: true, write: false, outdir: 'dist', format: 'esm', platform: 'node',
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const { dashboardLayout } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  for (const role of ['applicant', 'admin', 'trainer', 'employer']) {
    const html = dashboardLayout({
      role, route: `${role}-only`, links: [[`${role}-only`, '<Private label>', 'grid']],
      name: '<User>', body: '<p>Page content</p>', showSignOut: false,
    });
    assert.ok(html.includes(`${role.toUpperCase()} WORKSPACE`));
    assert.ok(html.includes(`href="#/${role}-only"`));
    assert.ok(html.includes('aria-current="page"'));
    assert.ok(html.includes('&lt;Private label&gt;'));
    assert.ok(html.includes('&lt;User&gt;'));
    assert.ok(html.includes('<p>Page content</p>'));
    assert.ok(!html.includes('data-auth-action="logout"'));
    for (const other of ['applicant', 'admin', 'trainer', 'employer'].filter(value => value !== role)) {
      assert.ok(!html.includes(`href="#/${other}-only"`));
    }
  }
});
