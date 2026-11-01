# Browser audio analysis — v0.2.0

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
