import test from 'node:test';
import assert from 'node:assert/strict';
import ABCJS from 'abcjs';
import { compactScore,compactBlock,compactScale,compactForm } from '../src/compact-score.mjs';
import { interludeAbc } from '../src/render.js';
import { createProject,createSong,createInterlude,validateProject } from '../src/model.mjs';
const block=notes=>({type:'interlude',mode:'melody',key:'Bb',meter:'4/4',notes:notes.join(' | ')+' |',chords:notes.map(()=> 'Bb').join(' | ')});
const a=['B2 c2 d2 f2','g2 f2 e2 d2','B2 d2 f2 d2','c4 F4'];
const b=['d2 e2 f2 g2','a2 g2 f2 e2','d2 f2 a2 f2','g4 c4'];
test('세 번 반복된 여덟 마디는 한 번 적고 실제 연주 순서를 보존한다',()=>{
  const source=[block([...a,...b,...a,...b]),block([...a,...b])],before=JSON.stringify(source);
  const result=compactScore(source);
  assert.equal(result.originalBars,24);assert.equal(result.uniqueBars,8);assert.deepEqual(result.sequence,[0,0,0]);
  assert.equal(compactForm(result)[0].label,'A×3');assert.equal(JSON.stringify(source),before);
  const restored=result.sequence.flatMap(i=>result.sections[i].bars.map(b=>b.notes));assert.deepEqual(restored,[...a,...b,...a,...b,...a,...b]);
});
test('마지막 음표나 코드가 다른 반복은 별도 구간으로 남긴다',()=>{
  const changed=block([...a]);changed.notes=changed.notes.replace('c4 F4','c4 G4');changed.chords='Bb | Bb | Bb | F';
  const result=compactScore([block(a),changed]);assert.equal(result.uniqueBars,8);assert.deepEqual(result.sequence,[0,1]);
});
test('끝 이음줄이 이어지는 구간은 반복으로 접지 않는다',()=>{
  const tied=[...a];tied[3]='c4 F4-';const result=compactScore([block(tied),block(tied)]);assert.equal(result.uniqueBars,8);
});
test('정리 악보에 구간 표기와 같은 조표를 넣고 ABC 문법을 검증한다',()=>{
  const result=compactScore([block([...a,...b])]),abc=interludeAbc(compactBlock(result));
  assert.match(abc,/P:A/);assert.match(abc,/P:B/);assert.match(abc,/K:Bb/);
  assert.ok(!ABCJS.parseOnly(abc)[0].warnings?.length);
});
test('맞춤 배치는 최대 18%만 줄이고, 서로 다른 박자·원본 이미지는 합치지 않는다',()=>{
  assert.equal(compactScale(1000,1000,1000,1200),1);
  assert.equal(compactScale(1000,4000,1000,1000),.82);
  assert.throws(()=>compactScore([block(a),{...block(a),meter:'3/4'}]),/박자/);
  assert.throws(()=>compactScore([{type:'score'}]),/원본/);
  assert.throws(()=>compactScore([block([])]),/음표/);
});
test('프로젝트 저장·복원은 정리 보기와 수정 가능한 원본을 함께 보존한다',()=>{
  const p=createProject(),s=createSong();s.compactLayout=true;s.blocks=[{...createInterlude(),...block([...a,...a])}];p.items=[s];
  const restored=validateProject(JSON.parse(JSON.stringify(p)),{});
  assert.equal(restored.items[0].compactLayout,true);assert.deepEqual(restored.items[0].blocks,s.blocks);
  assert.equal(compactScore(restored.items[0].blocks).uniqueBars,4);
  restored.items[0].compactLayout='true';assert.throws(()=>validateProject(restored,{}),/정리 설정/);
});
