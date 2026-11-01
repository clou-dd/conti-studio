import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBeats, notesToDraft, sectionsToForm, AUDIO_RATE } from '../src/audio-core.mjs';
import { interludeAbc } from '../src/render.js';
import { createProject, createSong, validateProject } from '../src/model.mjs';

test('분당 100회의 합성 타격에서 일정한 박자와 BPM을 추정하고 무음은 거부한다', () => {
  const audio = new Float32Array(AUDIO_RATE * 20);
  for (let t = .25; t < 20; t += .6) for (let i = 0; i < 200; i++) audio[Math.floor(t * AUDIO_RATE) + i] = .8 * Math.exp(-i / 45);
  const result = estimateBeats(audio);
  assert.ok(Math.abs(result.bpm - 100) < 1);
  assert.ok(result.beats.length >= 32 && result.beats.length <= 34);
  assert.throws(() => estimateBeats(new Float32Array(AUDIO_RATE * 5)), /소리가 부족/);
});

test('마디를 넘는 실제 음 길이는 이음줄로 보존하고 뒤의 쉼표를 채운다', () => {
  const result = notesToDraft([{ pitchMidi: 60, startTimeSeconds: 1.5, durationSeconds: 1, amplitude: .8 }], { bpm: 120, duration: 4 });
  assert.equal(result.notes, 'z6 =C2- | =C2 z6 |');
  assert.equal(result.bars, 2);
  const abc = interludeAbc({ ...result, key: 'C', meter: '4/4', mode: 'melody' });
  assert.match(abc, /L:1\/8/);
  assert.match(abc, /=C2-/);
});

test('단선율 초안은 선택 음역 밖의 베이스를 제외하고 겹친 음 중 강한 후보를 택한다', () => {
  const result = notesToDraft([
    { pitchMidi: 36, startTimeSeconds: 0, durationSeconds: 1, amplitude: 1 },
    { pitchMidi: 64, startTimeSeconds: 0, durationSeconds: 1, amplitude: .3 },
    { pitchMidi: 67, startTimeSeconds: 0, durationSeconds: 1, amplitude: .9 },
  ], { bpm: 120, duration: 2 });
  assert.equal(result.notes, '=G4 z4 |');
});

test('6/8박자 송폼 마디 수는 분모를 반영하고 쉼 구간은 출력 송폼에서 제외한다', () => {
  const result = sectionsToForm([{ label: 'Intro', start: 0, end: 6 }, { label: '쉼', start: 6, end: 7 }], 120, 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'Intro(4)');
});

test('분석 결과의 구간 겹침과 비정상 시간을 프로젝트 복원 시 거부한다', () => {
  const project = createProject(), song = createSong();
  project.items.push(song);
  song.analysis = { bpm: 120, sourceUrl: '', sections: [{ id: 'a', label: 'A', start: 0, end: 4 }, { id: 'b', label: 'B', start: 3, end: 8 }] };
  assert.throws(() => validateProject(project, {}), /음원 분석/);
  song.analysis.sections[1].start = 4;
  assert.equal(validateProject(project, {}).items[0].analysis.sections.length, 2);
});
