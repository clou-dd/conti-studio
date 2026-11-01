import JSZip from 'jszip';
import { safeName, uid, fullCrop, validateProject } from './model.mjs';

const MAX_FILE = 20 * 1024 * 1024;
const MAX_PROJECT = 150 * 1024 * 1024;
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  // A user-clicked link works even after an async export outlives transient
  // browser activation, including on mobile Safari.
  window.dispatchEvent(new CustomEvent('conti:file-ready',{detail:{url,name,size:blob.size}}));
}
export function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다. PNG 또는 JPG로 다시 올려 주세요.')); img.src = src; });
}
const canvasBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('이미지 변환에 실패했습니다.')), 'image/png'));
function dataUrl(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
}
export async function imageAsset(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 100_000_000) throw new Error('이미지가 너무 큽니다. 크기를 줄여서 올려 주세요.');
    const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return { id: uid(), name: file.name, data: await dataUrl(await canvasBlob(canvas)), width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
export async function importScores(files, progress = () => {}) {
  const assets = [], failures = [];
  for (const file of files) {
    if (file.size > MAX_FILE) { failures.push(`${file.name}: 파일당 20MB까지 올릴 수 있습니다.`); continue; }
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
        const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
        const doc = await task.promise;
        try {
          if (doc.numPages > 20) throw new Error('PDF는 한 번에 20쪽까지 불러올 수 있습니다.');
          for (let i = 1; i <= doc.numPages; i++) {
            progress(`${file.name} · ${i}/${doc.numPages}쪽 불러오는 중`);
            const page = await doc.getPage(i); const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(3, 2200 / Math.max(base.width, base.height)) });
            const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
            assets.push({ id: uid(), name: `${file.name} · ${i}쪽`, data: await dataUrl(await canvasBlob(canvas)), width: canvas.width, height: canvas.height });
            canvas.width = 0; canvas.height = 0; page.cleanup();
          }
        } finally { await doc.destroy(); }
      } else if (/^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
        progress(`${file.name} 불러오는 중`); assets.push(await imageAsset(file));
      } else throw new Error('PDF, PNG, JPG, WebP 파일을 올려 주세요.');
    } catch (e) { failures.push(`${file.name}: ${e.name === 'PasswordException' ? '암호를 해제한 PDF를 올려 주세요.' : e.message}`); }
  }
  return { assets, failures };
}
export const scoreBlock = asset => ({ id: uid(), type: 'score', assetId: asset.id, crop: fullCrop(), label: '', annotations: [] });

let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('conti-studio', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('projects');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
export async function saveLocal(project, assets) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('projects','readwrite'); tx.objectStore('projects').put({ project, assets }, 'current');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function loadLocal() {
  const db = await database();
  return new Promise((resolve,reject) => { const req = db.transaction('projects').objectStore('projects').get('current'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export async function createProjectZip(project, assets) {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project, null, 2));
  const used = new Set(project.items.flatMap(i => i.type === 'image' ? [i.assetId] : i.blocks.filter(b => b.type === 'score').map(b => b.assetId)));
  const manifest = {};
  for (const id of used) {
    const a = assets[id]; if (!a) throw new Error('악보 원본이 누락되었습니다.');
    manifest[id] = { name: a.name, width: a.width, height: a.height };
    zip.file(`assets/${id}.png`, a.data.split(',')[1], { base64: true });
  }
  zip.file('assets.json', JSON.stringify(manifest));
  return zip.generateAsync({ type:'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 } });
}
export async function exportProject(project,assets){
  download(new Blob([await createProjectZip(project,assets)],{type:'application/zip'}),`${safeName(project.name)}_${project.date}.conti.zip`);
}
export async function importProject(file) {
  if (file.size > MAX_PROJECT) throw new Error('프로젝트는 150MB까지 불러올 수 있습니다.');
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
  const entries = Object.values(zip.files);
  if (entries.length > 700) throw new Error('프로젝트 안에 파일이 너무 많습니다.');
  // JSZip retains advertised uncompressed sizes; reject oversized ZIPs before inflation.
  if (entries.reduce((sum,e) => sum + (e._data?.uncompressedSize || 0), 0) > MAX_PROJECT) throw new Error('압축 해제한 프로젝트가 150MB를 초과합니다.');
  if (!zip.file('project.json') || !zip.file('assets.json')) throw new Error('Conti Studio 프로젝트 파일을 선택해 주세요.');
  const project = JSON.parse(await zip.file('project.json').async('string'));
  const manifest = JSON.parse(await zip.file('assets.json').async('string'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).length > 600) throw new Error('이미지 목록이 올바르지 않습니다.');
  const assets = {};
  for (const [id, meta] of Object.entries(manifest)) {
    if (!/^[\w-]{1,100}$/.test(id) || !zip.file(`assets/${id}.png`)) throw new Error('악보 이미지 파일이 누락되었습니다.');
    const bytes = await zip.file(`assets/${id}.png`).async('uint8array');
    if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error('프로젝트에 올바르지 않은 이미지가 있습니다.');
    const img = await imageAsset(new File([bytes], typeof meta.name === 'string' ? meta.name : '악보.png', { type:'image/png' }));
    assets[id] = { ...img, id };
  }
  return { project: validateProject(project, assets), assets };
}
