// LinkSeg: in-browser music-structure analysis. Byte-exact port of the LinkSeg PyTorch/DGL model
// (mel front-end in JS, dense-tensor ONNX model via onnxruntime-web, decode in JS).
//
// Validated byte-exact against the Python DGL model end-to-end (dense == DGL < 6e-6; python-ort
// decodes identically; ort-web WASM + WebGPU decode identically in-browser). See the drum-to-chart
// analysis/linkseg_eval/port validation ladder and this repo's validation/ harness.

import * as ort from 'onnxruntime-web/wasm';
import {getModelBytes, type ProgressEvent} from './model-cache';
import {buildLinkSegWindows} from './windows';
import {melForWindows, LINKSEG_N_MELS, LINKSEG_MEL_FRAMES, LINKSEG_SR} from './mel';
import {linksegDecode, LINKSEG_LABELS} from './decode';
import {resampleTo22050} from './resample';
import {LABEL_NAMES, toSections, type Backend, type LinkSegSections, type Section} from './types';

// Default hosted model (CC-BY 4.0; see attribution). Cached in OPFS after first download.
const DEFAULT_MODEL_URL =
  'https://huggingface.co/elicwhite/linkseg-7c-onnx/resolve/main/linkseg_7c.onnx';
const CACHE_KEY = 'linkseg_7c_v1.onnx';
const MIN_BYTES = 1_000_000; // real size ~1.5 MB

// Recall-favoring operating point (tau=0): mild benign over-segmentation, high boundary recall.
export const DEFAULT_TAU = 0;
// Peak-picking neighborhood (seconds, symmetric past/future) — the reference's max_past/max_future.
// This is the musically interpretable control: smaller window -> more local peaks survive -> finer
// segmentation; larger window -> nearby peaks suppressed -> coarser segmentation.
export const DEFAULT_PEAK_WINDOW_SECONDS = 8;
// Minimum beats for a meaningful graph (below this LinkSeg can't build a graph).
const MIN_BEATS = 4;

export interface LoadOptions {
  /** Override the model URL (defaults to the Hugging Face-hosted CC-BY model). */
  modelUrl?: string;
  /** Execution provider: 'webgpu' | 'wasm' | 'auto' (default 'auto'). */
  backend?: Backend;
  /** OPFS cache key (default 'linkseg_7c_v1.onnx'). */
  cacheKey?: string;
  /** Download/progress callback. */
  onProgress?: (e: ProgressEvent) => void;
}

export interface AnalyzeOptions {
  /** Mono PCM. If `sampleRate` != 22050 it is resampled internally. */
  audio: Float32Array;
  /** Sample rate of `audio` (default 22050). */
  sampleRate?: number;
  /** REQUIRED beat times (seconds). Product supplies its own beat tracker; the demo estimates. */
  beats: number[];
  /** Optional downbeat times (seconds). Not required by the model; accepted for API symmetry. */
  downbeats?: number[];
  /**
   * Segmentation granularity: half-width (seconds) of the peak-picking neighborhood, applied
   * symmetrically to past and future (default 8). Smaller = finer/more boundaries, larger =
   * coarser/fewer.
   */
  peakWindowSeconds?: number;
  /** Advanced: absolute threshold on the boundary activation (default 0). Higher = fewer boundaries. */
  tau?: number;
  /** Merge adjacent sections with the same display label (default false). */
  mergeRepeatedLabels?: boolean;
}

/** Mel windows + the processed beat times the model will see. */
export interface MelWindows {
  /** Flat mel tensor data, layout (N,1,64,64) = [n*4096 + mel*64 + time]. */
  mel: Float32Array;
  /** Number of beat windows (N). */
  count: number;
  /** Beat times (s) the model sees, after LinkSeg's requantization (length N). */
  beatTimes: number[];
}

/** Raw model activations. */
export interface Activations {
  /** Boundary activations, length N-1. */
  bound: Float32Array;
  /** Class activations, flat row-major (N x 7). */
  label: Float32Array;
}

/**
 * Compute the mel windows LinkSeg feeds to the model. Pure (no model needed) so a caller that has
 * already computed 22050 audio + beats can run just this. Async because resampling non-22050 audio
 * uses the browser's OfflineAudioContext.
 */
export async function computeMelWindows(opts: {
  audio: Float32Array;
  beats: number[];
  sampleRate?: number;
}): Promise<MelWindows> {
  const sampleRate = opts.sampleRate ?? LINKSEG_SR;
  const wave = await resampleTo22050(opts.audio, sampleRate);
  const {beatTimes, windows} = buildLinkSegWindows(opts.beats, wave);
  const mel = melForWindows(windows);
  return {mel, count: windows.length, beatTimes};
}

/**
 * Decode raw activations into functional sections with product-facing labels. Peak-picked
 * boundaries are preserved by default, including boundaries between adjacent sections that receive
 * the same label. Pure — lets a caller re-decode at a different granularity from cached
 * activations with no re-inference (the demo's granularity slider does exactly this).
 */
