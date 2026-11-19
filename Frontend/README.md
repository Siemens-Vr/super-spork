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
    employer/        # Candidate shortlist and profile requests
    admin/           # Administrator sign-in, applicants and document verification
    trainer/         # Trainer invitations, professional profile and qualifications
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

Applicant pages are typed TSX render functions with scoped CSS modules. Esbuild compiles every portal entry and its shared components into `dist/<portal>.js` and `dist/<portal>.css` (applicant uses `app.js` / `app.css`); the existing HTML rendering and delegated events remain in use without adding React. `context` and `hooks` organize reusable state and helpers. Page markup lives in the page folders, while shared state and event wiring remain in `app/applicant/app.js`. `page-context.ts` defines the typed page dependencies.

## Run locally

From Frontend, use a separate terminal for each portal:

| Command | Address | Status |
| --- | --- | --- |
| npm run dev:applicant | http://localhost:3000 | Applicant portal |
| npm run dev:employer | http://localhost:3001 | Candidate discovery and profile requests |
| npm run dev:admin | http://localhost:3002 | Admin portal |
| npm run dev:trainer | http://localhost:3003 | Trainer onboarding portal |

Run `npm ci` from Frontend first. Each `app/<portal>` folder also supports `npm run dev` independently. `npm run dev` and `npm start` from Frontend default to the applicant portal. The server builds all portal assets at startup and watches TSX/CSS changes in development; refresh the browser after edits. Stop with Ctrl+C. Restart previously running frontend servers after this restructure.

Use localhost consistently, matching the backend's default CORS configuration. The frontend and backend must use compatible same-site hosting for session cookies. Primary color is #262262, background is light grey, and the requested system font stack is retained.

## Authentication and data

`context/auth.js` implements password and Google sign-in/signup, email verification/resend, password recovery/reset, session checks and logout. `lib/api.js` sends credentialed requests with CSRF protection. Passwords and session/CSRF tokens are never saved to browser storage. Public API settings and consent version are in `lib/config.js`; never put secrets in frontend files.

Start the existing backend API and worker separately. Authentication uses real backend data. Delivery depends on the backend SMTP configuration; Mailpit is available at http://localhost:8025 for local testing. Document uploads also require private object storage and the scanning worker to be available.

### My profile

My profile (`/onboarding`) reads the signed-in applicant through `GET /api/v1/applicants/me` and the checklist through `GET /api/v1/applicants/me/onboarding`. Save submits only legal name, phone, country (ISO code), and discipline to `PATCH /api/v1/applicants/me` with session cookies and CSRF protection. The sign-in email is read-only. Successful saves use the backend response (including normalized phone), update the header/account-settings identity, and refresh the checklist.

The page includes loading, retry, saving, and field-validation states. Failed saves preserve edits. Profile data is held in memory, discarded on logout/account changes, and loaded from the backend after refresh; it is not saved as demo data in localStorage. The document/checklist badges use actual backend states. Assessment screens remain previews.

### My documents

My documents (`/documents`) combines real identity and academic documents in the original compact file rows, including linked transcripts, and separates previous versions from current submissions. The status badge is followed by a keyboard-accessible ⋯ menu for Details, Verification history, Update / replace, Download, and Add evidence when applicable. Details, history, replacement, new upload and evidence forms open in native modal dialogs without leaving the document list. File icons open authenticated image/PDF previews after a clean scan; browsers without embedded PDF support receive a download fallback. Closing or navigating away from a preview revokes its private object URL, and logout clears open dialogs. Escape closes menus/dialogs and restores focus. The dashboard document list/counts use the same data. Upload fields and file limits come from authenticated `GET /api/v1/documents/requirements`, so they match backend validation.

Document collections automatically follow the backend's cursor pagination in batches of up to 100, including older files and history. The store publishes a collection only after every batch succeeds; failures offer a retry without silently showing a partial list, and logout/account changes discard pending responses. Current/authenticated counts use backend summaries, and server version flags identify replaced files and their transcripts across batches. The assessment picker separately loads all eligible qualifications through `eligibleForAssessment=true`, so unrelated recent uploads cannot hide an older qualification.

Uploads use multipart FormData (`file` plus repeated `transcripts` fields) with the cookie session and CSRF header; the browser sets the multipart boundary. Identity and academic uploads/replacements use their corresponding endpoints. Upload a National ID/passport first. Degree and diploma submissions require 1–5 fresh transcripts, a course name and institution name; professional credentials have their own issuer/date requirements. Institution names can be entered directly, as supported by the backend.

Files appear immediately in quarantine. Run the backend worker (`npm run worker` from Backend) with working private storage and ClamAV, then use **Refresh status** to see scan/review updates. Scan success and independent human verification are displayed separately. Download is enabled only after a clean scan and still uses the protected backend download endpoint. History shows actual status changes, reviews and the applicant's evidence; additional-evidence responses are offered only when requested/disputed/rejected. Replacement retains previous files and review history. The frontend does not save files or document metadata in localStorage.

