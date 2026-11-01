import { AUDIO_RATE, MAX_AUDIO_SECONDS } from './audio-core.mjs';
export const audioBase = () => new URL(import.meta.env.BASE_URL, window.location.href).href;
export async function decodeAudio(file) {
  if (file.size > 80 * 1024 * 1024) throw new Error('음원 파일은 80MB까지 선택해 주세요.');
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > MAX_AUDIO_SECONDS) throw new Error('브라우저 분석은 10분까지 지원합니다. 곡별로 나눈 음원을 선택해 주세요.');
    if (buffer.duration < 3) throw new Error('3초 이상의 음원을 선택해 주세요.');
    const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * AUDIO_RATE), AUDIO_RATE);
    const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
    const mono = await offline.startRendering();
    return { samples: mono.getChannelData(0).slice(), sampleRate: AUDIO_RATE, duration: mono.duration, name: file.name };
  } finally { await context.close(); }
}
export function audioWav(samples, sampleRate = AUDIO_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function captureTab(onProgress, onEnded) {
  let stream, context, node, source, sink, stopped = false, stopping = false, flushDone;
  const chunks = []; let sampleCount = 0;
  const stopTracks = () => stream?.getTracks().forEach(t => t.stop());
  const stop = async () => {
    if (stopped || stopping) return null;
    stopping = true;
    if (node) await new Promise(resolve => { const timer = setTimeout(resolve, 500); flushDone = () => { clearTimeout(timer); resolve(); }; node.port.postMessage('flush'); });
    stopped = true; node?.disconnect(); source?.disconnect(); sink?.disconnect(); stopTracks();
    if (context && context.state !== 'closed') await context.close();
    const samples = new Float32Array(sampleCount); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return { samples, sampleRate: context?.sampleRate || AUDIO_RATE, duration: sampleCount / (context?.sampleRate || AUDIO_RATE), name: '유튜브 탭에서 가져온 소리' };
  };
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('이 브라우저는 탭 소리 공유를 지원하지 않습니다. PC Chrome·Edge에서 사용하거나 음원 파일을 선택해 주세요.');
    // Called directly from the user's click; browser consent is always required.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { suppressLocalAudioPlayback: false }, preferCurrentTab: true });
    if (!stream.getAudioTracks().length) throw new Error('탭 오디오가 선택되지 않았습니다. ‘탭 오디오 공유’를 켜고 다시 선택해 주세요.');
    const Context = window.AudioContext || window.webkitAudioContext;
    context = new Context({ sampleRate: AUDIO_RATE });
    await context.audioWorklet.addModule(`${audioBase()}audio-capture.js`);
    await context.resume();
    source = context.createMediaStreamSource(stream); node = new AudioWorkletNode(context, 'conti-audio-capture');
    sink = context.createGain(); sink.gain.value = 0; source.connect(node); node.connect(sink); sink.connect(context.destination);
    node.port.onmessage = ({ data }) => {
      if (data.flushed) { flushDone?.(); return; }
      if (stopped) return;
      chunks.push(data); sampleCount += data.length; onProgress(sampleCount / context.sampleRate);
      if (!stopping && sampleCount / context.sampleRate >= MAX_AUDIO_SECONDS) onEnded();
    };
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!stopped) onEnded(); }, { once: true });
    return { stop, cancel: stop };
  } catch (error) {
    await stop();
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') throw new Error('소리 공유가 취소되었습니다. 다시 연결하거나 음원 파일을 선택할 수 있습니다.');
    throw error;
  }
}

export function transcribeClip(samples, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcription.worker.js', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('채보를 중단했습니다.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('채보 시간이 길어 중단했습니다. 더 짧은 간주 구간으로 다시 시도해 주세요.')); }, 180000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onmessage = ({ data }) => {
      if (data.progress) onProgress(data.progress);
      else { cleanup(); data.error ? reject(new Error(data.error)) : resolve(data.result); }
    };
    worker.onerror = () => { cleanup(); reject(new Error('채보 모델을 실행하지 못했습니다. 브라우저를 확인하거나 구간을 줄여 주세요.')); };
    worker.postMessage({ samples, base: audioBase() }, [samples.buffer]);
  });
}
