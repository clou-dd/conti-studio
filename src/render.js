import ABCJS from 'abcjs';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { clampCrop, orderPages, safeName, wrapText } from './model.mjs';
import { loadImage, download } from './files.js';
import { compactScore,compactBlock,compactScale,compactForm } from './compact-score.mjs';

const W = 1654, H = 2339, M = 94, CW = W - 2*M;
const FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const font = (ctx, size, weight = 400) => { ctx.font = `${weight} ${size}px ${FONT}`; };
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
export function interludeAbc(block) {
  const key=block.key.trim().replaceAll('♭','b').replaceAll('♯','#');
  if(!/^[A-G](?:#|b)?(?:m)?$/.test(key))throw new Error('추가 악보의 Key를 확인해 주세요. 예: A, Bb, F#m');
  const meter=block.meter;if(!['4/4','3/4','6/8','12/8','2/4'].includes(meter))throw new Error('추가 악보의 박자를 확인해 주세요.');
  const limit=block.compact?1200:32;
  const chords = block.chords.split('|').map(c => c.trim().replace(/["\n\r\\]/g,'')).filter(Boolean).slice(0,limit);
  if(block.chords.split('|').filter(c=>c.trim()).length>limit)throw new Error(`추가 악보는 블록 하나에 ${limit}마디까지 입력해 주세요.`);
  const phrases = block.notes.replace(/[\r\n]/g,' ').split('|').map(s=>s.trim()).filter(Boolean);
  if(block.mode==='melody'&&phrases.length!==chords.length)throw new Error('코드와 음표의 마디 수를 같게 맞춰 주세요.');
  const [beats,unit]=meter.split('/').map(Number),rest=`z${beats*8/unit}`;
  const bars = chords.map((chord,i) => `"${chord}"${block.mode === 'melody' ? phrases[i] : rest}`);
  const lines = []; for (let i=0;i<bars.length;i+=4){const section=block.sections?.find(s=>s.bar===i);if(section)lines.push(`P:${section.label}`);lines.push(bars.slice(i,i+4).join(' | ') + ' |');}
  return `X:1\nM:${meter}\nL:1/8\nK:${key}\n${lines.join('\n')}`;
}
async function musicImage(block) {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;visibility:hidden'; document.body.append(host);
  try {
    if (!block.chords.split('|').some(s=>s.trim())) throw new Error('추가 악보에 코드를 입력해 주세요.');
    const tunes = ABCJS.renderAbc(host, interludeAbc(block), { add_classes:true, staffwidth: 1250, paddingleft: 10, paddingright: 10, paddingtop: 16, paddingbottom: 16, scale: 1.5, responsive: undefined, format: { gchordfont: 'Arial 18', partsfont: 'Arial 15' } });
    if (!tunes.length || tunes[0].warnings?.length) throw new Error('음표 입력을 확인해 주세요. ABC 표기법에 맞지 않는 부분이 있습니다.');
    const svgs = [...host.querySelectorAll('svg')]; if (!svgs.length) throw new Error('추가 악보를 그리지 못했습니다.');
    const images = [];
    for (const svg of svgs) {
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try { images.push(await loadImage(url)); } finally { URL.revokeObjectURL(url); }
    }
    const canvas = document.createElement('canvas'); canvas.width = Math.max(...images.map(i=>i.width)); canvas.height = images.reduce((h,i)=>h+i.height,0);
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); let y=0;
    for (const img of images) { ctx.drawImage(img,0,y); y+=img.height; }
    if(block.compact){
      const systems=[];let offset=0;
      svgs.forEach((svg,index)=>{
        const groups=new Map(),ratio=images[index].height/(svg.viewBox.baseVal.height||images[index].height);
        for(const el of svg.querySelectorAll('[class]')){
          const line=[...el.classList].find(c=>/^abcjs-l\d+$/.test(c));if(!line)continue;
          const box=el.getBBox();if(!box.width&&!box.height)continue;
          const id=Number(line.slice(7)),old=groups.get(id)||{top:Infinity,bottom:-Infinity};
          const matrix=svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
          const y1=matrix.b*box.x+matrix.d*box.y+matrix.f,y2=matrix.b*(box.x+box.width)+matrix.d*(box.y+box.height)+matrix.f;
          old.top=Math.min(old.top,y1*ratio+offset);old.bottom=Math.max(old.bottom,y2*ratio+offset);groups.set(id,old);
        }
        systems.push(...[...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b));offset+=images[index].height;
      });
      canvas.staffBreaks=systems.slice(1).map((s,i)=>(systems[i].bottom+s.top)/2).filter((y,i)=>systems[i].bottom<=systems[i+1].top);
    }
    return canvas;
  } finally { host.remove(); }
}
function drawForm(ctx, song, y) {
  if (!song.form.length) return y;
  const rows = []; let row = [], x = 0;
  font(ctx,30,500);
  for (const token of song.form) {
    const labelLines = wrapText(ctx,token.label,CW-90); const tw = Math.min(CW-50,Math.max(...labelLines.map(s=>ctx.measureText(s).width))+30);
    const noteLines = token.note ? wrapText(ctx,token.note,Math.max(80,tw)) : [];
    const width = Math.min(CW-40,Math.max(tw,...noteLines.map(s=>{font(ctx,20);const w=ctx.measureText(s).width;font(ctx,30,500);return w+20;})));
    const height = Math.max(48,labelLines.length*38+10) + (noteLines.length ? noteLines.length*28+6 : 0);
    if (row.length && x+width+36 > CW-40) { rows.push(row); row=[]; x=0; }
    row.push({ token,width,height,labelLines,noteLines }); x+=width+36;
  }
  if(row.length) rows.push(row);
  const heights=rows.map(r=>Math.max(...r.map(t=>t.height))+20), boxH=heights.reduce((a,b)=>a+b,0)+34;
  ctx.strokeStyle='#b8bfbd';ctx.lineWidth=2;ctx.strokeRect(M,y,CW,boxH);let ry=y+22;
  for(let ri=0;ri<rows.length;ri++){
    const r=rows[ri];let rx=M+20;
    for(let j=0;j<r.length;j++){
      const {token,width,labelLines,noteLines}=r[j];
      if(token.color){ctx.fillStyle=token.color;ctx.fillRect(rx,ry,width,Math.max(48,labelLines.length*38+10));}
      font(ctx,30,500);ctx.fillStyle='#222';labelLines.forEach((s,i)=>ctx.fillText(s,rx+12,ry+34+i*38));
      font(ctx,20);ctx.fillStyle='#bc563f';noteLines.forEach((s,i)=>ctx.fillText(s,rx+8,ry+Math.max(48,labelLines.length*38+10)+24+i*28));
      rx+=width;
      if(j<r.length-1){font(ctx,24);ctx.fillStyle='#9aa39e';ctx.fillText('–',rx+9,ry+33);rx+=36;}
    }
    ry+=heights[ri];
  }
  return y+boxH+38;
}
function header(ctx,project,song,ordinal,continued) {
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  font(ctx,21);ctx.fillStyle='#65706b';ctx.fillText([project.church,project.date].filter(Boolean).join(' · '),M,70);
  ctx.textAlign='center';font(ctx,43,600);ctx.fillStyle='#17251e';
  const title = `${ordinal}. ${song.title || '제목 없는 찬양'}${song.key ? '  '+song.key : ''}${continued ? ' · 계속' : ''}`;
  const lines=wrapText(ctx,title,CW);lines.forEach((s,i)=>ctx.fillText(s,W/2,146+i*56));ctx.textAlign='left';
  let y=174+(lines.length-1)*56;
  if(!continued)y=drawForm(ctx,song,y);
  if(!continued&&song.notes){font(ctx,23);ctx.fillStyle='#666';for(const line of wrapText(ctx,song.notes,CW)){ctx.fillText(line,M,y+25);y+=34;}y+=22;}
  return y+14;
}
function annotations(ctx,block,x,y,width,height) {
  for(const a of block.annotations||[]){
    if(a.type==='highlight'){ctx.save();ctx.globalAlpha=.35;ctx.fillStyle=a.color;ctx.fillRect(x+a.x*width,y+a.y*height,a.w*width,a.h*height);ctx.restore();}
    else {font(ctx,Math.max(22,Math.min(48,width*.027)),600);ctx.fillStyle=a.color;ctx.fillText(a.text,x+a.x*width,y+a.y*height+30);}
  }
}
async function fingerprint(url) {
  const bytes = new TextEncoder().encode(url);
  if(crypto.subtle){const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');}
  // This checksum detects edits for review status; it is not an authentication token.
  let a=2166136261,b=0x9e3779b9;for(const value of bytes){a=Math.imul(a^value,16777619);b=Math.imul(b^value,2246822519);}return `${a>>>0}-${b>>>0}-${bytes.length}`;
}
async function finish(canvas,id,itemId,label,part,warnings) {
  const ctx=canvas.getContext('2d');font(ctx,20);ctx.fillStyle='#9aa29c';ctx.textAlign='right';ctx.fillText(`${label} · ${part}`,W-M,H-47);ctx.textAlign='left';
  const data=canvas.toDataURL('image/png');
  return {id,itemId,label,part,data,width:W,height:H,fingerprint:await fingerprint(data),warnings:[...warnings]};
}

export async function buildPages(project,assets) {
  await document.fonts.ready;
  const pages=[];let ordinal=0;
  for(const original of project.items){
    let item=original,compactWarning='';
    if(original.type==='song'&&original.compactLayout){
      try{
        const result=compactScore(original.blocks);
        item={...original,blocks:[compactBlock(result)],form:compactForm(result),notes:[original.notes,`연주 순서: 위 송폼 참조 · ${result.originalBars}마디 → ${result.uniqueBars}마디 · 같은 음표·코드만 묶음`].filter(Boolean).join('\n')};
      }catch(e){compactWarning=`기본 배치로 표시합니다. ${e.message}`;}
    }
    await yieldFrame();
    if(item.type==='image'){
      const asset=assets[item.assetId]; if(!asset) throw new Error('삽입한 이미지 원본을 찾을 수 없습니다.');
      const img=await loadImage(asset.data), crop=clampCrop(item.crop);
      const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
      const sw=img.width*crop.w,sh=img.height*crop.h,s=Math.min((W-90)/sw,(H-120)/sh);
      ctx.drawImage(img,img.width*crop.x,img.height*crop.y,sw,sh,(W-sw*s)/2,(H-sh*s)/2,sw*s,sh*s);
      pages.push(await finish(c,item.id,item.id,item.title||'삽입 이미지',1,[]));continue;
    }
    ordinal++;
    let c,ctx,y,pageTop,part=0,warnings=compactWarning?[compactWarning]:[];
    const fresh=()=>{c=document.createElement('canvas');c.width=W;c.height=H;ctx=c.getContext('2d');y=header(ctx,project,item,ordinal,part>0);if(y>H-300){warnings.push('제목·송폼·곡 메모가 한 페이지를 초과합니다. 내용을 줄여 주세요.');y=H-300;}pageTop=y;};
    const flush=async()=>{pages.push(await finish(c,`${item.id}:${part}`,item.id,item.title,part+1,warnings));part++;warnings=[];};
    fresh();
    if(!item.blocks.length){font(ctx,29);ctx.fillStyle='#a9afa9';ctx.textAlign='center';ctx.fillText('악보를 추가해 주세요.',W/2,Math.max(y+180,H*.45));ctx.textAlign='left';warnings.push('악보가 없습니다. 악보 또는 간주를 추가해 주세요.');}
    for(const block of item.blocks){
      if(block.type==='text'){
        font(ctx,28);const lines=wrapText(ctx,block.text,CW);
        for(const line of lines){if(y+48>H-100){await flush();fresh();}ctx.fillStyle='#47584c';ctx.fillText(line,M,y+31);y+=42;}y+=18;continue;
      }
      let img,crop={x:0,y:0,w:1,h:1}, top=0;
      if(block.type==='interlude'){
        try{img=await musicImage(block);}catch(e){warnings.push(e.message);font(ctx,26);ctx.fillStyle='#b64e3a';ctx.fillText(e.message,M,y+30);y+=70;continue;}
        if(y+230>H-100){await flush();fresh();}
        font(ctx,25,600);ctx.fillStyle='#243b30';ctx.fillText(block.title||'Interlude',M,y+27);y+=48;
      }else{
        if(!assets[block.assetId])throw new Error('악보 원본을 찾을 수 없습니다.');
        img=await loadImage(assets[block.assetId].data);crop=clampCrop(block.crop);
        if(block.label){font(ctx,24,600);ctx.fillStyle='#567263';ctx.fillText(block.label,M,y+26);y+=40;}
      }
      const sx=crop.x*img.width,sy=crop.y*img.height,sw=crop.w*img.width,sh=crop.h*img.height;
      let scale=block.compact?compactScale(sw,sh,CW,H-100-y):CW/sw,totalH=sh*scale;
      const capacity=H-100-y;
      // Scans keep their full contents and never cut through a staff. The user
      // can split a long scan explicitly to insert material at a musical boundary.
      if(totalH>capacity && y>650 && (totalH<H-365 || capacity<totalH*.75)){await flush();fresh();}
      if(block.type==='score'){scale=Math.min(scale,(H-100-y)/sh);totalH=sh*scale;}
      const drawWidth=sw*scale,drawX=M+(CW-drawWidth)/2;
      while(top<totalH-.1){
        if(H-100-y<100){await flush();fresh();}
        let take=Math.min(totalH-top,H-100-y);
        if(block.compact&&top+take<totalH-.1){
          const cuts=(img.staffBreaks||[]).map(n=>n*scale).filter(n=>n>top+1&&n<=top+take);
          if(cuts.length)take=cuts.at(-1)-top;
          else if(y>pageTop+1){await flush();fresh();continue;}
          else {warnings.push('이 악보는 자동 줄 나누기 위치를 확인할 수 없습니다. 기본 배치에서 악보를 나눠 주세요.');break;}
        }
        ctx.drawImage(img,sx,sy+top/scale,sw,take/scale,drawX,y,drawWidth,take);
        if(block.type==='score'){
          ctx.save();ctx.beginPath();ctx.rect(drawX,y,drawWidth,take);ctx.clip();annotations(ctx,block,drawX,y-top,drawWidth,totalH);ctx.restore();
        }
        y+=take;top+=take;
        if(top<totalH-.1){await flush();fresh();}
      }
      y+=30;
      if(block.type==='interlude'&&block.note){font(ctx,23);ctx.fillStyle='#777';for(const line of wrapText(ctx,block.note,CW)){if(y+38>H-100){await flush();fresh();}ctx.fillText(line,M,y+26);y+=34;}y+=20;}
    }
    await flush();
  }
  return orderPages(pages,project.pageOrder);
}

export async function createPdfBytes(pages,name) {
  const doc=await PDFDocument.create();doc.setTitle(name);doc.setCreator('Conti Studio');
  for(const page of pages){const img=await doc.embedPng(page.data);const p=doc.addPage([595.276,841.89]);p.drawImage(img,{x:0,y:0,width:595.276,height:841.89});await yieldFrame();}
  return doc.save();
}
export async function exportPdf(pages,name) {
  download(new Blob([await createPdfBytes(pages,name)],{type:'application/pdf'}),`${safeName(name)}.pdf`);
}
export async function exportPngs(pages,name) {
  const zip=new JSZip();for(let i=0;i<pages.length;i++)zip.file(`${String(i+1).padStart(2,'0')}_${safeName(pages[i].label)}.png`,pages[i].data.split(',')[1],{base64:true});
  download(await zip.generateAsync({type:'blob'}),`${safeName(name)}_이미지.zip`);
}
