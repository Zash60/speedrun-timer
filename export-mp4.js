// export-mp4.js — OFFLINE H.264 MP4 encoding via WebCodecs + mp4-muxer (vendored).
// Because it is offline (absolute timestamps, no wall clock), the export
// KEEPS GOING with the tab in the background / screen off — just don't
// close the tab. No pacing timers: the loop is promise-driven.
import { Muxer, ArrayBufferTarget } from './mp4-muxer.mjs?v=20260910d';

const AVC_CODECS = [
  'avc1.640034', // High L5.2 (4K ok)
  'avc1.640033', // High L5.1
  'avc1.640028', // High L4.0
  'avc1.4d0028', // Main L4.0
  'avc1.420028', // Baseline L4.0
  'avc1.42001f', // Baseline L3.1 (last resort)
];

async function pickCodec(width, height, bitrate, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC_CODECS) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec, width, height, bitrate,
        framerate: Math.max(1, Math.round(fps)),
      });
      if (s && s.supported) return codec;
    } catch { /* tenta o próximo */ }
  }
  return null;
}

function even(n) { return n - (n % 2); }

window.MP4Export = {
  supported() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  },

  // draw(ctx, W, H, frame) — paints frame N onto the given context.
  // onProgress(0..1) — called per batch (may update UI).
  async export({ fps, frames, bitrate, draw, onProgress }) {
    if (!this.supported()) throw new Error('WebCodecs indisponível');
    let probe = draw.probe();
    let W = even(probe.W), H = even(probe.H);
    const codec = await pickCodec(W, H, bitrate, fps);
    if (!codec) throw new Error('H.264 indisponível neste navegador');

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      fastStart: 'in-memory', // moov up front → players open it instantly
      video: { codec: 'avc', width: W, height: H },
    });

    let encodeErr = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encodeErr = e; },
    });
    encoder.configure({
      codec, width: W, height: H, bitrate,
      framerate: Math.max(1, Math.round(fps)),
    });

    const T = window.TimerCore;
    const keyInt = Math.max(1, Math.round(fps * 2)); // keyframe roughly every 2s
    try {
      for (let f = 0; f < frames; f++) {
        if (encodeErr) throw encodeErr;
        draw(ctx, W, H, f);
        const vf = new VideoFrame(canvas, {
          timestamp: T.frameTimestampUs(f, fps),
          duration: T.frameDurationUs(fps),
        });
        encoder.encode(vf, { keyFrame: f % keyInt === 0 });
        vf.close();
        // light backpressure: avoids a huge queue on long videos
        if (encoder.encodeQueueSize > 20) await encoder.flush();
        if (f % 24 === 0) {
          if (onProgress) onProgress(f / frames);
          // yield for UI (setTimeout(0) still fires in background, just slower)
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (onProgress) onProgress(1);
      await encoder.flush();
      if (encodeErr) throw encodeErr;
    } finally {
      try { encoder.close(); } catch { /* noop */ }
    }
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  },
};
