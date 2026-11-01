// Resample arbitrary-rate mono audio to LinkSeg's 22050 Hz. Only used when the caller passes audio
// at a different rate — the product path feeds 22050 directly (no resample, byte-exact), and the
// demo decodes through an OfflineAudioContext at 22050. This is the fallback for other inputs.
//
// Prefers the browser's high-quality OfflineAudioContext resampler; falls back to linear
// interpolation off the main thread (e.g. in Node/tests) where no AudioContext exists.

import {LINKSEG_SR} from './mel';

async function resampleViaOfflineContext(
  audio: Float32Array,
  sampleRate: number,
): Promise<Float32Array | null> {
  const OAC =
    (globalThis as any).OfflineAudioContext ?? (globalThis as any).webkitOfflineAudioContext;
  if (!OAC) return null;
  const frames = Math.ceil((audio.length * LINKSEG_SR) / sampleRate);
  const ctx = new OAC(1, frames, LINKSEG_SR);
  const buf = ctx.createBuffer(1, audio.length, sampleRate);
  buf.copyToChannel(audio, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

function resampleLinear(audio: Float32Array, sampleRate: number): Float32Array {
  const ratio = LINKSEG_SR / sampleRate;
  const outLen = Math.round(audio.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, audio.length - 1);
    const frac = pos - i0;
    out[i] = audio[i0] * (1 - frac) + audio[i1] * frac;
  }
  return out;
}

/** Resample `audio` (mono) from `sampleRate` to 22050 Hz. Returns the input unchanged at 22050. */
export async function resampleTo22050(
  audio: Float32Array,
  sampleRate: number,
): Promise<Float32Array> {
  if (sampleRate === LINKSEG_SR) return audio;
  const viaCtx = await resampleViaOfflineContext(audio, sampleRate);
  return viaCtx ?? resampleLinear(audio, sampleRate);
}