Browser verification uses synthetic files with isolated test-database storage/scanning fixtures; it does not establish availability of your deployed storage or ClamAV services.

### Explore careers

Explore careers uses the existing backend catalogue, career detail and approved competency endpoints while retaining the tile cards, detail columns and target form. Search filters all loaded career titles, descriptions and linked industries; paginated catalogue and target responses are fully loaded. Career links include the backend UUID, so direct links and browser refresh work.

The target form loads active industries linked to the career, companies operating in the selected industries, and the applicant’s current, clean, non-rejected qualification documents. Choose 1–3 industries, optionally add up to 3 companies and up to 10 qualifications, and select an active assessment with an approved core framework. The backend still validates identity submission, course information and every selection. A profile discipline is required when no selected qualification supplies a course name.

Preparing first creates or updates the account’s draft through `/assessments/targets`, then calls `/assessments/targets/{id}/prepare` with the blueprint UUID. Success is shown only after the backend confirms preparation. Existing prepared/in-progress targets are restored and locked after refresh. Failed preparation retains selections; uncertain network outcomes require refreshing the saved target before continuing. Career/target data stays in memory and is cleared on logout or account changes, rather than being persisted as demo choices. Booking, results and learning screens use the authenticated backend.

Prepared targets offer **Change career target** below the locked assessment context, including when the career detail is unavailable. The recovery form requires a 5–1000 character reason and acknowledgement that abandonment cancels the target’s scheduled bookings. **Keep current target** closes the form without a request. Confirmation posts only `{ reason }` to `/assessments/targets/{id}/abandon`; the backend enforces ownership, cancellation deadlines and started-assessment restrictions while retaining history. In-progress targets direct applicants to their assessment provider or an administrator instead of offering self-service abandonment.

Only a confirmed abandonment releases the local target. Booking and assessment state are then reset, server targets are reconciled, and the applicant returns to Explore careers to choose again. Failed requests retain the locked target and recovery reason. Network failures and conflicts require refreshing career information before another mutation; an uncertain request is never replayed automatically. Late responses after logout or account changes are discarded.

### Identity readiness for assessment booking

The booking and preflight screens show a rejected-identity explanation from the backend and link directly to **Review rejected identity** and **Upload replacement identity** using the owned `identityRecovery.documentId`. The document detail page provides reviewer feedback, history and evidence submission. A rejected identity cannot load bookable slots or reserve a place. A qualifying alternative identity removes the rejection blocker; human authentication is required only when the assessment policy requires it. Replacement documents must complete their own checks before readiness is restored.

If rejection occurs after booking, the scheduled booking remains visible with its existing change controls and policy. Preflight explains that identity must be resolved before starting and offers recovery links, booking management and a readiness refresh. A rejection returned during start also exposes a readiness refresh; the frontend never cancels the booking or changes verification status automatically.

### Assessment voice input

Preflight and dictation follow the backend's `speech.stt` setting. Browser mode uses feature-detected SpeechRecognition and registers final text with the backend. Compatible mode uses MediaRecorder with the checked microphone stream, decodes locally, converts to mono 16-bit PCM WAV at 16 kHz, and uploads one multipart `audio` field to `/assessment-sessions/{id}/audio/transcribe`. The browser checks recording/decoding support before allowing a voice-only assessment to start. Text remains available only when the assessment policy permits it.

Consent explains the selected processing route and is separate from microphone permission. Recording starts only on **Dictate answer** and ends on **Stop dictation** or the stricter recording-duration/PCM-size limit returned by the backend. Compressed capture bytes are also bounded. Recording and transcription show their status and disable answer submission, while Stop remains available during recording. The applicant must review/correct the transcript and explicitly confirm the response; voice responses include its backend transcription ID. Transcription failures keep the existing draft and allow another recording without submitting an answer automatically.

Recording is discarded on microphone loss, navigation, logout, account/booking changes or a changed question. Decoder resources and capture timers are released, pending transcript results are ignored after cancellation, and no recordings are persisted in frontend storage. Automated checks use synthetic streams and provider fixtures; passing them does not establish real microphone quality or deployed speech-provider availability.

### Learning plans

The learning page has its own store, independent of assessment readiness and interview state. `/learning` reads all booking pages, then the existing owned `/assessments/attempts/{id}` endpoint for completed attempts, and displays the published plan with the latest attempt completion time. A newer scheduled booking cannot hide an earlier plan. Attempts without a published plan are excluded from the default selection; an empty published plan correctly reports that no competency gaps were identified. Interview-session availability is not required.

