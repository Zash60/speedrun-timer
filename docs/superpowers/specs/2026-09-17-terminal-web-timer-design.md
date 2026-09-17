# Terminal + Web Timer — Design Spec

Date: 2026-09-17
Status: proposed, awaiting user review
Goal: fast native MP4 timer generation (C++ engine) controllable from
both the terminal and the existing web page, with zero behavior change
to the current browser-only flow.

## Architecture

Three pieces, one contract (the golden rule: displayed
`ms = round(frame * 1000 / fps)`, ported 1:1 from `timer-core.js`):

1. `timer-cli` (C++, single file `timer-cli.cpp`) — renders frames with
   FreeType over a solid background, pipes `rawvideo rgb24` to the
   system `ffmpeg` binary (`h264_mediacodec`, fallback `libx264`).
2. `server.cjs` (Node, evolved from `receiver.cjs`) — job API around the
   binary: spawn, progress, download.
3. `index.html` — engine selector: **Browser** (WebCodecs, unchanged
   default) or **Local (fast)** (delegates to the server).

## CLI contract

```
timer-cli --duration 1:00 --fps 60 --width 1920 --height 1080 \
  --bg 00ff00 --fg ffffff --font-size 160 \
  --font /system/fonts/DroidSansMono.ttf --format auto \
  --encoder auto --out timer.mp4
```

- `--duration`: same spellings as the web app (`90`, `1:30`,
  `10:00.000`, `1:02:03`); zero/negative rejected with
  `duration must be > 0`.
- `--format`: `auto hms-ms ms-ms hms ms s-ms`, identical semantics to
  `formatMs` (auto shows hours only at >= 1h).
- `--encoder`: `auto` (mediacodec, fallback libx264) | `libx264` |
  `mediacodec`. Unknown names are an error, never a silent fallback.
- `--out`: output path (parent dir must exist). `--dump-frames` prints
  `index text` per frame to stdout and encodes nothing (cross-checks).
- Machine progress: `PROGRESS <done> <total>` lines on stderr per batch;
  final line `DONE <path> <bytes>`.
- Exit codes: `0` ok, `1` bad args, `2` missing font/ffmpeg, `3` encode
  failure. All errors go to stderr, human-readable.

## Server API

- `POST /api/render` `{duration, fps, width, height, bg, fg, fontSize,
  font, format, encoder}` → `202 {jobId}` (validates ranges: fps 1–240,
  duration 0–3600s, dims 160–3840 x 120–2160).
- `GET /api/events?job=<id>` (SSE): `progress {done,total}`,
  `done {url}`, `error {message}`.
- `GET /api/jobs/:id/download` → the MP4. Jobs + files expire after
  30 min (sweeper). Concurrency cap: 1 encode at a time, extras get
  `429 {error}`.
- Existing `POST /upload` behavior is kept unchanged.
- Runaway guard: jobs with no progress output for 120s are killed and
  reported as `error`.

## Web changes

- Engine selector (Browser default | Local) persisted in localStorage.
- Local flow: POST job → SSE progress drives the existing bar/ETA →
  auto-download on done → same success message format as today.
- Server unreachable / job error → visible warning + one-click retry on
  the Browser engine. No dead ends.

## Error handling

Every layer fails loudly: CLI nonzero exit + stderr; server maps those
to SSE `error` (never hangs: spawn timeout kills runaway jobs);
page surfaces warnings in the export button + progress title (existing
pattern). No silent fallbacks except the documented mediacodec→libx264
one inside the CLI.

## Testing

1. Cross-check: `--dump-frames` output byte-identical to `timer-core.js`
   for a matrix of durations/fps/formats (Node harness).
2. End-to-end: render via API, SSE reaches 100%, `ffprobe` duration
   exact, last frame shows the round number.
3. Resilience: server down → Browser engine path works; bad params →
   `4xx` + UI warning; two concurrent jobs → one `429`.
4. Bench: CLI vs WebCodecs on 720p/5s/60fps and 1080p/5s/60fps.

## Non-goals

No preview/playback in the CLI, no auth/multi-user, no deployment story
beyond localhost, no changes to the Browser engine path.
