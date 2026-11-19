import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const modules = new Map();

// Use the same TSX and CSS-module handling as the application build, in memory.
export function loadView(url) {
  if (!modules.has(url.href)) modules.set(url.href, compileView(url));
  return modules.get(url.href);
}

async function compileView(url) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: [fileURLToPath(url)],
    bundle: true,
    write: false,
    outdir: 'dist/test-views',
    platform: 'node',
    format: 'esm',
    // Bundled CommonJS dependencies may require Node built-ins at runtime.
    banner: {
      js: `import { createRequire as createTestRequire } from 'node:module'; const require = createTestRequire(${JSON.stringify(url.href)});`,
    },
  });
  const javascript = result.outputFiles.find(file => file.path.endsWith('.js'));
  return import(`data:text/javascript;base64,${Buffer.from(javascript.text).toString('base64')}`);
}
