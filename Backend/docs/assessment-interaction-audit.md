# Assessment entry and voice interaction audit

This audit implements the supplied “Assessment Entry, Camera, Microphone and AI Voice Interaction” specification in the existing Express/TypeScript/Prisma application. The repository remains a backend project. A small authenticated development page exists only to exercise browser APIs; it is not an applicant dashboard or a production frontend.

## Audit findings before this change

The backend already provided registration, verified cookie authentication, CSRF, booking ownership, time-window checks, immutable assessment targets, approved core/contextual frameworks, assessor completion, deterministic skill-gap calculations and learning plans. These modules are reused.

There was no operational AI interviewer, LangChain/LangGraph dependency, approved scenario bank, interaction session, conversation persistence, audio adapter, browser device preflight or development media page. `ai-assessment/contracts.ts` described future planning interfaces rather than an existing graph. Booking a slot or preparing a target did not run an interview.

## Requirement coverage

| Specification                | Implementation and evidence                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Take Assessment entry        | Owned booking preflight and explicit start endpoints under `/api/v1/assessments`. Current time must fall within the scheduled slot. Unique attempt/session and booking/session constraints prevent duplicate sessions.                                                                                                                         |
| No early question disclosure | Preflight returns policies and metadata only. Approved scenario content is selected internally after start authorization. Session APIs return only presented messages, never future prompts or private evaluation criteria.                                                                                                                    |
| Device policies              | Blueprint `interactionPolicy` is frozen in newly prepared attempts, then captured in the interaction session. Existing prepared attempts capture the current blueprint policy when their first interaction starts. Camera/microphone requirements, text alternative, language, camera purpose and accommodation instructions are configurable. |
| Browser preflight            | Development page has explicit camera/microphone buttons, local video preview, selectors, input meter, local microphone recording/playback test, mute, stop controls and speaker test with applicant confirmation. Permission requests time out without claiming denial; late streams are stopped.                                              |
| Privacy                      | No video recording/upload endpoint. No face, emotion, gaze or misconduct classifier. Separate privacy acknowledgment and audio-processing consent; microphone test requires an explicit action. Server audio is held in bounded memory and discarded. Transcripts, corrections and assessment evidence are persistent.                         |
| Controlled two-way speech    | Browser SpeechRecognition and SpeechSynthesis by default; compatible server STT/TTS adapters are configurable. Answers enter the same workflow regardless of mode. AI speech is generated only from stored interviewer message IDs.                                                                                                            |
| Confirmed transcripts        | Partial recognition cannot advance the graph. The applicant reviews/corrects final text and explicitly confirms submission. Original transcription, final response and corrections are linked to the owned session.                                                                                                                            |
| Approved scenarios           | Versioned private scenario bank plus ordered blueprint assignments. Admin creation/assignment requires existing assessment management permission and recent MFA. Startup requires scenario coverage for every frozen competency. Three labelled development scenarios are seeded for Mechatronics.                                             |
| LangChain/LangGraph          | A LangChain runnable invokes the configured provider. LangGraph handles scenario presentation, bounded follow-ups and advancement. A Prisma-backed checkpoint saver persists each step and pending writes in PostgreSQL. No in-memory checkpoint dependency.                                                                                   |
| Retry and reconnect          | Idempotency keys bind a response to its exact payload. A session lease serializes processing. Confirmed responses remain pending after provider failure; resume continues graph checkpoints and projects messages once. Progress and interruption events persist.                                                                              |
| Results and upskilling       | AI produces validated competency proposals, not an automatic final hiring/readiness decision. An authorised assessor reviews or corrects them. Approval uses existing immutable completion, weighted scoring, skill gaps and learning plans.                                                                                                   |
| Secure APIs                  | Existing sessions, applicant ownership, CSRF, permission checks, rate limits, size/duration/signature validation, and private no-store responses apply. Browser readiness is explicitly self-reported, not attestation.                                                                                                                        |
| Swagger                      | Preflight, start, session, prompt, response, transcription, speech, progress, resume, events, results, scenarios and accommodation operations are generated from the repository schema generator.                                                                                                                                              |

## API sequence

