// Browser-only audio draft helpers. Beat estimates assume a steady tempo;
// users can correct BPM and boundaries before applying anything to the score.
import { keySignature } from './key-analysis.mjs';
export const AUDIO_RATE = 22050;
export const MAX_AUDIO_SECONDS = 600;
export const SECTION_NAMES = { Intro: 'Intro', Verse: 'A', Chorus: 'B', Bridge: 'C', Instrumental: 'Inter', Outro: 'Out', Silence: '쉼' };
export const timeLabel = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${(Math.max(0, seconds) % 60).toFixed(1).padStart(4, '0')}`;

export function planTranscriptionChunks(duration, bpm, meter = '4/4') {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS + 1 || !Number.isFinite(bpm) || bpm < 40 || bpm > 240 || !['4/4','3/4','6/8','12/8','2/4'].includes(meter)) throw new Error('음원 길이·BPM·박자를 확인해 주세요.');
  const [numerator, denominator] = meter.split('/').map(Number);
  const secondsPerBar = numerator * 4 / denominator * 60 / bpm;
  const barsPerChunk = Math.max(1, Math.min(16, Math.floor(60 / secondsPerBar)));
  const chunkSeconds = barsPerChunk * secondsPerBar, chunks = [];
  for (let i = 0; i * chunkSeconds < duration - .001; i++) {
    chunks.push({ start: i * chunkSeconds, end: Math.min(duration, (i + 1) * chunkSeconds) });
  }
  return chunks;
}

export function estimateBeats(audio, sampleRate = AUDIO_RATE, bpmOverride = 0) {
  const fps = 100, hop = Math.round(sampleRate / fps), envelope = [];
  for (let pos = 0; pos + hop * 2 < audio.length; pos += hop) {
    let energy = 0;
    for (let i = pos; i < pos + hop * 2; i++) energy += audio[i] ** 2;
    envelope.push(Math.log1p(energy));
  }
  const novelty = envelope.map((value, i) => i ? Math.max(0, value - envelope[i - 1]) : 0);
  const energy = novelty.reduce((sum, n) => sum + n * n, 0);
  if (energy < 1e-8 && !bpmOverride) throw new Error('박자를 추정할 소리가 부족합니다. 음원을 확인하거나 BPM을 직접 입력해 주세요.');
  let period = 60 * fps / bpmOverride, bestScore = -Infinity;
  if (!bpmOverride) {
    for (let lag = 30; lag <= 100; lag++) {
      let correlation = 0;
      for (let i = lag; i < novelty.length; i++) correlation += novelty[i] * novelty[i - lag];
      const score = correlation * Math.exp(-.5 * (Math.log(60 * fps / lag / 120) / .5) ** 2);
      if (score > bestScore) { bestScore = score; period = lag; }
    }
  }
  if (!Number.isFinite(period) || period <= 0) throw new Error('BPM을 확인해 주세요.');
  let phase = 0, phaseScore = -Infinity;
  for (let candidate = 0; candidate < period; candidate++) {
    let score = 0;
    for (let i = candidate; i < novelty.length; i += period) score += novelty[Math.round(i)] || 0;
    if (score > phaseScore) { phase = candidate; phaseScore = score; }
  }
  const beats = [], duration = audio.length / sampleRate;
  for (let t = phase / fps; t < duration; t += period / fps) beats.push(t);
  return { bpm: 60 * fps / period, beats };
}

export function sectionsToForm(sections, bpm, beatsPerBar = 4) {
  return sections.filter(s => s.label !== '쉼').map(s => {
    const bars = Math.max(1, Math.round((s.end - s.start) * bpm / 60 / beatsPerBar));
    return { label: `${s.label}(${bars})`, note: `${timeLabel(s.start)}–${timeLabel(s.end)} · 마디 수 추정`, color: /Intro|Inter/.test(s.label) ? '#fff0a6' : /Out/.test(s.label) ? '#f7def0' : '' };
  });
}

const PITCHES = ['=C', '^C', '=D', '^D', '=E', '=F', '^F', '=G', '^G', '=A', '^A', '=B'];
export function midiToAbc(midi, key = null, accidentals = {}) {
  let note = PITCHES[midi % 12];
  if(key){
    const signature=keySignature(key),flat=signature.count<0;
    const letters=flat?['C','D','D','E','E','F','G','G','A','A','B','B']:['C','C','D','D','E','F','F','G','G','A','A','B'];
    const letter=letters[midi%12],naturals={C:0,D:2,E:4,F:5,G:7,A:9,B:11},offset=(midi%12)-naturals[letter],id=letter+Math.floor(midi/12);
    const previous=accidentals[id]??signature.values[letter];
    note=(previous===offset?'':offset<0?'_':offset>0?'^':'=')+letter;accidentals[id]=offset;
  }
  const octave = Math.floor(midi / 12) - 1;
  if (octave >= 5) note = note.toLowerCase() + "'".repeat(Math.max(0, octave - 5));
  else if (octave < 4) note += ','.repeat(4 - octave);
  return note;
}

// Change the written key signature while preserving sounding pitches.
export function respellKey(notes, oldKey, newKey) {
  const oldSignature=keySignature(oldKey).values;
  return notes.split('|').map(bar=>{
    const previous={},next={};
    return bar.replace(/"[^"]*"|![^!]*!|%[^\n]*|(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/g,(match,mark,letter,octaves)=>{
      if(!letter)return match;
      const upper=letter.toUpperCase(),octave=(letter===upper?4:5)+[...octaves].reduce((s,c)=>s+(c==="'"?1:-1),0),id=upper+octave;
      const offset=mark?(mark==='='?0:mark[0]==='^'?mark.length:-mark.length):(previous[id]??oldSignature[upper]);previous[id]=offset;
      return midiToAbc((octave+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[upper]+offset,newKey,next);
    });
  }).join('|');
}

export function notesToDraft(events, { bpm = 120, duration, meter = '4/4', minPitch = 48, maxPitch = 88, key = null }) {
  const [numerator, denominator] = meter.split('/').map(Number);
  const unitsPerBar = numerator * 16 / denominator; // quantize to sixteenths, render L:1/8
  const secondsPerUnit = 15 / bpm;
  const count = Math.min(32, Math.max(1, Math.ceil(duration / secondsPerUnit / unitsPerBar - .01)));
  const cells = Array(count * unitsPerBar).fill(null);
  const notes = events.filter(n => n.pitchMidi >= minPitch && n.pitchMidi <= maxPitch && n.durationSeconds >= Math.max(.035,secondsPerUnit*.55));
  for (const n of notes) {
    const start = Math.max(0, Math.round(n.startTimeSeconds / secondsPerUnit));
    const end = Math.min(cells.length, Math.max(start + 1, Math.round((n.startTimeSeconds + n.durationSeconds) / secondsPerUnit)));
    for (let i = start; i < end; i++) {
      // A single-line draft: select the strongest candidate; do not claim stem separation.
      if (!cells[i] || n.amplitude > cells[i].amplitude) cells[i] = n;
    }
  }
  const bars = [], chords = [];
  const roots = key ? (keySignature(key).count<0?['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']) : ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  for (let bar = 0; bar < count; bar++) {
    const start = bar * unitsPerBar, end = start + unitsPerBar, tokens = [], chroma = Array(12).fill(0), accidentals = {};
    // All detected voices contribute to a coarse major/minor chord candidate.
    for (const n of events) {
      const overlap = Math.max(0, Math.min(end * secondsPerUnit, n.startTimeSeconds + n.durationSeconds) - Math.max(start * secondsPerUnit, n.startTimeSeconds));
      chroma[n.pitchMidi % 12] += overlap * n.amplitude;
    }
    let bestChord = 'N.C.', best = 0;
    for (let root = 0; root < 12; root++) for (const minor of [false, true]) {
      const triad = [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12];
      const score = triad.reduce((s, p) => s + chroma[p], 0) - chroma.reduce((s, n, p) => s + (triad.includes(p) ? 0 : n * .7), 0);
      if (score > best) { best = score; bestChord = roots[root] + (minor ? 'm' : ''); }
    }
    chords.push(bestChord);
    for (let i = start; i < end;) {
      const event = cells[i], pitch = event?.pitchMidi;
      let next = i + 1;
      while (next < end && cells[next] === event) next++;
      const tied = event && next === end && next < cells.length && cells[next] === event;
      const length=(next-i)/2,notationLength=length===1?'':Number.isInteger(length)?String(length):`${next-i}/2`;
      tokens.push(`${pitch == null ? 'z' : midiToAbc(pitch,key,accidentals)}${notationLength}${tied ? '-' : ''}`);
      i = next;
    }
    bars.push(tokens.join(' '));
  }
  return { notes: bars.join(' | ') + ' |', chords: chords.join(' | '), bars: count, noteCount: notes.length };
}

export function demoAudio() {
  // Original synthetic fixture, not an analysis of any YouTube track.
  const bpm = 120, length = 32, audio = new Float32Array(length * AUDIO_RATE);
  const roots = [57, 62, 66, 64];
  for (let i = 0; i < audio.length; i++) {
    const t = i / AUDIO_RATE, beat = Math.floor(t * 2), phase = t % .5;
    const root = roots[Math.floor(beat / 4) % roots.length];
    const pitch = root + [0, 4, 7, 12][beat % 4];
    const tone = Math.sin(2 * Math.PI * 440 * 2 ** ((pitch - 69) / 12) * t) * Math.exp(-phase * 8) * .3;
    const click = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-phase * 130) * .12;
    audio[i] = tone + click;
  }
  return { samples: audio, sampleRate: AUDIO_RATE, duration: length, name: '기능 확인용 합성 음원', bpm };
}
