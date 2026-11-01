import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/models', { recursive: true });
await cp('node_modules/@spotify/basic-pitch/model', 'public/models/basic-pitch', { recursive: true });
await mkdir('public/wasm', { recursive: true });
for (const file of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  await cp(`node_modules/onnxruntime-web/dist/${file}`, `public/wasm/${file}`);
}
await mkdir('public/licenses', { recursive: true });
await cp('node_modules/@spotify/basic-pitch/LICENSE', 'public/licenses/basic-pitch.txt');
await cp('src/vendor/linkseg/LICENSE', 'public/licenses/linkseg-web.txt');
