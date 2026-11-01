import * as tf from '@tensorflow/tfjs';
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch';

self.onmessage = async ({ data }) => {
  let graph;
  try {
    // A worker keeps the editor responsive on devices without GPU acceleration.
    await tf.setBackend('cpu'); await tf.ready();
    const model = new BasicPitch(`${data.base}models/basic-pitch/model.json`);
    graph = await model.model;
    tf.engine().startScope();
    try {
      const frames = [], onsets = [];
      await model.evaluateModel(data.samples, (f, o) => { frames.push(...f); onsets.push(...o); }, p => self.postMessage({ progress: `간주 음표 분석 중 · ${Math.round(p * 100)}%` }));
      self.postMessage({ result: noteFramesToTime(outputToNotesPoly(frames, onsets, .35, .3, 7)) });
    } finally { tf.engine().endScope(); }
  } catch (error) { self.postMessage({ error: error.message || '간주 채보를 완료하지 못했습니다.' }); }
  finally { graph?.dispose(); }
};
