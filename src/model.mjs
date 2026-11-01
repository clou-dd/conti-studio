export const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
export const COLORS = ['#fff0a6', '#def1d9', '#dcecfb', '#f7def0', '#eee6fb', '#ffe2ca'];
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
export const fullCrop = () => ({ x: 0, y: 0, w: 1, h: 1 });

export function createProject() {
  return { version: 1, id: uid(), name: '주일예배 콘티', church: '', date: today(), items: [], pageOrder: [], approvals: {}, updatedAt: Date.now() };
}
export function parseForm(text) {
  return text.split(/\s*(?:→|>|\s-\s|,)\s*/).map(s => s.trim()).filter(Boolean).map((label, i) => ({ id: uid(), label: label.slice(0, 80), note: '', color: /intro|inter|tag/i.test(label) ? COLORS[0] : /out|end|bis/i.test(label) ? COLORS[3] : '' }));
}
export function createSong() {
  return { id: uid(), type: 'song', title: '새 찬양', key: 'A', url: '', form: parseForm('Intro(4) → A → B → Inter(4) → A → B → Ending'), blocks: [], notes: '' };
}
export function createInterlude(key = 'A') {
  return { id: uid(), type: 'interlude', title: 'Interlude', key, meter: '4/4', chords: 'A | D/A | F#m7 | E', mode: 'chords', notes: 'A2 B2 c2 e2 | f2 e2 d2 c2 | A2 c2 e2 c2 | B4 E4 |', note: '코드와 마디 수를 확인해 주세요.' };
}
export function move(list, from, to) {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list;
  const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export function youtubeId(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    if (['youtu.be', 'www.youtu.be'].includes(u.hostname)) return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(u.hostname)) return null;
    const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})(?:\/|$)/)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
export function safeUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export const safeName = value => (value || '콘티').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100);
export function clampCrop(crop) {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  if (!crop || !['x','y','w','h'].every(k => finite(crop[k]))) return fullCrop();
  const x = Math.max(0, Math.min(0.99, crop.x)), y = Math.max(0, Math.min(0.99, crop.y));
  return { x, y, w: Math.max(0.01, Math.min(1-x, crop.w)), h: Math.max(0.01, Math.min(1-y, crop.h)) };
}

export function recropAnnotations(annotations, oldCrop, newCrop) {
  const a = clampCrop(oldCrop), b = clampCrop(newCrop);
  return (annotations || []).flatMap(n => {
    let x = (a.x+n.x*a.w-b.x)/b.w, y = (a.y+n.y*a.h-b.y)/b.h;
    const w = n.w*a.w/b.w, h = n.h*a.h/b.h;
    if(n.type === 'text') return x>=0 && x<1 && y>=0 && y<1 ? [{ ...n,x,y,w:Math.min(1,w),h:Math.min(1,h) }] : [];
    const right = Math.min(1,x+w), bottom = Math.min(1,y+h);x=Math.max(0,x);y=Math.max(0,y);
    return right>x && bottom>y ? [{...n,x,y,w:right-x,h:bottom-y}] : [];
  });
}

// Validate archive contents before the active project is replaced.
export function validateProject(p, assets) {
  const fail = message => { throw new Error(message); };
  if (!p || p.version !== 1 || typeof p.id !== 'string' || !Array.isArray(p.items) || p.items.length > 200) fail('지원하지 않는 프로젝트 파일입니다.');
  const ids = new Set();
  const checkId = id => { if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id)) fail('프로젝트 항목 ID가 올바르지 않습니다.'); ids.add(id); };
  const text = (v, max = 10000) => typeof v === 'string' && v.length <= max;
  if (!text(p.name, 200) || !text(p.church, 200) || !text(p.date, 30)) fail('프로젝트 기본 정보가 올바르지 않습니다.');
  for (const item of p.items) {
    checkId(item.id);
    if (!['song', 'image'].includes(item.type) || !text(item.title, 300)) fail('곡 정보가 올바르지 않습니다.');
    if (item.type === 'image') {
      if (!assets[item.assetId]) fail('삽입한 이미지가 누락되었습니다.');
      item.crop = clampCrop(item.crop);
      continue;
    }
    if (!text(item.key, 30) || !text(item.url, 3000) || !text(item.notes) || !Array.isArray(item.form) || item.form.length > 200 || !Array.isArray(item.blocks) || item.blocks.length > 300) fail('곡 편집 정보가 올바르지 않습니다.');
    for (const token of item.form) {
      checkId(token.id);
      if (!text(token.label, 80) || !text(token.note, 300) || !text(token.color, 30) || (token.color && !/^#[0-9a-f]{6}$/i.test(token.color))) fail('송폼 정보가 올바르지 않습니다.');
    }
    for (const block of item.blocks) {
      checkId(block.id);
      if (!['score','interlude','text'].includes(block.type)) fail('지원하지 않는 악보 블록입니다.');
      if (block.type === 'score') {
        if (!assets[block.assetId]) fail('악보 이미지가 누락되었습니다.');
        if (!text(block.label,300)) fail('악보 이름이 올바르지 않습니다.');
        block.crop = clampCrop(block.crop);
        if (block.annotations && (!Array.isArray(block.annotations) || block.annotations.length > 100)) fail('주석 정보가 올바르지 않습니다.');
        for (const a of block.annotations || []) {
          checkId(a.id);
          if (!['text','highlight'].includes(a.type) || !text(a.text || '', 300) || !/^#[0-9a-f]{6}$/i.test(a.color || '') || !['x','y','w','h'].every(k => Number.isFinite(a[k]) && a[k] >= 0 && a[k] <= 1)) fail('악보 주석 정보가 올바르지 않습니다.');
        }
      }
      if (block.type === 'interlude' && (!['title','key','meter','chords','mode','notes','note'].every(k => text(block[k], k === 'notes' ? 10000 : 2000)) || !['chords','melody'].includes(block.mode))) fail('추가 악보 정보가 올바르지 않습니다.');
      if (block.type === 'text' && !text(block.text)) fail('메모 정보가 올바르지 않습니다.');
    }
  }
  p.pageOrder = Array.isArray(p.pageOrder) ? p.pageOrder.filter(x => typeof x === 'string').slice(0, 1000) : [];
  p.approvals = p.approvals && typeof p.approvals === 'object' && !Array.isArray(p.approvals) ? p.approvals : {};
  return p;
}

// Existing page IDs keep their positions, including manually inserted image pages.
export function orderPages(pages, order) {
  const lookup = new Map(pages.map(p => [p.id, p]));
  const result = [];
  for (const id of order || []) if (lookup.has(id)) { result.push(lookup.get(id)); lookup.delete(id); }
  for (const page of pages) if (lookup.has(page.id)) { result.push(page); lookup.delete(page.id); }
  return result;
}

export function wrapText(ctx, text, maxWidth) {
  const result = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > maxWidth) { result.push(line); line = char; } else line += char;
    }
    result.push(line);
  }
  return result;
}
