import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildApplicant, watchApplicant, buildAdmin, watchAdmin } from './build.mjs';
const portals = { applicant: 3000, employer: 3001, admin: 3002, trainer: 3003 };
const portal = process.argv[2] || 'applicant';
if (!Object.hasOwn(portals, portal)) throw new Error('Choose applicant, employer, admin, or trainer');
const root = new URL('./', import.meta.url);
let builder;
{
  if (process.env.NODE_ENV === 'production') await buildApplicant();
  else builder = await watchApplicant();
}
if (portal === 'admin') {
  if (process.env.NODE_ENV === 'production') await buildAdmin();
  else builder = await watchAdmin();
}
let trainerBuilder;
if(portal==='trainer'){const { buildTrainer,watchTrainer }=await import('./build.mjs');if(process.env.NODE_ENV==='production')await buildTrainer();else trainerBuilder=await watchTrainer();}
const paths = [
  'styles/globals.css', 'components/html.js', 'hooks/navigation.js',
  ...(portal === 'applicant' ? [
    'dist/app.js', 'dist/app.css', 'styles/auth.css',
  ] : []),
  ...(portal === 'admin' ? ['dist/admin/app.js', 'dist/admin/app.css', 'styles/auth.css'] : []),
  ...(portal === 'trainer' ? ['dist/trainer/app.js','dist/trainer/app.css'] : []),
];
const files = Object.fromEntries(paths.map(path => [
  `/${path}`, [new URL(path, root), path.endsWith('.css') ? 'text/css' : 'text/javascript'],
]));
files['/'] = [new URL(`app/${portal}/index.html`, root), 'text/html'];
const authPaths = new Set(['/login', '/signup', '/register', '/forgot-password', '/reset-password', '/verify-email', '/register/google', '/auth/google/callback']);
const pagePaths = new Set(portal === 'applicant'
  ? ['/', '/dashboard', '/workspaces', '/onboarding', '/documents', '/document', '/upload', '/careers', '/career', '/target', '/booking', '/preflight', '/assessment', '/results', '/learning', '/settings', '/help', '/privacy', '/mfa', ...authPaths]
  : portal === 'admin' ? ['/', '/dashboard', '/assessment-reviews', '/assessment-review', '/availability', '/bookings', '/booking', '/applicants', '/applicant', '/documents', '/identity', '/document', '/settings', '/login', '/forgot-password', '/reset-password', '/trainers', '/trainer', '/trainer-invitations'] : portal==='trainer'?['/','/dashboard','/profile','/qualifications','/invitations/accept']:['/']);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if ((portal === 'applicant' && authPaths.has(pathname)) || (portal === 'admin' && ['/login', '/forgot-password', '/reset-password'].includes(pathname))) {
    // Keep only OAuth outcomes. Never forward codes, tokens or return URLs.
    const params = new URLSearchParams();
    for (const key of ['status', 'error']) {
      const value = url.searchParams.get(key);
      if (value && /^[a-zA-Z_]{1,80}$/.test(value)) params.set(key, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    const destination = `${pathname}${params.size ? `?${params}` : ''}`;
    if (url.pathname + url.search !== destination) {
      res.writeHead(302, { Location: destination });
      return res.end();
    }
  }
  const entry = files[pathname] || (pagePaths.has(pathname) ? files['/'] : undefined);
  if (!entry) { res.writeHead(404); return res.end('Not found'); }
  try {
    const body = await readFile(entry[0]);
    res.setHeader('Content-Type', entry[1].startsWith('image/') ? entry[1] : `${entry[1]}; charset=utf-8`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (entry[1] === 'text/html') res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Unable to load page'); }
});
const port = Number(process.env.PORT || portals[portal]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`VML NEXUS ${portal}: http://localhost:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
async function stop() {
  await builder?.dispose();
  await trainerBuilder?.dispose();
  server.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
