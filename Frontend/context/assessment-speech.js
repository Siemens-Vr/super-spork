const recordingTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
export function voiceCapability(speech, runtime = globalThis) {
  if (speech?.stt === 'browser') return { available: !!(runtime.SpeechRecognition || runtime.webkitSpeechRecognition), reason: 'Browser dictation is unavailable in this browser.' };
  if (speech?.stt === 'compatible') {
    const Recorder = runtime.MediaRecorder, Context = runtime.AudioContext || runtime.webkitAudioContext;
    const mimeType = Recorder?.isTypeSupported ? recordingTypes.find(type => Recorder.isTypeSupported(type)) : undefined;
    return { available: !!(Recorder && Context && (!Recorder.isTypeSupported || mimeType)), mimeType, reason: 'Voice recording is unavailable in this browser.' };
  }
  return { available: false, reason: 'Voice transcription is disabled by the assessment provider.' };
}

// Uploads use the backend's supported mono, 16-bit PCM WAV format at 16 kHz.
export function encodePcmWav(audio, speech) {
  const rate = 16000, frames = Math.round(audio.length * rate / audio.sampleRate);
  const maxBytes = speech.maxAudioBytes, maxSeconds = speech.maxAudioSeconds;
  if (!Number.isFinite(maxBytes) || !Number.isFinite(maxSeconds) || maxBytes <= 44 || maxSeconds <= 0) throw new Error('The assessment audio limits are unavailable. Reload the saved session.');
  if (!audio.numberOfChannels || !Number.isFinite(frames) || frames < 1) throw new Error('The recording contains no usable audio. Record your answer again.');
  if (frames > rate * maxSeconds || 44 + frames * 2 > maxBytes) throw new Error('The recording exceeds the assessment audio limit. Record a shorter answer.');
  const buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = 0; i < frames; i++) {
    const position = i * audio.sampleRate / rate, left = Math.min(Math.floor(position), audio.length - 1), right = Math.min(left + 1, audio.length - 1), mix = position - left;
    const value = channels.reduce((sum, channel) => sum + channel[left] * (1 - mix) + channel[right] * mix, 0) / channels.length;
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function createServerRecording({ stream, speech, isCurrent, onState, onAudio, onError, runtime = globalThis }) {
  let recorder, chunks = [], bytes = 0, timer, decoder, cancelled = false;
  const current = () => !cancelled && isCurrent();
  const closeDecoder = () => { const context = decoder; decoder = null; if (context) void context.close().catch(() => {}); };
  const clear = () => { runtime.clearTimeout(timer); chunks = []; closeDecoder(); };
  const fail = error => { const show = current(); control.cancel(); if (show) { onState('idle'); onError(error); } };
  const control = {
    start() {
      const capability = voiceCapability(speech, runtime);
      if (!capability.available) throw new Error(capability.reason);
      if (!(speech.maxAudioBytes > 44) || !(speech.maxAudioSeconds > 0)) throw new Error('The assessment audio limits are unavailable. Reload the saved session.');
      recorder = new runtime.MediaRecorder(stream, capability.mimeType ? { mimeType: capability.mimeType } : undefined);
      recorder.ondataavailable = event => {
        if (!current()) return;
        bytes += event.data.size;
        if (bytes > speech.maxAudioBytes) { fail(new Error('The recording exceeds the audio size limit. Record a shorter answer.')); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => fail(new Error('Microphone recording failed. Your answer has not been submitted. Record it again.'));
      recorder.onstop = async () => {
        runtime.clearTimeout(timer);
        if (!current()) { clear(); return; }
        onState('transcribing');
        try {
          if (!chunks.length) throw new Error('No audio was recorded. Record your answer again.');
          const source = new Blob(chunks, { type: recorder.mimeType }); chunks = [];
          const Context = runtime.AudioContext || runtime.webkitAudioContext;
          decoder = new Context({ sampleRate: 16000 });
          const audio = await decoder.decodeAudioData(await source.arrayBuffer());
          if (!current()) return;
          const wav = encodePcmWav(audio, speech);
          if (current()) await onAudio(wav);
        } catch (error) { if (current()) onError(new Error(`Unable to transcribe this recording. ${error.message}`)); }
        finally { clear(); if (!cancelled) onState('idle'); }
      };
      recorder.start(1000);
      onState('recording');
      if (!current()) { control.cancel(); return; }
      const duration = Math.min(speech.maxAudioSeconds, (speech.maxAudioBytes - 44) / 32000) * 1000;
      // Leave room for recorder/codec padding so a limit-length answer remains valid PCM.
      timer = runtime.setTimeout(() => control.stop(), Math.max(1, duration - 250));
    },
    stop() { if (recorder?.state === 'recording') { onState('transcribing'); recorder.stop(); } },
    cancel() {
      cancelled = true;
      if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== 'inactive') recorder.stop(); }
      clear();
    },
  };
  return control;
}
