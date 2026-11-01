import * as ort from 'onnxruntime-web/wasm';
import { LinkSeg } from './vendor/linkseg/linkseg';
import { estimateBeats, SECTION_NAMES } from './audio-core.mjs';
let model;
self.onmessage = async ({ data }) => {
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = `${data.base}wasm/`;
    self.postMessage({ progress: 'BPM과 박자 위치 추정 중…' });
    const { bpm, beats } = estimateBeats(data.samples, data.sampleRate, data.bpm);
    if (beats.length > 1500) throw new Error('이 음원은 브라우저 분석 범위를 넘습니다. 더 짧은 구간을 선택해 주세요.');
    self.postMessage({ progress: '송폼 모델 준비 중…' });
    model ||= await LinkSeg.load({ backend: 'wasm', onProgress: e => self.postMessage({ progress: e.phase === 'ready' ? '송폼 분석 중…' : `송폼 모델 내려받는 중 · ${(e.loaded / 1e6).toFixed(1)} MB` }) });
    self.postMessage({ progress: '반복과 구간의 역할 분석 중…' });
    const sections = await model.analyze({ audio: data.samples, sampleRate: data.sampleRate, beats, peakWindowSeconds: 6, mergeRepeatedLabels: true });
    if (!sections.length) throw new Error('구간을 찾지 못했습니다. 더 긴 음원이나 다른 BPM으로 다시 분석해 주세요.');
    self.postMessage({ result: { bpm, sections: sections.map(s => ({ ...s, originalLabel: s.label, label: SECTION_NAMES[s.label] || s.label })) } });
  } catch (error) {
    self.postMessage({ error: error.message || '분석을 완료하지 못했습니다.' });
  }
};
