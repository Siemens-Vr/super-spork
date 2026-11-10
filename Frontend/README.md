# VML NEXUS frontend

## Structure

```text
Frontend/
  app/
    applicant/       # Applicant entry, page folders and authentication tests
      dashboard/    # dashboard.tsx + dashboard.module.css
      profile/      # profile.tsx + profile.module.css
      documents/    # documents.tsx + documents.module.css (list and upload)
      careers/      # careers.tsx + careers.module.css (browse, detail, target)
      assessments/  # assessments.tsx + assessments.module.css (booking, preflight, room)
      results/      # results.tsx + results.module.css
      learning/     # learning.tsx + learning.module.css
      settings/     # settings.tsx + settings.module.css
    employer/        # Future employer portal
    admin/           # Future admin portal
    trainer/         # Future trainer portal
  components/        # Shared rendering primitives and future UI components
  context/           # Authentication/session state and authentication flows
  hooks/             # Shared framework-independent helpers (currently navigation)
  lib/               # API client and public configuration
  styles/            # Global theme and authentication styling
  server.mjs         # Allowlisted static server for each portal
  package.json
  .dockerignore
  .gitignore
  Dockerfile
```

Applicant pages are typed TSX render functions with scoped CSS modules. Esbuild compiles them into `dist/app.js` and `dist/app.css`; the existing HTML rendering and delegated events remain in use without adding React. `context` and `hooks` organize reusable state and helpers. Page markup lives in the page folders, while shared state, layout and event wiring remain in `app/applicant/app.js`. `page-context.ts` defines the typed page dependencies.

## Run locally

From Frontend, use a separate terminal for each portal:

| Command | Address | Status |
| --- | --- | --- |
| npm run dev:applicant | http://localhost:3000 | Applicant portal |
| npm run dev:employer | http://localhost:3001 | Placeholder |
| npm run dev:admin | http://localhost:3002 | Placeholder |
| npm run dev:trainer | http://localhost:3003 | Placeholder |

Run `npm ci` from Frontend first. Each `app/<portal>` folder also supports `npm run dev` independently. `npm run dev` and `npm start` from Frontend default to the applicant portal. The server builds applicant assets at startup and watches TSX/CSS changes in development; refresh the browser after edits. Stop with Ctrl+C. Restart previously running frontend servers after this restructure.

Use localhost consistently, matching the backend's default CORS configuration. The frontend and backend must use compatible same-site hosting for session cookies. Primary color is #262262, background is light grey, and the requested system font stack is retained.

## Authentication and data

`context/auth.js` implements login, signup, email verification/resend, password recovery/reset, session checks and logout. `lib/api.js` sends credentialed requests with CSRF protection. Passwords and session/CSRF tokens are never saved to browser storage. Public API settings and consent version are in `lib/config.js`; never put secrets in frontend files.

Start the existing backend API and worker separately. Authentication uses real backend data. Delivery depends on the backend SMTP configuration; Mailpit is available at http://localhost:8025 for local testing. No backend changes are part of this restructure.

Applicant dashboard documents, bookings, results and learning activities remain demo data. Some prototype choices are saved in localStorage and practice answers remain in memory. Other portals are placeholders.

## Validation

Run `npm run check` (syntax, TypeScript and build) and `npm test` from Frontend. `npm run build` generates the applicant bundle separately. Generated `dist/` files and dependencies are ignored by Git and Docker's build context.

## Docker

Build with Frontend as the build context:

```powershell
docker build -t nexus-frontend .
docker run --rm -p 3000:3000 nexus-frontend
```

Use a different container for each future portal:

```powershell
docker run --rm -p 3001:3001 nexus-frontend node server.mjs employer
docker run --rm -p 3002:3002 nexus-frontend node server.mjs admin
docker run --rm -p 3003:3003 nexus-frontend node server.mjs trainer
```

The image runs as an unprivileged user, binds to 0.0.0.0 inside the container, and contains only explicitly copied frontend directories. `HOST` and `PORT` can override the server defaults. `lib/config.js` is served to the browser: its API URL must be reachable from the user's browser, not merely from the container. Production HTTPS, API CORS and same-site cookie deployment must be configured for the target environment.
