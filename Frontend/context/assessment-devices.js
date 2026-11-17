// Media is requested only after a deliberate readiness/dictation button click.
// Camera output is a local preview and is never recorded or uploaded.
import { createServerRecording, voiceCapability } from './assessment-speech.js';
export function createAssessmentDevices({ store, active = () => true, questionsActive = active }) {
  let camera = null, microphone = null, recognition = null, recording = null, dictation = null, recognitionTimer, version = 0, context = '', lastPrompt = '', playback = null;
  const key = () => `${store.snapshot().owner}:${store.snapshot().bookingId}`;
  const lost = name => { devices.cancelDictation(); store.device(name, 'UNAVAILABLE'); const s = store.snapshot(); if (s.session && active()) void store.message(`${name === 'camera' ? 'Camera' : 'Microphone'} access was lost. Reconnect it and repeat the device check to continue. Your confirmed answers are saved.`); };
  const report = error => store.message(error?.message || 'This device is unavailable. Check browser permissions or contact your assessment provider.');
  const dictationCurrent = token => {
    const s = store.snapshot(), session = s.session;
    return token && token.version === version && token.owner === key() && questionsActive() && active() && session?.id === token.sessionId && session.currentPromptId === token.promptId && session.status === 'ACTIVE' && !session.hasPendingResponse && !s.uncertain && Date.parse(session.endsAt) > Date.now() && s.devices.camera === 'READY' && s.devices.microphone === 'READY';
  };
  const currentQuestion = () => {
    const s = store.snapshot(), session = s.session;
    if (!questionsActive() || !session || session.status !== 'ACTIVE' || s.busy || s.uncertain || session.hasPendingResponse || Date.parse(session.endsAt) <= Date.now()) return null;
    return session.messages.find(m => m.id === session.currentPromptId && m.role !== 'APPLICANT');
  };
  const devices = {
    attach() { if ((camera || microphone) && context !== key()) devices.reset(); const video = document.querySelector('[data-assessment-camera]'); if (video && camera) video.srcObject = camera;
      if (dictation && !dictationCurrent(dictation)) devices.cancelDictation();
      const s = store.snapshot(), prompt = currentQuestion();
      if (!prompt || s.devices.camera !== 'READY' || s.devices.microphone !== 'READY') { if (playback && s.session) devices.stopSpeaking(); return; }
      if (!dictation && s.spokenQuestions && lastPrompt !== prompt.id) { lastPrompt = prompt.id; devices.speaker(); }
    },
    reset() { version++; devices.cancelDictation(false); for (const stream of [camera, microphone]) stream?.getTracks().forEach(t => { t.onended = null; t.onmute = null; t.onunmute = null; t.stop(); }); camera = null; microphone = null; context = ''; lastPrompt = ''; playback = null; store.snapshot().spokenQuestions = false; store.snapshot().speaking = false; store.clearDevices(); globalThis.speechSynthesis?.cancel(); },
    cancelDictation(notify = true) {
      store.cancelTranscription?.();
      const previous = recording; recording = null; dictation = null; previous?.cancel();
      clearTimeout(recognitionTimer);
      const old = recognition; recognition = null; if (old) { old.onend = null; old.onresult = null; old.onerror = null; old.abort(); }
      const s = store.snapshot();
      if (notify && s.recording && s.recording !== 'idle') store.speech({ recording: 'idle' });
      else s.recording = 'idle';
    },
    async check(name) {
      const v = version, owner = key();
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media devices are unavailable in this browser.');
        const stream = await navigator.mediaDevices.getUserMedia(name === 'camera' ? { video: true } : { audio: true });
        if (v !== version || owner !== key() || !active()) { stream.getTracks().forEach(t => t.stop()); return; }
        devices.cancelDictation();
        const previous = name === 'camera' ? camera : microphone;
        previous?.getTracks().forEach(t => { t.onended = null; t.onmute = null; t.onunmute = null; t.stop(); });
        if (name === 'camera') camera = stream; else microphone = stream;
        context = owner;
        for (const track of stream.getTracks()) {
          track.onended = () => { if (v === version && context === key() && active()) lost(name); };
          track.onmute = () => { if (v === version && context === key() && active()) lost(name); };
          track.onunmute = () => { if (v === version && context === key() && active() && track.readyState === 'live') store.device(name, 'READY'); };
        }
        if (!stream.getTracks().length || stream.getTracks().some(t => t.readyState !== 'live' || t.muted)) { store.device(name, 'UNAVAILABLE'); report(new Error('The device is not providing a live stream. Retry the device check.')); }
        else store.device(name, 'READY');
        devices.attach();
      } catch (error) { if (v === version && owner === key() && active()) { store.device(name, error.name === 'NotAllowedError' ? 'DENIED' : 'UNAVAILABLE'); report(error); } }
    },
    toggleQuestions() {
      const enabled = !store.snapshot().spokenQuestions;
      if (enabled && (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance)) { report(new Error('Spoken questions are unavailable in this browser. Read the displayed question.')); return; }
      if (!enabled) devices.stopSpeaking();
      lastPrompt = '';
      store.speech({ spokenQuestions: enabled });
      devices.attach();
    },
    stopSpeaking() {
      playback = null;
      globalThis.speechSynthesis?.cancel();
      if (store.snapshot().speaking) store.speech({ speaking: false });
    },
    speaker() {
      if (dictation) return;
      if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) { report(new Error('Speaker playback is unavailable in this browser. Read the displayed question.')); return; }
      const s = store.snapshot(), prompt = currentQuestion();
      if (s.session && !prompt) return;
      // Never let the assessor's voice become part of an applicant's dictation.
      const previous = recognition; recognition = null; previous?.abort();
      devices.stopSpeaking();
      const utterance = new SpeechSynthesisUtterance(prompt?.text || 'This is your assessment speaker check.');
      utterance.lang = s.session?.language || s.preflight?.policy.language || 'en';
      const v = version, owner = key();
      playback = utterance;
      const finish = () => { if (v === version && owner === key() && playback === utterance) { playback = null; store.speech({ speaking: false }); } };
      utterance.onend = finish;
      utterance.onerror = event => { if (playback !== utterance) return; finish(); if (!['canceled', 'interrupted'].includes(event.error) && v === version && active()) report(new Error('Question playback failed. Click Read question aloud to retry, or read the displayed text.')); };
      store.speech({ speaking: true });
      speechSynthesis.speak(utterance);
      // Audible readiness is confirmed separately by the applicant, not by playback success.
    },
    dictate() {
      const state = store.snapshot();
      if (!state.session?.preflight.audioProcessingConsent || !currentQuestion() || state.busy || state.uncertain || dictation || state.devices.camera !== 'READY' || state.devices.microphone !== 'READY') return;
      const capability = voiceCapability(state.session.speech);
      if (!capability.available) { report(new Error(`${capability.reason} ${state.session.policy.allowText ? 'Type your answer or use a supported browser.' : 'Use a supported browser or request a text accommodation.'}`)); return; }
      devices.stopSpeaking();
      const token = { version, owner: key(), sessionId: state.session.id, promptId: state.session.currentPromptId };
      dictation = token;
      if (state.session.speech.stt === 'compatible') {
        if (!microphone?.getTracks().some(track => track.readyState === 'live' && !track.muted)) { dictation = null; report(new Error('Complete the microphone check before recording.')); return; }
        const capture = createServerRecording({
          stream: microphone, speech: { ...state.session.speech, maxAudioSeconds: Math.min(state.session.speech.maxAudioSeconds, (Date.parse(state.session.endsAt) - Date.now()) / 1000) },
          isCurrent: () => recording === capture && dictationCurrent(token),
          onState: phase => { if (recording !== capture) return; if (phase === 'idle') { recording = null; dictation = null; } store.speech({ recording: phase }); },
          onAudio: audio => store.transcribeAudio(audio, () => recording === capture && dictationCurrent(token)),
          onError: error => { if (token.version === version && token.owner === key()) report(error); },
        });
        recording = capture;
        try { capture.start(); } catch (error) { devices.cancelDictation(); report(error); }
        return;
      }
      const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      try { recognition = new Recognition(); } catch (error) { devices.cancelDictation(); report(error); return; }
      const instance = recognition, v = version, promptId = state.session.currentPromptId;
      recognition.lang = state.session.language; recognition.interimResults = true; recognition.continuous = false;
      let final = '';
      recognition.onresult = event => { if (recognition !== instance || !dictationCurrent(token)) return; for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) final += event.results[i][0].transcript + ' '; };
      recognition.onend = async () => {
        clearTimeout(recognitionTimer);
        if (v !== version || recognition !== instance || !dictationCurrent(token)) { if (dictation === token) devices.cancelDictation(); return; }
        recognition = null; store.speech({ recording: 'transcribing' });
        try { if (final.trim() && store.snapshot().session?.currentPromptId === promptId) await store.transcribe(final.trim(), () => dictationCurrent(token)); else report(new Error('No speech was recognized. Dictate your answer again.')); }
        finally { if (dictation === token) { dictation = null; store.speech({ recording: 'idle' }); } }
      };
      recognition.onerror = event => { if (v === version && recognition === instance) { devices.cancelDictation(); report(new Error(`Dictation stopped: ${event.error}. Your answer has not been submitted.`)); } };
      try {
        recognition.start(); store.speech({ recording: 'recording' });
        recognitionTimer = setTimeout(() => devices.stop(), Math.min(state.session.speech.maxAudioSeconds || 180, (Date.parse(state.session.endsAt) - Date.now()) / 1000) * 1000);
      } catch (error) { devices.cancelDictation(); report(error); }
    },
    stop() { recognition?.stop(); recording?.stop(); },
  };
  return devices;
}