1. Register/verify/login through the existing authentication flow.
2. Create and prepare an assessment target; book its blueprint using the existing booking endpoints.
3. `GET /api/v1/assessments/{bookingId}/preflight` returns start availability, equipment policies, provider capabilities and privacy information.
4. The browser tests devices. No Express route can inspect browser devices directly.
5. During the booked window, `POST /api/v1/assessments/{bookingId}/start` with `confirmed`, `privacyAcknowledged`, mode and device reports. Voice requires audio-processing consent, ready microphone and confirmed speaker output. Text may be used when policy permits.
6. Read `GET /api/v1/assessment-sessions/{id}` or `/current-scenario`. The session ID is distinct from booking, target, blueprint and attempt IDs.
7. For browser STT, POST a final `{text,isFinal:true,language}` to `/audio/transcribe`. For server STT, upload one `audio` PCM WAV file to that same endpoint.
8. Review/correct the transcription, then POST `{promptId,origin,confirmed:true,text,transcriptionId?}` to `/responses` with an `Idempotency-Key`. A VOICE response must reference an unused completed transcription in that session. TEXT has no transcription ID.
9. `/speech/synthesize` accepts only `{messageId}`. Browser mode returns authoritative text/language; compatible mode returns transient `audio/wav`.
10. Use `/resume` following a network interruption and `/progress` for status. The booking deadline is not silently extended. Already displayed content and reports remain readable after the window.
11. When all scenarios finish, `/results` returns a clearly provisional AI proposal. `/admin/assessment-sessions/{id}` supports review. An assessor can approve using `/approve-results` with an idempotency key or submit corrected scores through the existing `/admin/assessment-attempts/{id}/complete` API.
12. Final `/results` returns the existing attempt results and learning plan. Completion unlocks a later career target.

The earlier `/assessments/attempts/{id}/start` remains the manual assessor workflow; it cannot create an interaction session or disclose scenarios. Interactive entry always requires its own confirmed device/consent gate.

## Provider configuration

Set secrets in the ignored `.env` or deployment secret store. Never put provider keys in browser code or Swagger request bodies.

- `AI_PROVIDER=compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`: a chat-completions compatible endpoint. The adapter requests JSON, validates action/evidence/score output and restricts evaluation IDs to the approved scenario's frozen competencies. `AI_TIMEOUT_MS` bounds generation. `AI_MAX_OUTPUT_TOKENS` defaults to 1024; the local development configuration uses 768 with concise output instructions. Raise the budget if a large rubric produces truncated output; truncated output is rejected and confirmed answers remain saved. Optional `AI_KEEP_ALIVE=30m` sends the Ollama extension to keep the model resident between turns. Only configure it for a supporting provider. Per-turn logs record duration and token counts without applicant text. Optional `AI_REASONING_EFFORT` configures providers that support a reasoning-effort setting; the configured local Qwen service uses `none` for controlled interview turns. `AI_TLS_MAX_VERSION` defaults to TLS 1.3; TLS 1.2 can be selected for an endpoint requiring compatibility. Certificate verification remains enabled.
  For the current local setup:

```env
AI_PROVIDER=compatible
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=ollama
AI_MODEL=qwen3.5:9b
AI_REASONING_EFFORT=none
AI_MAX_OUTPUT_TOKENS=768
AI_KEEP_ALIVE=30m
```

`ollama` is a local placeholder, not a cloud credential. Ollama must remain running. Run `npm run ai:check` for a real synthetic assessment call that creates no applicant result. Local GPU memory, competing model use and load still affect latency; keeping a model resident does not guarantee a response time.

- `STT_PROVIDER=browser`: final browser recognition text is registered with the backend, then separately confirmed. Browser recognition availability depends on browser/platform and may send audio to the browser vendor.
- `STT_PROVIDER=compatible`, `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE`: multipart `/audio/transcriptions`. A faster-whisper service can provide this protocol independently; Python is not part of the application runtime.
- `TTS_PROVIDER=browser`: SpeechSynthesis reads the exact stored prompt. `TTS_PROVIDER=compatible`, `TTS_BASE_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`: JSON `/audio/speech`, requesting WAV. A self-hosted Piper adapter can expose that protocol independently.
- `MAX_AUDIO_MB=8`, `MAX_AUDIO_SECONDS=180`: upload byte and actual PCM duration bounds. Initial server audio input is 16-bit PCM WAV at 8–48 kHz, one or two channels. The development page converts MediaRecorder output to mono WAV for server STT. MP3, arbitrary WebM uploads and compressed WAV are rejected rather than trusted from a MIME header.
- `disabled` speech providers return a clear unavailable response; typed answers remain usable if policy permits. Audio playback failure never changes scores or graph state.

