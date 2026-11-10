import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildApplicant, watchApplicant } from './build.mjs';
const portals = { applicant: 3000, employer: 3001, admin: 3002, trainer: 3003 };
const portal = process.argv[2] || 'applicant';
if (!Object.hasOwn(portals, portal)) throw new Error('Choose applicant, employer, admin, or trainer');
const root = new URL('./', import.meta.url);
let builder;
if (portal === 'applicant') {
  if (process.env.NODE_ENV === 'production') await buildApplicant();
  else builder = await watchApplicant();
}
const paths = [
  'styles/globals.css', 'components/html.js', 'hooks/navigation.js',
  ...(portal === 'applicant' ? [
    'dist/app.js', 'dist/app.css', 'styles/auth.css',
  ] : []),
];
const files = Object.fromEntries(paths.map(path => [
  `/${path}`, [new URL(path, root), path.endsWith('.css') ? 'text/css' : 'text/javascript'],
]));
files['/'] = [new URL(`app/${portal}/index.html`, root), 'text/html'];
const authPaths = new Set(['/login', '/signup', '/register', '/forgot-password', '/reset-password', '/verify-email']);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (portal === 'applicant' && authPaths.has(pathname)) {
    res.writeHead(302, { Location: `/#${pathname}` });
    return res.end();
  }
  const entry = files[pathname];
  if (!entry) { res.writeHead(404); return res.end('Not found'); }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  try {
    const body = await readFile(entry[0]);
    res.setHeader('Content-Type', `${entry[1]}; charset=utf-8`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Unable to load page'); }
});
const port = Number(process.env.PORT || portals[portal]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`VML NEXUS ${portal}: http://localhost:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
async function stop() {
  await builder?.dispose();
  server.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
