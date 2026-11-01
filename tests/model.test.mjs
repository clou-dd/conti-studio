import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createSong, parseForm, move, fullCrop, clampCrop, recropAnnotations, youtubeId, safeUrl, validateProject, orderPages } from '../src/model.mjs';

test('송폼은 구간 메모의 하이픈을 보존하고 구간 구분자를 나눈다',()=>{
  assert.deepEqual(parseForm('Intro(8) → A1 → B → Inter(4)').map(t=>t.label),['Intro(8)','A1','B','Inter(4)']);
  assert.deepEqual(parseForm('A - B - Out(5)').map(t=>t.label),['A','B','Out(5)']);
  assert.equal(parseForm('key-up')[0].label,'key-up');
});
test('순서 변경은 경계를 넘거나 원본 배열을 변경하지 않는다',()=>{
  const original=['곡1','간주','곡2'];assert.deepEqual(move(original,2,0),['곡2','곡1','간주']);assert.deepEqual(original,['곡1','간주','곡2']);assert.equal(move(original,0,-1),original);
});
test('페이지 사이 삽입 순서는 재생성 후 유지되고 새 페이지는 누락되지 않는다',()=>{
  const pages=[{id:'song1:0'},{id:'song1:1'},{id:'song2:0'},{id:'extra'}];
  assert.deepEqual(orderPages(pages,['song1:0','extra','song1:1','song2:0']).map(p=>p.id),['song1:0','extra','song1:1','song2:0']);
  assert.deepEqual(orderPages([...pages,{id:'new'}],['missing','extra','extra']).map(p=>p.id),['extra','song1:0','song1:1','song2:0','new']);
});
test('잘못된 자르기 좌표를 정규화한다',()=>{
  assert.deepEqual(clampCrop({x:NaN,y:0,w:1,h:1}),fullCrop());
  assert.deepEqual(clampCrop({x:-1,y:0,w:8,h:0.5}),{x:0,y:0,w:1,h:.5});
});
test('악보 분할 후 주석이 원본의 같은 위치에 남는다',()=>{
  const notes=[{id:'t',type:'text',text:'Full',color:'#ff0000',x:.3,y:.7,w:.1,h:.04},{id:'h',type:'highlight',text:'',color:'#ffff00',x:.2,y:.4,w:.4,h:.2}];
  const upper=recropAnnotations(notes,fullCrop(),{x:0,y:0,w:1,h:.5});
  assert.equal(upper.length,1);assert.ok(Math.abs(upper[0].h-.2)<1e-10);
  const lower=recropAnnotations(notes,fullCrop(),{x:0,y:.5,w:1,h:.5});
  assert.ok(Math.abs(lower[0].y-.4)<1e-10);assert.ok(Math.abs(lower[1].h-.2)<1e-10);
});
test('링크는 실제 유튜브 호스트와 안전한 http 주소만 허용한다',()=>{
  assert.equal(youtubeId('https://youtu.be/abcdefghijk?t=20'),'abcdefghijk');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=abcdefghijk'),'abcdefghijk');
  assert.equal(youtubeId('https://youtube.com.evil.example/watch?v=abcdefghijk'),null);
  assert.equal(safeUrl('javascript:alert(1)'),null);
});
test('프로젝트 복원 전 빠진 이미지와 중복 ID를 거부한다',()=>{
  const p=createProject(),s=createSong();s.blocks=[{id:'score1',type:'score',assetId:'asset1',label:'',crop:fullCrop(),annotations:[]}];p.items=[s];
  assert.throws(()=>validateProject(structuredClone(p),{}),/누락/);
  assert.equal(validateProject(structuredClone(p),{asset1:{}}).items.length,1);
  p.items.push(structuredClone(s));assert.throws(()=>validateProject(p,{asset1:{}}),/ID/);
});
