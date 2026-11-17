# Connected assessments

The applicant UI retains its existing preflight form, chat cards, results table and learning-plan rows. Booking pages link to `/preflight?booking=<id>`. Assessment, results and learning pages retain that booking reference for refresh and historical reports.

- Preflight is read-only. It displays backend blockers and the mandatory camera/microphone policy. Older optional-device snapshots cannot waive the requirement. Start requires explicit readiness and evidence/privacy acknowledgments.
- Text answers require review and confirmation. A confirmed answer uses one idempotency key. Unknown outcomes block new submissions until the saved session is reconciled; a retry uses the original key and body. Responses are server-persisted; unsent drafts remain in memory only.
- AI start/answer/resume requests allow 150 seconds. Other API requests keep their usual timeout.
- Browser dictation is optional when enabled by policy, the configured STT provider and explicit audio-processing consent. Interim transcripts are never submitted. Final transcripts are saved for correction, then explicitly confirmed. Browser support and browser-vendor audio processing vary. Server-compatible audio capture is not exposed in this UI; voice-only policies with that configuration request an accommodation instead of silently falling back.
- Camera and microphone checks are mandatory in both text and voice modes and request media only after a button click. Camera is a local preview. Both live streams remain open from preflight through the assessment room. Loss or muting pauses answer submission. Streams are released when leaving these screens, switching bookings, closing the page, or logging out. Refreshing requires new checks. Required speaker readiness is separately confirmed by the applicant.
- New answers close at the scheduled end. A response accepted before the deadline has a bounded processing grace period of `AI_TIMEOUT_MS + 30 seconds` beyond the end, including reconciliation/resume. This permits processing, not new submissions or an extended answering window. Unfinished assessments expire; completed scenarios awaiting assessor review do not.
- Provisional reports are clearly labeled. Admin `/assessment-reviews` requires `assessments.review` and recent MFA. Assessors review the confirmed conversation and frozen rubric, correct scores/evidence if needed, and explicitly publish immutable final results and the deterministic learning plan.
- Learning activity changes persist to the backend. Historical completed bookings link to their report.

Validation uses the isolated `nexus_test` database and synthetic users. Browser workflow verification uses a mocked interviewer; it does not verify the configured live AI provider or real microphone/speech-vendor behavior. Restart the frontend servers to load new clean-URL routes; restart the backend if it is not running in watch mode. Mandatory device readiness itself requires no database migration. The explicit skip action requires the migration noted below.

## Clarification and explicit skip policy

The backend classifies each confirmed response by meaning as relevant, unrelated, process-only, or declined. Short valid technical answers remain relevant. It permits one neutral clarification per scenario for an unrelated/process-only response, independently of the existing technical follow-up limit. A further non-answer advances the scenario. Process questions receive an explanation without model answers, scoring explanations or hints. All confirmed responses remain in the conversation/evidence history.

An explicit skip requires a separate frontend confirmation and uses the `SKIP` origin with a fixed payload enforced by API validation and a database constraint. It does not require a voice transcription. Prior technical responses are still evaluated; with no usable evidence the backend proposes zero with an explicit insufficient-evidence review flag. This is provisional and still requires a human assessor decision. Completion acknowledgments from the model are omitted from applicant chat; the next scenario or completion notice supplies the transition.

Apply migration `20261113193000_assessment_skip_response` before deploying the new skip control. Existing checkpoints without relevance metadata are handled conservatively by evaluating prior applicant messages rather than discarding their evidence.

## Mandatory devices

Start, response (including skip), and resume requests must include `devices` with `camera: READY` and `microphone: READY`. Both permission checks are required even for text answers. Equipment waivers are no longer accepted by the accommodation endpoint; text-mode accommodation remains supported. Historical results remain readable without device access. Device state is browser-reported; backend checks enforce the API contract, not hardware attestation or proctoring. The camera is never transmitted or recorded. Microphone access alone does not authorize transcription: voice processing still requires separate consent.


### Spoken assessor questions

In the assessment room, applicants can enable spoken questions in either text or voice mode. Browser speech synthesis reads only the current displayed assessor prompt, once when it changes; saved conversation history and applicant answers are never read automatically. Applicants can replay the question or stop playback. Starting dictation cancels question playback, and reading a question aborts dictation to prevent the assessor's voice from entering the answer transcript. Answers still require review and explicit submission. Playback is cancelled on leaving the assessment, logout, missing device readiness, or completion. The toggle resets on leaving or refreshing; browser support and audio playback policies vary, so displayed questions remain available and playback errors offer a manual retry. No new backend speech service is used.