Results links retain `/learning?booking={bookingId}` to open that specific assessment’s plan. An unavailable booking shows an error, and a selected booking without a published plan shows the pending-publication message rather than another assessment’s plan. Progress updates target the displayed plan through `/assessments/learning-plans/{planId}/items/{itemId}` with cookies and CSRF. Failed reads offer retry, failed progress saves retain the confirmed state, and logout/account changes discard late private responses. The page keeps its existing layout and activity controls.

### Google sign-in and registration

Start the backend on port 4000 and run `npm run dev` here for the frontend on port 3000. Use `http://localhost:3000/login` or `/signup` and choose **Continue with Google**. Both buttons navigate to the backend OAuth entry, which requests Google account selection without forcing repeated permission consent; no Google SDK or secret belongs in the frontend.

Returning Google applicants enter the workspace after `/auth/me` confirms the applicant session. New Google applicants finish at `/register/google`, see the verified email/name they selected, provide their phone number and accept the privacy notice. **Use another Google account** starts a fresh account-selection flow. On page refresh or returning from the privacy notice, the form reloads the pending identity through cookie-bound `GET /api/v1/auth/google/registration`; no identity is taken from URL parameters. The ten-minute signup deadline is preserved. Expired sessions show a restart action instead of an unusable form. This restores the pending signup identity, not unsubmitted phone input. Completion uses the existing cookie session and CSRF protection. Expired/cancelled flows offer a restart. Matching password accounts must sign in with their password; this change does not add a settings flow for linking existing accounts.

Backend configuration must include `FRONTEND_URL=http://localhost:3000`, the frontend in `CORS_ORIGINS`, and the Google client ID/secret. Register `http://localhost:4000/api/v1/auth/google/callback` as the Google Console redirect URI. The frontend callback is a return destination after the backend completes OAuth; it does not replace the Google Console redirect URI. Test accounts must be allowed by your Google app configuration.

The public `apiBase` and `consentVersion` in `lib/config.js` must match your backend deployment and `PRIVACY_NOTICE_VERSION`. They currently target localhost and the `2026-11-01` privacy notice. Production hosting needs those public values updated along with backend URLs/CORS and cookie settings. Restart the frontend server after changing return-path handling.

Some unconnected applicant dashboard content remains illustrative. Prototype choices may be saved in localStorage; connected assessment answers and learning progress are saved through the backend.

### Administrator workspace

Run `npm run dev:admin` and open http://localhost:3002. The admin workspace shares the applicant portal’s theme and layout and connects the corresponding implemented workflows: applicant search/profile inspection, account status management, identity and academic document queues, protected previews/downloads, verification decisions, history, and evidence. Overview applicant totals come from API pagination metadata. Assessment and catalogue administration are outside this implementation.

Sign in with an operator-provisioned administrator account. The portal checks `/auth/me` and requires the backend’s MFA gate before showing records. First-time administrators can configure an authenticator and save their one-time recovery codes; subsequent sessions use an authenticator or recovery code. Recovery/setup material stays in memory and is cleared after verification or sign-out. There is no public administrator registration.

The backend must allow `http://localhost:3002` in `CORS_ORIGINS`, alongside the applicant and Swagger origins. The backend defaults and `.env.example` include it; existing deployments must update their environment and restart. Session cookies are shared across localhost ports, so signing into a different account in one local portal also changes the cookie session used by the other portal. Private admin data is not stored in localStorage.

See [administrator workflow and validation notes](docs/admin-portal.md) for endpoint coverage, review rules, and test limits.

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

## Shared dashboard components

Each shared UI component lives in `components/<name>/<name>.tsx` with a matching `<name>.module.css`: `sidebar`, `topbar`, `footer`, `icon`, and `dashboard-layout`. These follow the existing TSX string-rendering approach; React is not required.

The portals use role-specific navigation. The employer portal uses the shared sign-in at port 3000 and requires a verified account with employer access granted in Admin → Hiring operations. Add the employer frontend origin to the backend CORS allowlist before opening the portal. See [Trainer and hiring workflows](../Backend/docs/training-dashboard.md) for setup and operation.
## Public website

The applicant frontend also serves the project’s public pages: `/` (landing), `/about`, and `/contact`. `/login` and `/signup` continue to use the existing shared authentication flow and role-based dashboard redirects. `/dashboard` remains the authenticated applicant workspace.

Public markup is rendered by `app/public/pages.mjs`, with isolated styles and interactions in the same directory. The 3D landing illustration uses CSS transforms and honours reduced-motion preferences. Public pages do not load private workspace data or require the API to be available. Only the public CSS/JS files are served; page source modules are not exposed.

Contact uses `vr.africa@dkut.ac.ke`. The contact form prepares a mailto draft in the visitor’s email app; it does not submit or store messages on the backend. Run `npm run test:public` for public-page checks.