No raw audio reference or media payload is stored in PostgreSQL. Graph byte columns contain serialized text/workflow checkpoints, not recordings. Media streams remain private in the browser. Transcripts and checkpoints are assessment evidence and require institution-defined retention; no automatic destructive purge is introduced here.

## Development page and deployment

Run migrations, regenerate Prisma, run the normal seed, then start `npm run dev`. Visit `/dev/assessments`; unauthenticated visitors are redirected to the development sign-in page. `/applicant/assessments/{bookingId}/take` is a development-only alias. All testing controls require a verified applicant session. The sign-in page uses the existing authentication API.

The page is registered only when `NODE_ENV=development`. In test or production, all its pages and assets return 404. Production supplies its own frontend and calls the same APIs. Use HTTPS outside localhost; the existing production configuration already requires an HTTPS application URL. Provider URLs are server configuration, never applicant-supplied destinations.

Browser support is feature-detected. Text remains the reliable fallback. Media devices require a secure browser context; SpeechRecognition has limited browser support, and SpeechSynthesis voices/playback depend on the platform. Voice capability is not assumed from the browser name. The local microphone test does not send recordings to the server. Starting voice recognition or server transcription is a separate action and requires recorded audio-processing consent.

If a camera/microphone is mandatory and unavailable, the page explains the purpose and accommodation process. An administrator can grant a reasoned exception using `PUT /admin/assessment-attempts/{id}/accommodation` before the session starts. Exceptions are audited and cannot silently change an active session policy. Do not approve final competency results solely from unreviewed AI output.

## Validation record

Final validation: **130 tests passed across 9 files**, including integration tests against the isolated `nexus_test` database. TypeScript type checking, ESLint, production compilation and `git diff --check` passed. All seven migrations were also applied successfully to a fresh empty test database; the interaction migration is installed in the development database.

Automated backend tests cover booking ownership, invalid/out-of-window starts, explicit confirmation, duplicate initialization, camera exceptions, microphone readiness denial, missing scenario coverage, final transcript corrections, typed fallback, mismatched/replayed response keys, bounded follow-ups, persisted checkpoints/resume, simulated STT/TTS outages, unsupported/oversized/over-duration audio, cross-applicant access and final reviewed skill-gap reports. Browser device states in backend tests are declared reports, not a claim of live hardware verification.

Live checks on 9 November 2026 used synthetic engineering evidence and an isolated test applicant/database. The authenticated remote provider returned a tiny JSON response in approximately 15.7 seconds, but a full assessment call timed out at 90 seconds. Local Ollama `qwen3.5:9b` subsequently returned a valid COMPLETE evaluation in 12,223 ms (524 prompt tokens, 100 completion tokens). The subsequently warmed browser session processed a recovered answer in 2,234 ms and generated a real FOLLOW_UP in 1,135 ms. These are individual observations, not throughput or quality benchmarks.

The real text-mode browser assessment then completed all three approved fixture scenarios, including a real provider follow-up and recovery of the previously confirmed pending answer. The session returned `AWAITING_REVIEW`; the report marked its scores `provisional: true` and `reviewRequired: true`. The full automated workflow separately verifies assessor approval, final skill gaps and learning plans.

Real browser observations in the Codex in-app browser: authenticated booking selection, preflight, explicit text-mode start and an approved scenario were exercised. Camera access reported “Requested device not found”; a microphone request remained pending and the page recovered after its 20-second timeout. The speaker-test action completed, but human audibility was not confirmed. Browser speech synthesis reported failure and the visible-text fallback remained usable. Consequently live camera preview, microphone capture, technical-vocabulary transcription across speech styles and a complete spoken interview are **not verified** in this environment. No real microphone recording was sent to a speech provider. Backend speech success/outage cases use mocks and do not establish hardware success.

Implementation references: [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) and [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api). The checkpoint saver implements the installed package's typed persistence contract.
