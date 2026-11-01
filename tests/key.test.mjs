import test from 'node:test';
import assert from 'node:assert/strict';
import ABCJS from 'abcjs';
import { estimateAudioKey,rankKeys } from '../src/key-analysis.mjs';
import { midiToAbc,respellKey,notesToDraft } from '../src/audio-core.mjs';
import { interludeAbc } from '../src/render.js';

test('Bb 장조의 I–IV–V–I 합성 화음 음원을 Bb 장조로 추정한다',()=>{
  const sr=22050,a=new Float32Array(sr*16),chords=[[58,62,65],[63,67,70],[65,69,72],[58,62,65]];
  for(let i=0;i<a.length;i++){const t=i/sr,c=chords[Math.floor(t/2)%4];for(const p of c)a[i]+=.15*Math.sin(2*Math.PI*440*2**((p-69)/12)*t);a[i]+=.2*Math.sin(2*Math.PI*440*2**((c[0]-12-69)/12)*t);}
  const result=estimateAudioKey(a,sr);assert.equal(result.key,'Bb');assert.equal(result.mode,'장조');assert.equal(result.candidates.length,3);
});
test('무음·한 음·고른 잡음 분포를 근거 없이 C장조로 확정하지 않는다',()=>{
  assert.equal(estimateAudioKey(new Float32Array(22050*3)),null);
  assert.equal(rankKeys([1,0,0,0,0,0,0,0,0,0,0,0]),null);
  assert.equal(rankKeys(Array(12).fill(1)),null);
});
test('단조 프로파일에서 A단조를 구분한다',()=>{
  const p=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  assert.equal(rankKeys(Array.from({length:12},(_,i)=>p[(i-9+12)%12])).key,'Am');
});
test('Bb 조표에서는 Bb를 B로 적고 같은 마디의 제자리표와 임시표를 구분한다',()=>{
  const state={};assert.equal(midiToAbc(70,'Bb',state),'B');assert.equal(midiToAbc(71,'Bb',state),'=B');assert.equal(midiToAbc(70,'Bb',state),'_B');
  const body='B =B _B | B';
  assert.equal(respellKey(respellKey(body,'Bb','C'),'C','Bb'),body);
});
test('16분음표와 쉼표가 한 마디 길이를 보존하고 선택한 조표로 파싱된다',()=>{
  const d=notesToDraft([{pitchMidi:70,startTimeSeconds:0,durationSeconds:.125,amplitude:1}],{bpm:120,duration:2,key:'Bb'});
  assert.equal(d.notes,'B1/2 z15/2 |');
  const tune=ABCJS.parseOnly(interludeAbc({...d,key:'Bb',mode:'melody',meter:'4/4'}))[0];
  assert.ok(!tune.warnings?.length);assert.equal(tune.lines[0].staff[0].key.root,'B');assert.equal(tune.lines[0].staff[0].key.acc,'b');
});
