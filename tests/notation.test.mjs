import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterlude } from '../src/model.mjs';
import { interludeAbc } from '../src/render.js';

test('코드 악보는 박자에 맞는 쉼표를 만들고 사용자가 입력한 조성을 유지한다',()=>{
  const b=createInterlude('Bb');b.meter='3/4';
  assert.match(interludeAbc(b),/M:3\/4/);assert.match(interludeAbc(b),/K:Bb/);assert.match(interludeAbc(b),/"A"z6/);
});
test('잘못된 조성이나 코드·음표 마디 수 불일치를 조용히 대체하지 않는다',()=>{
  const b=createInterlude();b.key='wrong';assert.throws(()=>interludeAbc(b),/Key/);
  b.key='A';b.mode='melody';b.chords='A | E';assert.throws(()=>interludeAbc(b),/마디 수/);
});
