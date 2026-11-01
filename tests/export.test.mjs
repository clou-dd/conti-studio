import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import JSZip from 'jszip';
import { createPdfBytes } from '../src/render.js';
import { createProjectZip } from '../src/files.js';
import { createProject, createSong, fullCrop } from '../src/model.mjs';

const red='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const blue='iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGNkYPjPwMAAAAQKAQHOAd3hAAAAAElFTkSuQmCC';
const data=b=>'data:image/png;base64,'+b;

test('실제 PDF를 다시 열어 A4·페이지 수·교정한 이미지 순서·한글 제목을 확인한다',async()=>{
  const bytes=await createPdfBytes([{data:data(blue)},{data:data(red)},{data:data(blue)}],'주일예배 콘티');
  assert.equal(Buffer.from(bytes).subarray(0,4).toString(),'%PDF');
  const doc=await PDFDocument.load(bytes);assert.equal(doc.getPageCount(),3);assert.equal(doc.getTitle(),'주일예배 콘티');
  const widths=[];
  for(const page of doc.getPages()){
    assert.ok(Math.abs(page.getWidth()-595.276)<.001);assert.ok(Math.abs(page.getHeight()-841.89)<.001);
    const objects=page.node.Resources().lookup(PDFName.of('XObject'),PDFDict);
    const image=doc.context.lookup(objects.values()[0]);widths.push(image.dict.get(PDFName.of('Width')).asNumber());
  }
  assert.deepEqual(widths,[2,1,2]);
});
test('프로젝트 ZIP은 원본·송폼·간주·자르기·페이지 순서를 보존하고 사용하지 않는 원본은 제외한다',async()=>{
  const project=createProject(),song=createSong();song.blocks=[{id:'score1',type:'score',assetId:'red',label:'',crop:{x:0,y:.25,w:1,h:.5},annotations:[]}];project.items=[song];project.pageOrder=[`${song.id}:1`,`${song.id}:0`];
  const assets={red:{id:'red',name:'원본 악보.png',data:data(red),width:1,height:1},unused:{id:'unused',name:'사용 안 함.png',data:data(blue),width:2,height:1}};
  const zip=await JSZip.loadAsync(await createProjectZip(project,assets));
  const restored=JSON.parse(await zip.file('project.json').async('string'));
  assert.deepEqual(restored.items[0].form,song.form);assert.deepEqual(restored.items[0].blocks,song.blocks);assert.deepEqual(restored.pageOrder,project.pageOrder);
  assert.ok(zip.file('assets/red.png'));assert.equal(zip.file('assets/unused.png'),null);
  assert.deepEqual(await zip.file('assets/red.png').async('uint8array'),new Uint8Array(Buffer.from(red,'base64')));
});
