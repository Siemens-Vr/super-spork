/* global window, document, navigator, fetch, location, crypto, Audio, AudioContext, Blob, FormData, MediaRecorder, URL, SpeechSynthesisUtterance, requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout */
const $ = (id) => document.getElementById(id);
let bookingId,
  preflight,
  session,
  cameraStream,
  micStream,
  analyser,
  audioContext,
  levelFrame,
  recognition,
  recorder,
  recordingTimer,
  transcriptId,
  responseKey,
  testUrl,
  playingAudio,
  pendingText,
  offline = false;
let cameraGeneration = 0,
  micGeneration = 0;
let cameraState = 'NOT_REQUESTED',
  micState = 'NOT_REQUESTED',
  muted = false,
  origin = 'TEXT',
  speechActive = false;
const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
};
async function api(path, body, key) {
  const headers = {};
  if (body !== undefined) {
    const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' }).then((r) =>
      r.json(),
    );
    headers['X-CSRF-Token'] = csrf.data.csrfToken;
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
  }
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (response.status === 401) {
    location.assign('/dev/assessment-login');
    throw new Error('Sign in again');
  }
  if (!response.ok) {
    const result = await response.json();
    throw new Error(
      `${result.error?.code ?? response.status}: ${result.error?.message ?? 'Request failed'}`,
    );
  }
  if (response.headers.get('content-type')?.startsWith('audio/')) return response.blob();
  return (await response.json()).data;
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    const button = $(id);
    button.disabled = true;
    try {
      await fn();
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
      if (session) {
        $('submit').disabled = !session.currentPromptId || session.hasPendingResponse;
        $('speak').disabled = !session.currentPromptId || speechActive;
        $('finish-speaking').disabled = !speechActive;
      }
    }
  });
}
async function loadBookings() {
  const rows = await api('/assessments/bookings?limit=100');
  $('bookings').replaceChildren();
  for (const row of rows) {
    const option = document.createElement('option');
    option.value = row.bookingId;
    option.textContent = `${row.jobRole.title} · ${new Date(row.startsAt).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })} EAT · ${row.status}`;
    $('bookings').append(option);
  }
  const path = location.pathname.match(/\/assessments\/([^/]+)\/take$/);
  if (path) $('bookings').value = path[1];
  status(
    rows.length
      ? 'Select a booking and click Take Assessment.'
      : 'No bookings found. Prepare a target and book a slot in Swagger.',
  );
}
action('reload', loadBookings);
action('preflight', async () => {
  bookingId = $('bookings').value;
  if (!bookingId) throw new Error('Select a booking first');
  preflight = await api(`/assessments/${bookingId}/preflight`);
  $('setup').hidden = false;
  $('booking-info').textContent = JSON.stringify(
    {
      startsAt: preflight.startsAt,
      endsAt: preflight.endsAt,
      canStart: preflight.canStart,
      session: preflight.session,
    },
    null,
    2,
  );
  $('privacy').textContent = Object.values(preflight.privacy).join(' ');
  $('policy').textContent =
    `Camera ${preflight.policy.cameraRequired ? 'required' : 'optional'}. Microphone ${preflight.policy.microphoneRequired ? 'required' : 'optional'}. ${preflight.policy.cameraPurpose ?? ''} ${preflight.policy.accommodationInstructions}`;
  $('provider').textContent =
    `Interviewer ${preflight.aiReady ? 'configured' : 'unavailable'}. STT: ${preflight.speech.stt}. TTS: ${preflight.speech.tts}.`;
  if (preflight.session) {
    render(await api(`/assessment-sessions/${preflight.session.id}`));
    return;
  }
  status(
    preflight.canStart
      ? 'Complete device checks and explicitly confirm start.'
      : 'You can test devices now. The assessment can start only during the booked time.',
  );
});
async function devices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const list = await navigator.mediaDevices.enumerateDevices();
  for (const [kind, id, stream] of [
    ['videoinput', 'camera-select', cameraStream],
    ['audioinput', 'microphone-select', micStream],
  ]) {
    const select = $(id);
    const current = stream?.getTracks()[0]?.getSettings().deviceId ?? select.value;
    select.replaceChildren();
    for (const d of list.filter((d) => d.kind === kind)) {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || `${kind} device`;
      select.append(option);
    }
    if (current) select.value = current;
  }
}
function requestMedia(constraints) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      const error = new Error(
        'Permission is still pending. Check the browser prompt or continue in text mode.',
      );
      error.name = 'PermissionPendingError';
      reject(error);
    }, 20000);
    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        clearTimeout(timer);
        if (settled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        settled = true;
        resolve(stream);
      },
      (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    );
  });
}
function permissionError(error) {
  return error.name === 'PermissionPendingError'
    ? 'NOT_REQUESTED'
    : error.name === 'NotAllowedError'
      ? 'DENIED'
      : 'UNAVAILABLE';
}
function stopCamera() {
  cameraGeneration++;
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = undefined;
  $('preview').srcObject = null;
  cameraState = 'NOT_REQUESTED';
  $('camera-status').textContent = 'Camera inactive';
}
function stopMic() {
  micGeneration++;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = undefined;
  micState = 'NOT_REQUESTED';
  $('microphone-status').textContent = 'Microphone inactive';
  cancelAnimationFrame(levelFrame);
  $('level').value = 0;
  audioContext?.close();
  audioContext = undefined;
}
async function camera() {
  stopCamera();
  const generation = cameraGeneration;
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access requires localhost or HTTPS and a supported browser');
    cameraStream = await requestMedia({
      video: $('camera-select').value ? { deviceId: { exact: $('camera-select').value } } : true,
      audio: false,
    });
    if (generation !== cameraGeneration) {
      cameraStream.getTracks().forEach((t) => t.stop());
      return;
    }
    $('preview').srcObject = cameraStream;
    cameraState = 'READY';
    $('camera-status').textContent = 'Camera active · local preview only';
    cameraStream.getVideoTracks()[0].addEventListener('ended', () => {
      cameraState = 'UNAVAILABLE';
      $('camera-status').textContent = 'Camera disconnected';
      event('DEVICE_DISCONNECTED', 'camera');
    });
    await devices();
  } catch (error) {
    cameraState = permissionError(error);
    $('camera-status').textContent = `Camera ${cameraState.toLowerCase()}: ${error.message}`;
    throw error;
  }
}
function meter() {
  if (!analyser) return;
  const values = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(values);
  let sum = 0;
  for (const value of values) sum += (value - 128) ** 2;
  $('level').value = muted ? 0 : Math.min(100, Math.sqrt(sum / values.length) * 4);
  levelFrame = requestAnimationFrame(meter);
}
async function microphone() {
  stopMic();
  const generation = micGeneration;
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Microphone access requires localhost or HTTPS');
    micStream = await requestMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...($('microphone-select').value
          ? { deviceId: { exact: $('microphone-select').value } }
          : {}),
      },
    });
    if (generation !== micGeneration) {
      micStream.getTracks().forEach((t) => t.stop());
      return;
    }
    micState = 'READY';
    muted = false;
    $('microphone-status').textContent = 'Microphone active';
    audioContext = new AudioContext();
    await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(micStream).connect(analyser);
    meter();
    micStream.getAudioTracks()[0].addEventListener('ended', () => {
      micState = 'UNAVAILABLE';
      $('microphone-status').textContent = 'Microphone disconnected';
      finishSpeaking();
      event('DEVICE_DISCONNECTED', 'microphone');
    });
    await devices();
  } catch (error) {
    micState = permissionError(error);
    $('microphone-status').textContent = `Microphone ${micState.toLowerCase()}: ${error.message}`;
    throw error;
  }
}
action('camera', camera);
action('microphone', microphone);
action('stop-camera', stopCamera);
action('stop-microphone', stopMic);
$('camera-select').addEventListener('change', () => camera().catch((e) => status(e.message, true)));
$('microphone-select').addEventListener('change', () =>
  microphone().catch((e) => status(e.message, true)),
);
navigator.mediaDevices?.addEventListener('devicechange', () =>
  devices().catch((e) => status(e.message, true)),
);
action('mute-microphone', () => {
  muted = !muted;
  micStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  $('microphone-status').textContent = muted ? 'Microphone muted' : 'Microphone active';
  if (muted) {
    finishSpeaking();
    event('MICROPHONE_MUTED', 'microphone');
  }
});
function cancelSpeech() {
  window.speechSynthesis?.cancel();
  playingAudio?.pause();
  if (playingAudio?.src?.startsWith('blob:')) URL.revokeObjectURL(playingAudio.src);
  playingAudio = undefined;
}
action('speaker-test', async () => {
  const ctx = new AudioContext();
  try {
    await ctx.resume();
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    await new Promise((resolve) => setTimeout(resolve, 700));
    oscillator.stop();
    status('If you heard the tone, check “I heard the test sound”.');
  } catch (error) {
    event('PLAYBACK_FAILED', 'speaker');
    throw error;
  } finally {
    await ctx.close();
  }
});
async function recordLocal(seconds) {
  if (micState !== 'READY' || muted) throw new Error('Enable and unmute the microphone first');
  if (!$('audio-consent').checked)
    throw new Error('Confirm audio processing before recording a microphone test');
  return new Promise((resolve, reject) => {
    const chunks = [];
    const capture = new MediaRecorder(micStream);
    capture.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    capture.onerror = () => reject(new Error('Microphone recording failed'));
    capture.onstop = () => resolve(new Blob(chunks, { type: capture.mimeType }));
    capture.start();
    setTimeout(() => {
      if (capture.state !== 'inactive') capture.stop();
    }, seconds * 1000);
  });
}
action('mic-test', async () => {
  const blob = await recordLocal(3);
  if (testUrl) URL.revokeObjectURL(testUrl);
  testUrl = URL.createObjectURL(blob);
  $('play-test').disabled = false;
  status('Local microphone test ready for playback. No audio was uploaded.');
});
action('play-test', async () => {
  if (testUrl) {
    playingAudio = new Audio(testUrl);
    await playingAudio.play();
  }
});
action('start', async () => {
  if (!preflight) throw new Error('Load preflight first');
  if (!$('privacy-ack').checked || !$('start-confirmed').checked)
    throw new Error('Read the privacy notice and explicitly confirm start');
  const started = await api(`/assessments/${bookingId}/start`, {
    confirmed: true,
    mode: $('mode').value,
    devices: {
      camera: cameraState,
      microphone: micState,
      speakerConfirmed: $('speaker-confirmed').checked,
    },
    privacyAcknowledged: true,
    audioProcessingConsent: $('audio-consent').checked,
  });
  render(started);
  await speakPrompt();
});
function render(value) {
  session = value;
  $('interview').hidden = false;
  $('messages').replaceChildren();
  for (const message of session.messages) {
    const item = document.createElement('div');
    item.className = `message ${message.role === 'APPLICANT' ? 'applicant' : ''}`;
    item.textContent = `${message.role === 'AI' ? 'Interviewer' : 'You'}\n${message.text}`;
    $('messages').append(item);
  }
  $('progress').textContent =
    `${session.status} · ${session.progress.completedScenarios}/${session.progress.totalScenarios} scenarios complete · ends ${new Date(session.endsAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi' })} EAT`;
  $('submit').disabled = !session.currentPromptId || session.hasPendingResponse;
  const finished = ['AWAITING_REVIEW', 'COMPLETED'].includes(session.status);
  $('speak').disabled = finished;
  $('finish-speaking').disabled = true;
  if (finished) {
    stopCamera();
    stopMic();
  }
  status(
    session.hasPendingResponse
      ? 'Your answer is saved. Use Resume to recover its processing.'
      : `Assessment session ${session.status.toLowerCase().replaceAll('_', ' ')}.`,
  );
}
async function speakPrompt() {
  if (!$('mute-ai').checked && session?.messages.length) {
    cancelSpeech();
    try {
      const latest = [...session.messages].reverse().find((m) => m.role === 'AI');
      const output = await api(`/assessment-sessions/${session.id}/speech/synthesize`, {
        messageId: latest.id,
      });
      if (output instanceof Blob) {
        playingAudio = new Audio(URL.createObjectURL(output));
        await playingAudio.play();
      } else {
        if (!window.speechSynthesis) throw new Error('Browser speech synthesis is unavailable');
        await new Promise((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(output.text);
          utterance.lang = output.language;
          utterance.onend = resolve;
          utterance.onerror = (event) =>
            event.error === 'canceled' || event.error === 'interrupted'
              ? resolve()
              : reject(new Error('Speech playback failed; use Replay or read the text'));
          window.speechSynthesis.speak(utterance);
        });
      }
    } catch (error) {
      event('PLAYBACK_FAILED', 'speaker');
      status(`${error.message}. You can continue with the visible text.`, true);
    }
  }
}
action('replay', speakPrompt);
$('mute-ai').addEventListener('change', () => {
  if ($('mute-ai').checked) cancelSpeech();
});
async function saveTranscript(text) {
  if (!text.trim()) throw new Error('No final speech was recognized. Retry or type your answer.');
  const row = await api(`/assessment-sessions/${session.id}/audio/transcribe`, {
    text,
    isFinal: true,
    language: session.language,
  });
  transcriptId = row.id;
  origin = 'VOICE';
  $('answer').value = row.originalText;
  $('transcription-info').textContent =
    'Final transcription received. Correct any technical terms or units, then confirm your answer.';
  $('answer-confirmed').checked = false;
}
function finishSpeaking() {
  clearTimeout(recordingTimer);
  recognition?.stop();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  $('finish-speaking').disabled = true;
}
function encodeWav(audio) {
  const count = audio.length,
    rate = audio.sampleRate,
    buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const string = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  string(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  string(8, 'WAVE');
  string(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  string(36, 'data');
  view.setUint32(40, count * 2, true);
  const data = audio.getChannelData(0);
  for (let i = 0; i < count; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
action('speak', async () => {
  if (!session?.currentPromptId) throw new Error('Start or resume an assessment first');
  if (!$('audio-consent').checked) throw new Error('Confirm audio processing before speaking');
  if (micState !== 'READY' || muted) throw new Error('Enable and unmute your microphone');
  if (speechActive) throw new Error('Finish the current recording first');
  cancelSpeech();
  transcriptId = undefined;
  responseKey = undefined;
  origin = 'TEXT';
  $('answer-confirmed').checked = false;
  $('answer').value = '';
  $('partial').textContent = '';
  $('recording').textContent = 'Microphone active · recording response';
  $('finish-speaking').disabled = false;
  speechActive = true;
  const config = session.speech;
  if (config.stt === 'browser') {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      speechActive = false;
      $('recording').textContent = '';
      throw new Error(
        'This browser does not support speech recognition. Type your response or configure server STT.',
      );
    }
    recognition = new Recognition();
    recognition.lang = session.language;
    recognition.interimResults = true;
    recognition.continuous = true;
    let final = '';
    recognition.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
        else partial += e.results[i][0].transcript;
      }
      $('partial').textContent = `Unconfirmed speech: ${final}${partial}`;
    };
    recognition.onerror = (e) =>
      status(`Speech recognition ${e.error}. Retry or type your answer.`, true);
    recognition.onend = async () => {
      speechActive = false;
      clearTimeout(recordingTimer);
      $('recording').textContent = '';
      $('finish-speaking').disabled = true;
      try {
        await saveTranscript(final);
      } catch (error) {
        status(error.message, true);
      }
    };
    recognition.start();
    recordingTimer = setTimeout(finishSpeaking, config.maxAudioSeconds * 1000);
  } else if (config.stt === 'compatible') {
    const chunks = [];
    recorder = new MediaRecorder(micStream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      speechActive = false;
      clearTimeout(recordingTimer);
      $('recording').textContent = 'Transcribing…';
      const ctx = new AudioContext({ sampleRate: 16000 });
      try {
        const audio = await ctx.decodeAudioData(
          await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer(),
        );
        const form = new FormData();
        form.set('audio', encodeWav(audio), 'response.wav');
        const row = await api(`/assessment-sessions/${session.id}/audio/transcribe`, form);
        transcriptId = row.id;
        origin = 'VOICE';
        $('answer').value = row.originalText;
        $('transcription-info').textContent =
          'Review and correct your transcript before confirming.';
      } catch (error) {
        status(`${error.message}. You can type your answer.`, true);
      } finally {
        $('recording').textContent = '';
        await ctx.close();
      }
    };
    recorder.start();
    recordingTimer = setTimeout(finishSpeaking, config.maxAudioSeconds * 1000);
  } else {
    speechActive = false;
    $('recording').textContent = '';
    throw new Error('Speech recognition is disabled. Type your response.');
  }
});
action('finish-speaking', finishSpeaking);
$('answer').addEventListener('input', () => {
  responseKey = undefined;
  $('answer-confirmed').checked = false;
});
action('submit', async () => {
  if (speechActive)
    throw new Error('Finish speaking and review the final transcription before submitting');
  if (!$('answer-confirmed').checked) throw new Error('Confirm your complete answer first');
  const text = $('answer').value.trim();
  if (!text) throw new Error('Enter an answer');
  responseKey ??= crypto.randomUUID();
  pendingText = {
    promptId: session.currentPromptId,
    origin,
    confirmed: true,
    text,
    ...(transcriptId ? { transcriptionId: transcriptId } : {}),
  };
  try {
    render(await api(`/assessment-sessions/${session.id}/responses`, pendingText, responseKey));
    $('answer').value = '';
    $('answer-confirmed').checked = false;
    $('transcription-info').textContent = '';
    transcriptId = undefined;
    origin = 'TEXT';
    responseKey = undefined;
    pendingText = undefined;
    await speakPrompt();
  } catch (error) {
    if (error.message.includes('SESSION_BUSY'))
      status('Your turn is processing. Wait, then Resume.', true);
    throw error;
  }
});
action('resume', async () => {
  if (!session) throw new Error('Load the selected booking first');
  render(await api(`/assessment-sessions/${session.id}/resume`, {}));
  if (!session.hasPendingResponse) {
    if (
      pendingText &&
      session.messages.some((m) => m.role === 'APPLICANT' && m.text === pendingText.text)
    ) {
      $('answer').value = '';
      $('answer-confirmed').checked = false;
      $('transcription-info').textContent = '';
      transcriptId = undefined;
      origin = 'TEXT';
    }
    pendingText = undefined;
    responseKey = undefined;
  }
  await speakPrompt();
});
action('results', async () => {
  if (!session) throw new Error('Start or load an assessment first');
  $('report').textContent = JSON.stringify(
    await api(`/assessment-sessions/${session.id}/results`),
    null,
    2,
  );
});
async function event(kind, device) {
  if (session) {
    try {
      await api(`/assessment-sessions/${session.id}/events`, { kind, device });
    } catch {
      /* Report on reconnect if the network is unavailable. */
    }
  }
}
function stopAll() {
  finishSpeaking();
  cancelSpeech();
  stopCamera();
  stopMic();
  if (testUrl) {
    URL.revokeObjectURL(testUrl);
    testUrl = undefined;
  }
}
action('stop-devices', stopAll);
window.addEventListener('pagehide', stopAll);
window.addEventListener('offline', () => {
  offline = true;
  status('Network disconnected. Your confirmed responses and checkpoints remain saved.', true);
});
window.addEventListener('online', async () => {
  if (offline && session) {
    offline = false;
    await event('DISCONNECTED', 'network');
    try {
      render(await api(`/assessment-sessions/${session.id}/resume`, {}));
    } catch (error) {
      status(error.message, true);
    }
  }
});
if (!window.isSecureContext) status('Use localhost or HTTPS for media permissions.', true);
loadBookings().catch((error) => status(error.message, true));
