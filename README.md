# Speedrun Timer

Generates a countdown timer video for speedrun overlays and edits.
Milliseconds are rounded per frame at the exact FPS you choose, and the
video downloads as MP4 — no screen recording.

At 60 fps the frames read `00:00.000 → 00:00.017 → 00:00.033 …`, never
`016.677`. A 60-second video ends on `01:00.000`.

## Run it

Open `index.html` in Chrome or Edge. For MP4 export, serve it instead:

```sh
python -m http.server 8000
# http://localhost:8000
```

Everything runs locally in the browser. No uploads, no accounts.

## How to use

1. Set the video duration (`90`, `1:30`, `10:00.000`).
2. Set the exact FPS (`30`, `60`, `59.94`, `120`, `144`, or any value 1–240).
   The exported video runs at that same FPS.
3. Adjust resolution, background, color, and font. Use the green background
   with Chroma Key in your editor if you need transparency.
4. Press **Download MP4 video**. Encoding is offline, so you can minimize
   the tab while it works — just don't close it.

## Notes

- The video always ends on the round number: frame count is
  `round(duration × fps) + 1`.
- H.264 has no alpha channel. A transparent background exports as matte
  black; use green chroma + Chroma Key instead.
- MP4 export needs Chrome or Edge (WebCodecs) and the page served over
  `http://localhost`, not `file://`. Other browsers fall back to
  MediaRecorder (MP4 if supported, otherwise WebM, in real time).

## Files

- `index.html`, `style.css`, `app.js` — the app
- `timer-core.js` — frame math (quantization, formatting, duration parsing)
- `export-mp4.js`, `mp4-muxer.mjs` — offline H.264 encoding + MP4 muxing
