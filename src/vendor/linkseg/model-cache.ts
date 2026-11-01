/**
 * Cache the ONNX model in the Origin Private File System (OPFS): download once,
 * then load from local storage on subsequent visits. Streams the download
 * straight into OPFS so the memory peak during fetch stays near one chunk.
 *
 * Adapted from the drum-to-chart / bs-roformer-web model-cache.
 */

const OPFS_DIR = 'linkseg-web';

export type ProgressEvent = {
  phase: 'fetching' | 'ready';
  loaded: number;
  total: number;
  etaSec?: number;
};

const getDir = async () =>
  (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR, {create: true});

async function getHandleIfExists(dir: FileSystemDirectoryHandle, name: string) {
  try {
    return await dir.getFileHandle(name);
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') return null;
    throw e;
  }
}

// Reject buffers that obviously aren't an ONNX model: too small, or an error
// page / git-lfs pointer the host returned with a 200.
function assertLooksLikeModel(bytes: Uint8Array, minBytes: number): void {
  if (bytes.byteLength < minBytes) {
    throw new Error(
      `The model didn't download fully (got ${(bytes.byteLength / 1e6).toFixed(1)} MB, ` +
        `expected ~${(minBytes / 1e6).toFixed(1)} MB). The download was likely interrupted.`,
    );
  }
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09))
    i++;
  const c = bytes[i];
  // '<' HTML, '{' or '[' JSON error body, git-lfs pointer starts with 'version https://…'.
  if (c === 0x3c || c === 0x7b || c === 0x5b) {
    throw new Error("The model host returned an error page instead of the model file.");
  }
}

async function downloadToOPFS(
  url: string,
  key: string,
  onProgress?: (e: ProgressEvent) => void,
): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status} ${resp.statusText}`);
  const total = +(resp.headers.get('content-length') ?? 0) || 0;

  const dir = await getDir();
  const tmpKey = `${key}.part`;
  const tmpHandle = await dir.getFileHandle(tmpKey, {create: true});
  const writable = await tmpHandle.createWritable();

  const reader = resp.body!.getReader();
  let loaded = 0;
  const t0 = performance.now();
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      const elapsed = (performance.now() - t0) / 1000;
      const etaSec = total && loaded ? (elapsed * (total - loaded)) / loaded : undefined;
      onProgress?.({phase: 'fetching', loaded, total, etaSec});
    }
  } finally {
    await writable.close();
  }

  // Promote .part -> key. Fall back to a byte-copy where FileSystemHandle.move is unsupported.
  await dir.removeEntry(key).catch(() => {});
  const anyHandle = tmpHandle as FileSystemFileHandle & {move?: (name: string) => Promise<void>};
  if (anyHandle.move) {
    await anyHandle.move(key);
  } else {
    const finalH = await dir.getFileHandle(key, {create: true});
    const w = await finalH.createWritable();
    await w.write(await (await tmpHandle.getFile()).arrayBuffer());
    await w.close();
    await dir.removeEntry(tmpKey).catch(() => {});
  }
}

/**
 * Get the model bytes: load from OPFS if cached, otherwise download `url` and cache it.
 * If OPFS is unavailable, downloads without caching.
 */
export async function getModelBytes(opts: {
  url: string;
  key: string;
  minBytes?: number;
  onProgress?: (e: ProgressEvent) => void;
}): Promise<Uint8Array> {
  const {url, key, minBytes = 1_000_000, onProgress} = opts;
  try {
    const dir = await getDir();
    if (!(await getHandleIfExists(dir, key))) {
      await downloadToOPFS(url, key, onProgress);
    }
    const file = await (await dir.getFileHandle(key)).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      assertLooksLikeModel(bytes, minBytes);
    } catch (e) {
      // Poisoned cache entry (e.g. a cached error page): drop it and retry once.
      await dir.removeEntry(key).catch(() => {});
      await downloadToOPFS(url, key, onProgress);
      const retry = new Uint8Array(await (await (await dir.getFileHandle(key)).getFile()).arrayBuffer());
      assertLooksLikeModel(retry, minBytes);
      onProgress?.({phase: 'ready', loaded: retry.byteLength, total: retry.byteLength});
      return retry;
    }
    onProgress?.({phase: 'ready', loaded: bytes.byteLength, total: bytes.byteLength});
    return bytes;
  } catch (e) {
    // OPFS itself unavailable — download without cache, still validated.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status} ${resp.statusText}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    assertLooksLikeModel(bytes, minBytes);
    onProgress?.({phase: 'ready', loaded: bytes.byteLength, total: bytes.byteLength});
    return bytes;
  }
}

