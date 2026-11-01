# Browser audio analysis — v0.5.0

## Flow

YouTube reference link → explicit tab audio sharing and real-time playback, or uploaded audio → 22050 Hz mono PCM → LinkSeg (WASM worker) → editable boundaries and labels → song form. A selected 1–60 second clip → Spotify Basic Pitch (CPU worker) → quantized single-line ABC + triad chord candidates → editable preview → existing score block → PNG/PDF.

No application backend, shared API key, CORS proxy, downloader service, or audio upload is used. A public LinkSeg ONNX model is downloaded from Hugging Face on first use; Basic Pitch weights and ONNX runtime assets are served with the static site.

## Limits

- YouTube link-only extraction is not implemented. Audio sharing requires explicit browser permission and real-time playback.
- Tab audio capture targets desktop Chromium. iOS/iPadOS need an audio file.
- Captured timestamps start at recording time, including any wait before music starts.
- Constant-tempo energy-based beat estimates can be corrected via BPM. Variable-tempo live worship needs manual correction.
- Section names map Verse→A, Chorus→B, Bridge→C; they do not identify the letters printed on an uploaded scan.
- Basic Pitch is strongest on a single instrument. The draft chooses one strong pitch candidate per grid position from the mixed track; this is not source separation. Chords are coarse major/minor triad candidates.
- Analysis audio is transient. Applied form metadata and added score blocks survive browser/project saves; audio does not.

## Source attribution

`src/vendor/linkseg` is copied from elicwhite/LinkSeg-web; source blob SHAs were verified through GitHub. MIT code, with copyright notice retained. The only adaptation to the port is using the WASM entry point of ONNX Runtime. Model: M. Buisson, B. McFee, S. Essid, Using Pairwise Link Prediction and Graph Attention Networks for Music Structure Analysis, ISMIR 2024. The port's model card specifies CC BY 4.0.

Spotify Basic Pitch TypeScript 1.0.1, Apache 2.0; license served at `/licenses/basic-pitch.txt`. LinkSeg-web license served at `/licenses/linkseg-web.txt`.

## Verification

Automated tests exercise a known 100 BPM pulse track, silence rejection, pitch selection, bar-spanning ties, compound-meter bar counts, invalid overlapping sections, existing archive/PDF generation. Browser checks use an original synthetic 32-second clip, never fabricated output for a real YouTube link. Live YouTube capture and real-song accuracy still require a user's browser permission and an actual music source.

## Full-song draft

The same Basic Pitch worker can process a whole song in bar-aligned chunks (at most 16 bars / 60 seconds), loading its model once. Each resulting block has a melody line, coarse chord candidates and the source time range. Users can edit blocks individually or add all to the existing score. This is not instrument-separated orchestration or automatic optical matching to an uploaded scan.

Client limits: audio 50 MB / 10 minutes; score files 20 MB; PDF 20 pages per import. Limits protect client memory and time, not a Vercel upload API. Versioned Basic Pitch and WASM assets carry immutable long-lived cache headers. Legacy unversioned paths remain for clients from the previous deployment.

## Key estimation and single-line notation

Audio is sampled in half-second steps with a Hann-window FFT and interpolated spectral peaks. The accumulated chroma is ranked against Krumhansl–Kessler major/minor profiles. Similarity gaps are qualitative candidate-separation labels, not probabilities. Silence or insufficient pitch diversity yields no key. A separate lightweight worker runs this automatically after audio input. Manual key selection overrides the estimate for transcription. Generated notation uses that key signature, tracks accidental state per bar, and quantizes timing to sixteenths (written with L:1/8 fractional lengths). Key-signature edits preserve absolute pitches rather than transposing them. No source separation is claimed.

## Compact score output

Analysis chunks remain the editable, saved source. An optional reversible `compactLayout` view flattens them across chunk boundaries, folds only exactly matching notes and chords in four/eight-bar phrases, and emits each unique phrase once with an A/B/C performance order. Ties crossing phrase boundaries are not folded. Different endings stay separate. No approximate similarity or semantic Verse/Chorus matching is claimed; noisy repeat transcriptions may need correction before they can fold.

The compact form replaces the original form only in this output view. Original blocks and form remain in autosave/archive. All blocks must be melody notation in the same key/meter; mixed scans or text fall back visibly to basic layout. Compact output supports up to 1,200 source bars and 256 unique bars. It fits one A4 page if possible, with a minimum of 82% normal staff scale. Longer output paginates only between ABCJS system ink bounds; missing safe boundaries produces a review warning, never silent staff clipping.

Local rendering checks: ten 16-bar chunks containing the same eight-bar phrase became one eight-bar page; 128 unique bars became three pages, without review warnings. Automated tests cover reversible folding, performance-order reconstruction, different endings/chords, cross-boundary ties, ABC section/key syntax, fit scale, mixed-block rejection and saved compact-view settings.
