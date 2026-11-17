import { allBookingPages } from './bookings.js';
import { voiceCapability } from './assessment-speech.js';
export function createAssessmentStore({ client, onChange = () => {}, onUnauthorized = () => {}, makeKey = () => crypto.randomUUID() }) {
  const empty = () => ({ owner: '', bookingId: '', requestedId: '', status: 'idle', preflight: null, session: null, report: null, booking: null, busy: false, error: '', requiresMfa: false, draft: '', uncertain: false, transcript: null, recording: 'idle', devices: { camera: 'NOT_REQUESTED', microphone: 'NOT_REQUESTED', speakerConfirmed: false }, startDraft: {}, spokenQuestions: false, speaking: false });
  let state = empty(), version = 0, pending = null, transcriptionVersion = 0, transcribing = false;
  const current = v => v === version;
  const fail = error => { state.error = error.message || 'Unable to load your assessment.'; state.requiresMfa = error.code === 'MFA_REQUIRED'; if (error.status === 401) onUnauthorized(); };
  async function transcribe(input, audio, isCurrent = () => true) {
    const session = state.session;
    if (state.busy || !session?.currentPromptId || session.status !== 'ACTIVE' || state.uncertain || session.hasPendingResponse || Date.parse(session.endsAt) <= Date.now()) return;
    if (!session.preflight.audioProcessingConsent || state.devices.microphone !== 'READY' || state.devices.camera !== 'READY') { state.error = 'Confirm audio processing and complete the camera and microphone checks before dictating.'; onChange(); return; }
    const v = version, promptId = session.currentPromptId, operation = ++transcriptionVersion;
    const valid = () => current(v) && operation === transcriptionVersion;
    transcribing = true; state.busy = true; state.error = ''; onChange();
    try {
      const transcript = audio ? await client.assessmentAudioTranscript(session.id, input) : await client.assessmentTranscript(session.id, { text: input, isFinal: true, language: session.language });
      if (!valid() || !isCurrent() || state.session?.currentPromptId !== promptId) return;
      if (!transcript?.id || !transcript.originalText?.trim() || transcript.originalText.length > 12000) throw new Error('Transcription returned no usable text. Record your answer again.');
      state.transcript = { ...transcript, promptId }; state.draft = transcript.originalText;
    } catch (error) { if (valid() && isCurrent() && state.session?.currentPromptId === promptId) fail(error); }
    finally { if (valid()) { transcribing = false; state.busy = false; onChange(); } }
  }
  const store = {
    snapshot: () => state,
    speech(settings) { Object.assign(state, settings); onChange(); },
    reset() { version++; transcriptionVersion++; transcribing = false; state = empty(); pending = null; },
    cancelTranscription() { transcriptionVersion++; if (transcribing) { transcribing = false; state.busy = false; } },
    draft(text) { if (!state.busy && !state.uncertain) state.draft = text; },
    device(name, value) { state.devices[name] = value; onChange(); },
    clearDevices() { state.devices.camera = 'NOT_REQUESTED'; state.devices.microphone = 'NOT_REQUESTED'; },
    message(message) { state.error = message; onChange(); },
    async load(owner, requestedId = '', force = false) {
      if (!owner) return;
      if (owner !== state.owner || requestedId !== state.requestedId) { store.reset(); state.owner = owner; state.requestedId = requestedId; }
      if (state.busy || state.recording !== 'idle' || (!force && state.status !== 'idle')) return;
      const v = ++version;
      state.status = 'loading'; state.error = ''; onChange();
      try {
        const bookings = await allBookingPages(page => client.bookings(page));
        if (!current(v)) return;
        const booking = requestedId ? bookings.find(b => b.bookingId === requestedId) : bookings.find(b => b.status === 'SCHEDULED') || bookings.find(b => b.status === 'COMPLETED');
        if (!booking) throw new Error('Choose a confirmed assessment booking to continue.');
        const preflight = await client.bookingPreflight(booking.bookingId);
        if (!current(v)) return;
        const session = preflight.session ? await client.assessmentSession(preflight.session.id) : null;
        if (!current(v)) return;
        const report = session && ['AWAITING_REVIEW', 'COMPLETED'].includes(session.status) ? await client.assessmentResults(session.id) : null;
        if (!current(v)) return;
        if (state.session && state.session.currentPromptId !== session?.currentPromptId) { state.transcript = null; state.draft = ''; }
        state.booking = booking; state.bookingId = booking.bookingId; state.preflight = preflight; state.session = session; state.report = report; state.status = 'ready';
        // A saved applicant message or a changed prompt proves the old turn was accepted.
        if (pending && session && !session.hasPendingResponse && session.currentPromptId !== pending.body.promptId) { pending = null; state.draft = ''; state.transcript = null; }
        state.uncertain = !!session?.hasPendingResponse || !!pending;
      } catch (error) { if (current(v)) { state.status = 'error'; fail(error); } }
      if (current(v)) onChange();
    },
    async action(kind, input) {
      if (state.busy || state.recording !== 'idle' || state.status !== 'ready') return false;
      if (kind === 'start' && input?.mode === 'VOICE' && !voiceCapability(state.preflight?.speech).available) { state.error = 'Voice input is unavailable in this browser. Request a text accommodation or use a supported browser.'; onChange(); return false; }
      if (['answer', 'skip'].includes(kind) && (state.uncertain || state.session?.hasPendingResponse)) return false;
      if (['start', 'resume', 'answer', 'skip'].includes(kind) && (state.devices.camera !== 'READY' || state.devices.microphone !== 'READY')) { state.error = 'Allow camera and microphone access and complete both device checks before continuing.'; onChange(); return false; }
      const v = version;
      state.busy = true; state.error = ''; if (kind === 'start') state.startDraft = { ...state.startDraft, ...input }; onChange();
      try {
        let session;
        if (kind === 'start') session = await client.startAssessment(state.bookingId, { ...input, devices: { ...state.devices } });
        else if (kind === 'resume') {
          if (!state.session) throw new Error('Reload assessment readiness before continuing.');
          // Reuse the original key/body for an uncertain response; never create another answer.
          session = pending ? await client.assessmentResponse(state.session.id, pending.body, pending.key) : await client.resumeAssessment(state.session.id, { ...state.devices });
        } else if (kind === 'answer' || kind === 'skip') {
          const text = kind === 'skip' ? 'I don’t know / Skip this scenario.' : state.draft.trim();
          if (!text || !state.session?.currentPromptId) throw new Error('Enter an answer for the current question.');
          if (kind === 'answer' && !state.session.policy.allowText && !state.transcript) throw new Error('Record and review a voice transcript before submitting this answer.');
          const body = { promptId: state.session.currentPromptId, devices: { ...state.devices }, text, confirmed: true, origin: kind === 'skip' ? 'SKIP' : state.transcript ? 'VOICE' : 'TEXT', ...(kind !== 'skip' && state.transcript ? { transcriptionId: state.transcript.id } : {}) };
          pending = { key: makeKey(), body };
          session = await client.assessmentResponse(state.session.id, body, pending.key);
        } else throw new Error('Unknown assessment action.');
        if (!current(v)) return false;
        state.session = session;
        pending = null; state.draft = ''; state.transcript = null; state.uncertain = false;
        const report = ['AWAITING_REVIEW', 'COMPLETED'].includes(session.status) ? await client.assessmentResults(session.id) : null;
        if (!current(v)) return false;
        state.report = report;
        return true;
      } catch (error) {
        if (!current(v)) return false;
        fail(error);
        if (error.status >= 500 || ['NETWORK_ERROR', 'SESSION_BUSY', 'AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_RESPONSE_INVALID', 'PROVIDER_RESPONSE_INVALID', 'PROMPT_CHANGED', 'ASSESSMENT_WINDOW_CLOSED'].includes(error.code)) {
          state.uncertain = true;
          state.error += ' Reload the saved session before continuing. Your confirmed answer may already be saved.';
        } else if (kind === 'answer' || kind === 'skip' || kind === 'resume') pending = null;
        return false;
      } finally { if (current(v)) { state.busy = false; onChange(); } }
    },
    transcribe: (text, isCurrent) => transcribe(text, false, isCurrent),
    transcribeAudio: (audio, isCurrent) => transcribe(audio, true, isCurrent),
  };
  return store;
}
