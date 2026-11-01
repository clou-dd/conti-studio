import { respellKey } from './audio-core.mjs';
// Conservative repeat folding: only equal notes AND chords are shared.
// Original blocks remain editable; compact layout is a reversible output view.
export function compactScore(blocks) {
  if(!blocks.length||blocks.some(b=>b.type!=='interlude'||b.mode!=='melody'))throw new Error('단선 멜로디 악보만 있는 곡에서 정리할 수 있습니다. 원본 이미지·메모는 기본 배치를 사용해 주세요.');
  const key=blocks[0].key,meter=blocks[0].meter;
  if(blocks.some(b=>b.key!==key||b.meter!==meter))throw new Error('조성이나 박자가 다른 악보는 각각 보존합니다. 같은 조성·박자로 맞춘 후 정리해 주세요.');
  const bars=[];
  for(const block of blocks){
    const chords=block.chords.split('|').map(s=>s.trim()).filter(Boolean),notes=block.notes.split('|').map(s=>s.trim()).filter(Boolean);
    if(chords.length!==notes.length)throw new Error('코드와 음표의 마디 수를 맞춘 후 정리해 주세요.');
    for(let i=0;i<notes.length;i++)bars.push({notes:notes[i],chord:chords[i]});
  }
  if(!bars.length)throw new Error('음표와 코드를 입력한 뒤 정리해 주세요.');
  if(bars.length>1200)throw new Error('한 곡은 1,200마디까지 정리할 수 있습니다.');
  const canonical=bar=>`${bar.chord.replace(/\s+/g,'')}\n${respellKey(bar.notes,key,key).replace(/\s+/g,'')}`;
  const signatures=bars.map(canonical);
  const phrase=(start,n)=>signatures.slice(start,start+n).join('\n|\n');
  const sections=[],sequence=[];let cursor=0;
  while(cursor<bars.length){
    const match=sections.map((s,index)=>({...s,index})).filter(s=>s.shareable&&cursor+s.bars.length<=bars.length&&!(cursor&&bars[cursor-1].notes.trim().endsWith('-'))&&!bars[cursor+s.bars.length-1].notes.trim().endsWith('-')&&phrase(cursor,s.bars.length)===s.signature).sort((a,b)=>b.bars.length-a.bars.length)[0];
    if(match){sequence.push(match.index);cursor+=match.bars.length;continue;}
    // Prefer an eight-bar recurring phrase, otherwise keep four-bar systems.
    let count=Math.min(4,bars.length-cursor);
    if(cursor+8<=bars.length){const target=phrase(cursor,8);for(let j=cursor+8;j+8<=bars.length;j+=4)if(phrase(j,8)===target){count=8;break;}}
    // Do not fold a partial tail or a phrase crossing a tie: it depends on context.
    const selected=bars.slice(cursor,cursor+count),signature=phrase(cursor,count);
    const tiedIn=cursor>0&&bars[cursor-1].notes.trim().endsWith('-'),tiedOut=selected.at(-1).notes.trim().endsWith('-');
    let found=!tiedIn&&!tiedOut?sections.findIndex(s=>s.signature===signature&&s.shareable):-1;
    if(found<0){found=sections.length;sections.push({label:found<26?String.fromCharCode(65+found):`A${found-24}`,startBar:cursor,bars:selected,signature,shareable:!tiedIn&&!tiedOut});}
    sequence.push(found);cursor+=count;
  }
  const uniqueBars=sections.reduce((s,p)=>s+p.bars.length,0);
  if(uniqueBars>256)throw new Error('정리 후 256마디를 넘습니다. 기본 배치로 나누어 출력해 주세요.');
  return {key,meter,sections,sequence,originalBars:bars.length,uniqueBars,savedBars:bars.length-uniqueBars};
}

export function compactBlock(result) {
  const sections=[];let cursor=0;
  for(const section of result.sections){sections.push({bar:cursor,label:section.label});cursor+=section.bars.length;}
  return {type:'interlude',title:'정리 악보',mode:'melody',key:result.key,meter:result.meter,compact:true,sections,
    chords:result.sections.flatMap(s=>s.bars.map(b=>b.chord)).join(' | '),
    notes:result.sections.flatMap(s=>s.bars.map(b=>b.notes)).join(' | ')+' |',note:''};
}

// Never shrink below 82% of the normal staff size just to force one page.
export function compactScale(width,height,availableWidth,availableHeight) {
  const normal=availableWidth/width;
  return height*normal<=availableHeight?normal:Math.max(normal*.82,Math.min(normal,availableHeight/height));
}

export function compactForm(result){
  const groups=[];for(const index of result.sequence){const last=groups.at(-1);if(last?.index===index)last.count++;else groups.push({index,count:1});}
  return groups.map((g,i)=>({id:`compact-${i}`,label:result.sections[g.index].label+(g.count>1?`×${g.count}`:''),note:'',color:''}));
}
