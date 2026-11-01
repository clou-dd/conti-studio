import * as tf from '@tensorflow/tfjs';
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch';
import { AUDIO_RATE, notesToDraft, planTranscriptionChunks } from './audio-core.mjs';
import { resampleTo22050 } from './vendor/linkseg/resample';

self.onmessage = async ({ data }) => {
  let graph;
  try {
    // A worker keeps the editor responsive on devices without GPU acceleration.
    await tf.setBackend('cpu'); await tf.ready();
    const model = new BasicPitch(`${data.base}models/basic-pitch/1.0.1/model.json`);
    graph = await model.model;
    const samples = await resampleTo22050(data.samples, data.sampleRate || AUDIO_RATE);
    async function infer(clip, label) {
      tf.engine().startScope();
      try {
        const frames = [], onsets = [];
        await model.evaluateModel(clip, (f, o) => { frames.push(...f); onsets.push(...o); }, p => self.postMessage({ progress: `${label} · ${Math.round(p * 100)}%` }));
        return noteFramesToTime(outputToNotesPoly(frames, onsets, .35, .3, 7));
      } finally { tf.engine().endScope(); }
    }
    if (!data.whole) {
      self.postMessage({ result: await infer(samples, '간주 음표 분석 중') });
    } else {
      const chunks = planTranscriptionChunks(samples.length / AUDIO_RATE, data.bpm, data.meter), drafts = [];
      for (let i = 0; i < chunks.length; i++) {
        const { start, end } = chunks[i];
        const events = await infer(samples.subarray(Math.floor(start * AUDIO_RATE), Math.floor(end * AUDIO_RATE)), `전체 채보 ${i + 1}/${chunks.length}구간`);
        drafts.push({ start, end, ...notesToDraft(events, { bpm: data.bpm, meter: data.meter, duration: end - start }) });
      }
      if (!drafts.some(d => d.noteCount)) throw new Error('음표를 찾지 못했습니다. 음원을 확인하거나 선택 구간 채보를 사용해 주세요.');
      self.postMessage({ result: drafts });
    }
  } catch (error) { self.postMessage({ error: error.message || '간주 채보를 완료하지 못했습니다.' }); }
  finally { graph?.dispose(); }
};