export function decode(
  bound: Float32Array | number[],
  label: Float32Array,
  beatTimes: number[],
  duration: number,
  opts: {peakWindowSeconds?: number; tau?: number; mergeRepeatedLabels?: boolean} = {},
): Section[] {
  const win = opts.peakWindowSeconds ?? DEFAULT_PEAK_WINDOW_SECONDS;
  const raw = linksegDecode(
    bound,
    label,
    beatTimes,
    duration,
    Object.keys(LINKSEG_LABELS).length,
    win,
    win,
    opts.tau ?? DEFAULT_TAU,
  );
  const mapped = toSections(mapLabels(raw));
  return opts.mergeRepeatedLabels ? mergeRepeatedSections(mapped) : mapped;
}

/** Map raw 7-class labels to product-facing names without changing any boundaries. */
export function mapLabels(raw: LinkSegSections): LinkSegSections {
  return {times: [...raw.times], labels: raw.labels.map(l => LABEL_NAMES[l] ?? l)};
}

/** Merge adjacent display sections with identical labels into a simplified summary. */
export function mergeRepeatedSections(sections: Section[]): Section[] {
  const merged: Section[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (previous && previous.label === section.label) {
      previous.end = section.end;
    } else {
      merged.push({...section});
    }
  }
  return merged;
}

/** Backward-compatible edge-representation helper: map labels, then merge repeated sections. */
export function mapAndMerge(raw: LinkSegSections): LinkSegSections {
  const sections = mergeRepeatedSections(toSections(mapLabels(raw)));
  return {
    times: sections.length
      ? [sections[0].start, ...sections.map(section => section.end)]
      : raw.times.length
        ? [raw.times[0]]
        : [],
    labels: sections.map(section => section.label),
  };
}

async function createSession(
  bytes: Uint8Array,
  backend: Backend,
): Promise<{session: ort.InferenceSession; backend: 'webgpu' | 'wasm'}> {
  const common = {graphOptimizationLevel: 'all' as const};
  const wantGpu =
    backend !== 'wasm' && typeof navigator !== 'undefined' && !!(navigator as any).gpu;

  if (wantGpu) {
    try {
      const session = await ort.InferenceSession.create(bytes, {
        ...common,
        executionProviders: ['webgpu'],
      });
      return {session, backend: 'webgpu'};
    } catch (e) {
      if (backend === 'webgpu') throw e; // explicit webgpu request: surface the failure
      // auto: fall through to wasm
    }
  }
  const session = await ort.InferenceSession.create(bytes, {
    ...common,
    executionProviders: ['wasm'],
  });
  return {session, backend: 'wasm'};
}

/**
 * LinkSeg model handle. Load once with {@link LinkSeg.load}, then call {@link LinkSeg.analyze}
 * (or the composable {@link LinkSeg.runModel} / {@link computeMelWindows} / {@link decode}).
 */
export class LinkSeg {
  private constructor(
    private readonly session: ort.InferenceSession,
    /** The execution provider actually in use ('webgpu' or 'wasm'). */
    public readonly backend: 'webgpu' | 'wasm',
  ) {}

  /** Download (OPFS-cached) + initialize the model. */
  static async load(opts: LoadOptions = {}): Promise<LinkSeg> {
    const bytes = await getModelBytes({
      url: opts.modelUrl ?? DEFAULT_MODEL_URL,
      key: opts.cacheKey ?? CACHE_KEY,
      minBytes: MIN_BYTES,
      onProgress: opts.onProgress,
    });
    const {session, backend} = await createSession(bytes, opts.backend ?? 'auto');
    return new LinkSeg(session, backend);
  }

  /** Run the ONNX model on precomputed mel windows. Composable: pair with {@link computeMelWindows}. */
  async runModel(mel: MelWindows): Promise<Activations> {
    const melT = new ort.Tensor('float32', mel.mel, [
      mel.count,
      1,
      LINKSEG_N_MELS,
      LINKSEG_MEL_FRAMES,
    ]);
    const out = await this.session.run({mel: melT});
    return {
      bound: out['bound'].data as Float32Array,
      label: out['label'].data as Float32Array,
    };
  }

  /**
   * Full pipeline: full-mix audio + beats -> functional sections. Returns [] when there are too
   * few beats to build a graph. No source separation is needed — LinkSeg runs on the full mix.
   */
  async analyze(opts: AnalyzeOptions): Promise<Section[]> {
    const sampleRate = opts.sampleRate ?? LINKSEG_SR;
    if (opts.beats.length < MIN_BEATS) return [];
    const duration = opts.audio.length / sampleRate;

    const win = await computeMelWindows({
      audio: opts.audio,
      beats: opts.beats,
      sampleRate,
    });
    if (win.count < MIN_BEATS) return [];

    const act = await this.runModel(win);
    return decode(act.bound, act.label, win.beatTimes, duration, {
      peakWindowSeconds: opts.peakWindowSeconds ?? DEFAULT_PEAK_WINDOW_SECONDS,
      tau: opts.tau ?? DEFAULT_TAU,
      mergeRepeatedLabels: opts.mergeRepeatedLabels ?? false,
    });
  }
}

