// app.js — preview + frame-exact export. Depends on timer-core.js (window.TimerCore).
(() => {
  'use strict';
  const T = window.TimerCore;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');

  // No status block in the UI: export feedback goes to the button + progress title.
  function flashExport(txt) {
    const b = $('btnExport');
    if (!b) return;
    if (b.dataset.orig === undefined) b.dataset.orig = b.innerHTML;
    b.textContent = txt.slice(0, 90);
    clearTimeout(b.dataset.t);
    b.dataset.t = setTimeout(() => { b.innerHTML = b.dataset.orig; }, 6000);
  }
  function makeStatusSink() {
    const sink = {};
    Object.defineProperty(sink, 'innerHTML', {
      set(v) {
        const txt = String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const prog = $('prog');
        if (prog) prog.title = txt;
        if (/^(✅|❌|⚠️)/.test(txt)) flashExport(txt);
      },
      get() { return ''; },
    });
    return sink;
  }
  const ui = {
    duration: $('duration'), fps: $('fps'), w: $('w'), h: $('h'),
    bg: $('bg'), bgCustom: $('bgCustom'), fg: $('fg'),
    fontSize: $('fontSize'), fontSizeVal: $('fontSizeVal'),
    font: $('font'), fmt: $('fmt'), stroke: $('stroke'),
    bitrate: $('bitrate'), bitrateVal: $('bitrateVal'),
    durInfo: $('durInfo'), fpsInfo: $('fpsInfo'), fpsChip: $('fpsChip'),
    seek: $('seek'), timeLabel: $('timeLabel'), frameLabel: $('frameLabel'),
    frameStrip: $('frameStrip'), prog: $('prog'), status: $('status') || makeStatusSink(),
    rtVideoFps: $('rtVideoFps'), rtStart: $('rtStart'), rtEnd: $('rtEnd'),
    rtOut: $('rtOut'),
    rtFile: $('rtFile'), rtVideo: $('rtVideo'), btnExportGameplay: $('btnExportGameplay'),
    rtPlay: $('rtPlay'), rtBack: $('rtBack'), rtFwd: $('rtFwd'), rtSeek: $('rtSeek'),
    rtTime: $('rtTime'), rtCanvas: $('rtCanvas'),
    rtOverlaySize: $('rtOverlaySize'), rtOverlaySizeVal: $('rtOverlaySizeVal'),
    btnPlay: $('btnPlay'), btnRestart: $('btnRestart'),
    btnExport: $('btnExport'), btnPng: $('btnPng'),
  };

  let state = { dur: 60, fps: 60, frames: 3600, cur: 0, playing: false, raf: 0, last: 0, acc: 0, overlay: { x: 0.5, y: 0.85, size: 12 }, videoFile: null };

  // Font styles: webfonts (Google Fonts CDN, nothing bundled in the repo) first,
  // system stacks as offline fallback. document.fonts.load guarantees the
  // webfont is ready before preview redraw and export (see refresh/exportVideo).
  const FONT_STYLES = {
    mono:    { family: "'JetBrains Mono','Cascadia Mono',Consolas,'Roboto Mono',monospace", weight: 700, style: '', spacing: '0px' },
    sans:    { family: "'Archivo',Arial,Helvetica,Roboto,sans-serif", weight: 700, style: '', spacing: '0px' },
    serif:   { family: "Georgia,'Noto Serif','Times New Roman',serif", weight: 700, style: '', spacing: '0px' },
    black:   { family: "'Archivo Black','Arial Black',sans-serif", weight: 400, style: '', spacing: '0px' },
    display: { family: "'Bebas Neue','Arial Narrow',sans-serif", weight: 400, style: '', spacing: '2px' },
    tech:    { family: "'Orbitron','JetBrains Mono',monospace", weight: 700, style: '', spacing: '1px' },
  };
  function currentFont() {
    return FONT_STYLES[ui.font.value] || FONT_STYLES.mono;
  }
  function fontCss(f, px) {
    return `${f.style ? f.style + ' ' : ''}${f.weight} ${px}px ${f.family}`;
  }
  // No-wobble CENTERED layout: proportional digits have different widths, so a
  // plain centered string shifts every frame. Emulate tabular figures instead:
  // every digit gets the widest digit cell, separators keep their own width,
  // spacing is applied manually (works even where ctx.letterSpacing is missing).
  // Constant total width + centered block = stable and centered.
  const WIDEST_SAMPLE = '88:88:88.888';
  function fitFont(octx, fnt, startPx, maxW) {
    let px = startPx;
    const setF = (s) => { octx.font = fontCss(fnt, s); };
    setF(px);
    let guard = 0;
    while (octx.measureText(WIDEST_SAMPLE).width > maxW && px > 10 && guard++ < 200) { px -= 4; setF(px); }
    return px;
  }
  function drawTimerText(octx, text, W, H, px, fnt, pos) {
    octx.font = fontCss(fnt, px);
    octx.textAlign = 'left'; octx.textBaseline = 'middle';
    const sp = parseFloat(fnt.spacing) || 0;
    let digitW = 0;
    for (let d = 0; d <= 9; d++) digitW = Math.max(digitW, octx.measureText(String(d)).width);
    const adv = (ch) => (/\d/.test(ch) ? digitW : octx.measureText(ch).width) + sp;
    let total = 0;
    for (const ch of text) total += adv(ch);
    total -= sp; // no trailing space
    let x = (W - total) / 2, cy = H / 2;
    if (pos) { // overlay position (relative 0..1), clamped on-canvas
      x = Math.max(0, Math.min(W - total, pos.x * W - total / 2));
      cy = pos.y * H;
    }
    if (ui.stroke.checked) {
      octx.lineWidth = Math.max(2, px / 18); octx.strokeStyle = 'rgba(0,0,0,.85)';
      let sx = x;
      for (const ch of text) { octx.strokeText(ch, sx, cy); sx += adv(ch); }
    }
    octx.fillStyle = ui.fg.value;
    octx.shadowColor = 'rgba(0,0,0,.55)'; octx.shadowBlur = px / 25;
    for (const ch of text) { octx.fillText(ch, x, cy); x += adv(ch); }
    octx.shadowBlur = 0;
  }
  // Webfont readiness: redraw once the selected family arrives; try once per
  // spec so offline fallback never loops.
  const fontTried = new Set();
  function fontSpec(f) {
    return `${f.style ? f.style + ' ' : ''}${f.weight} 32px ${f.family}`;
  }
  function ensureFontDrawn() {
    try {
      if (!('fonts' in document) || !document.fonts.check) return;
      const spec = fontSpec(currentFont());
      if (!fontTried.has(spec)) {
        fontTried.add(spec);
        document.fonts.load(spec).then(() => refresh()).catch(() => {});
      }
    } catch { /* offline or old browser: system fallback stays */ }
  }
  async function ensureFontsBlocking() {
    try {
      await document.fonts.load(fontSpec(currentFont()));
      await document.fonts.ready;
    } catch { /* export proceeds with fallback */ }
  }

  function bgColor() {
    if (ui.bg.value === 'custom') return ui.bgCustom.value;
    if (ui.bg.value === 'transparent') return null;
    return ui.bg.value;
  }

  function readConfig() {
    const dur = T.parseDuration(ui.duration.value);
    let fps = parseFloat(String(ui.fps.value).replace(',', '.'));
    if (!isFinite(fps) || fps < 1 || fps > 240) throw new Error('FPS must be between 1 and 240 (decimals allowed, e.g. 59.94).');
    const W = Math.min(3840, Math.max(160, parseInt(ui.w.value, 10) || 1920));
    const H = Math.min(2160, Math.max(120, parseInt(ui.h.value, 10) || 1080));
    return { dur, fps, W, H };
  }

  function drawFrame(frame) {
    const { W, H } = readConfigSafe();
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const bg = bgColor();
    ctx.clearRect(0, 0, W, H);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    const text = T.frameToText(frame, state.fps, { showHours: ui.fmt.value });
    // tabular-emulated, centered, zero wobble
    const fnt = currentFont();
    const px = fitFont(ctx, fnt, parseInt(ui.fontSize.value, 10), W * 0.92);
    drawTimerText(ctx, text, W, H, px, fnt);
    return text;
  }

  function readConfigSafe() {
    try { const c = readConfig(); return c; }
    catch { return { dur: state.dur, fps: state.fps, W: parseInt(ui.w.value, 10) || 1920, H: parseInt(ui.h.value, 10) || 1080 }; }
  }

  // Light per-frame update (playback/video): static labels untouched.
  function refreshFrame() {
    state.cur = Math.max(0, Math.min(state.cur, state.frames - 1));
    ui.seek.value = state.cur;
    const txt = drawFrame(state.cur);
    ui.timeLabel.textContent = txt;
    ui.frameLabel.textContent = `frame ${state.cur}/${state.frames - 1}`;
    drawComposite();
  }
  function refresh() {
    try {
      const { dur, fps } = readConfig();
      state.dur = dur; state.fps = fps;
      state.frames = T.totalFrames(dur, fps);
    } catch (e) { ui.status.innerHTML = '⚠️ ' + e.message; return; }
    ui.seek.max = state.frames - 1;
    const fMs = (1000 / state.fps);
    ui.fpsChip.textContent = `${state.fps} fps · frame = ${fMs.toFixed(3)} ms`;
    ui.durInfo.innerHTML = `<b>${state.frames}</b> frames · <b>${state.dur.toFixed(3)}s</b> video at <b>${state.fps} fps</b>`;
    const ex = [0, 1, 2, 3, 4].map(f => T.frameToMs(f, state.fps)).join(' · ');
    ui.fpsInfo.textContent = `${state.fps}fps → ${ex} … (round(frame×1000÷fps))`;
    ui.fontSizeVal.textContent = ui.fontSize.value + 'px';
    ui.bitrateVal.textContent = ui.bitrate.value + ' Mbps';
    // frame strip: first 8 + last
    const head = Array.from({ length: Math.min(8, state.frames) }, (_, f) => T.frameToText(f, state.fps, { showHours: ui.fmt.value }));
    const last = T.frameToText(state.frames - 1, state.fps, { showHours: ui.fmt.value });
    ui.frameStrip.textContent = `frames: ${head.join('  ')}  …  ${last}`;
    ensureFontDrawn();
    if (typeof paintAllRanges === 'function') paintAllRanges();
    refreshFrame();
  }

  // ---- transport (realtime preview) ----
  function loop(t) {
    if (!state.playing) return;
    if (!state.last) state.last = t;
    state.acc += (t - state.last) / 1000; state.last = t;
    const step = 1 / state.fps;
    let adv = false;
    while (state.acc >= step) { state.acc -= step; state.cur++; adv = true; if (state.cur >= state.frames) { state.cur = state.frames - 1; pause(); break; } }
    if (adv) refreshFrame();
    state.raf = requestAnimationFrame(loop);
  }
  function play() { if (state.cur >= state.frames - 1) state.cur = 0; state.playing = true; state.last = 0; state.acc = 0; ui.btnPlay.textContent = '⏸'; state.raf = requestAnimationFrame(loop); }
  function pause() { state.playing = false; cancelAnimationFrame(state.raf); ui.btnPlay.textContent = '▶'; }

  // ---- shared painter (preview uses drawFrame; export uses paintTimer) ----
  // matteBlack=true: H.264 has no alpha → transparent background becomes matte black.
  function paintTimer(octx, W, H, frame, fps, matteBlack) {
    let bg = bgColor();
    if (matteBlack && !bg) bg = '#000000';
    octx.clearRect(0, 0, W, H);
    if (bg) { octx.fillStyle = bg; octx.fillRect(0, 0, W, H); }
    const text = T.frameToText(frame, fps, { showHours: ui.fmt.value });
    const fnt = currentFont();
    const px = fitFont(octx, fnt, parseInt(ui.fontSize.value, 10), W * 0.92);
    drawTimerText(octx, text, W, H, px, fnt);
  }

  function downloadBlob(blob, fname) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
  }

  function exportDone(fname, blob, fps, frames, dur, W, H, method) {
    ui.prog.value = 100;
    ui.status.innerHTML = `✅ <b>${fname}</b> downloaded (${(blob.size / 1048576).toFixed(2)} MB · ${frames} frames @ ${fps}fps via ${method}).<br>Duration ≈ ${(frames / fps).toFixed(3)}s · frames 0..2: ${[0, 1, 2].map(f => T.frameToText(f, fps, { showHours: ui.fmt.value })).join(' · ')}`;
    ui.btnExport.disabled = false;
    refresh();
  }

  // ---- offline MP4 (WebCodecs + mp4-muxer): KEEPS RUNNING OUTSIDE THE TAB ----
  // Promise-driven loop, no realtime pacing → continues in background.
  async function exportMP4Offline(cfg, br) {
    const { dur, fps, W, H } = cfg;
    const frames = T.totalFrames(dur, fps);
    const draw = (c2d, W2, H2, f) => paintTimer(c2d, W2, H2, f, fps, true);
    draw.probe = () => ({ W, H });
    const blob = await window.MP4Export.export({
      fps, frames, bitrate: br, draw,
      onProgress: (p) => {
        ui.prog.value = Math.round(p * 100);
        ui.status.innerHTML = `⏳ Encoding MP4 <b>${Math.round(p * 100)}%</b> (${frames} frames) — you can minimize the tab, just don't close it…`;
      },
    });
    return { blob, ext: 'mp4', method: 'MP4 offline (H.264)' };
  }

  // ---- fallback: realtime MediaRecorder (needs the tab visible) ----
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function exportViaRecorder(cfg, br) {
    const { dur, fps, W, H } = cfg;
    const frames = T.totalFrames(dur, fps);
    const mimeCandidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimeCandidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    if (!mime) throw new Error('This browser does not support video recording. Use Chrome or Edge.');
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const octx = off.getContext('2d');
    paintTimer(octx, W, H, 0, fps, ext === 'mp4');
    const stream = off.captureStream(Math.min(fps, 120));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: br });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = res; });
    rec.start(250);
    const frameMs = 1000 / fps;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      paintTimer(octx, W, H, f, fps, ext === 'mp4');
      if (f % Math.max(1, Math.floor(frames / 100)) === 0) {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(off, 0, 0, cv.width, cv.height);
        const p = Math.round((f / frames) * 100);
        ui.prog.value = p;
        ui.status.innerHTML = `⏳ Recording (${ext.toUpperCase()} fallback) frame <b>${f}/${frames - 1}</b> (${p}%) — keep the tab visible…`;
      }
      const wait = (t0 + f * frameMs) - performance.now();
      if (wait > 0) await sleep(wait);
    }
    await sleep(Math.max(300, 1000 / fps + 150));
    rec.stop();
    await done;
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext, method: `MediaRecorder ${ext.toUpperCase()} (realtime)` };
  }

  // ---- gameplay + timer: re-encode the loaded video with burned-in timer ----
  // Offline (WebCodecs), keeps running in background. Audio passes through.
  // AVCDecoderConfigurationRecord built by hand from parsed SPS/PPS NALUs
  // (MP4Box.DataStream is not exposed, so box.write is unavailable).
  function avcDescription(mp4, trackId) {
    try {
      const trak = mp4.getTrackById(trackId);
      const entries = (((trak || {}).mdia || {}).minf || {}).stbl
        ? trak.mdia.minf.stbl.stsd.entries : [];
      for (const entry of entries || []) {
        const box = entry.avcC;
        if (!box || !Array.isArray(box.SPS) || !Array.isArray(box.PPS)) continue;
        const sps = box.SPS.map((s) => s.nalu || s).filter((u) => u && u.length);
        const pps = box.PPS.map((s) => s.nalu || s).filter((u) => u && u.length);
        if (!sps.length || !pps.length) continue;
        const parts = [[
          0x01, box.AVCProfileIndication, box.profile_compatibility,
          box.AVCLevelIndication, 0xFF, 0xE0 | sps.length,
        ]];
        let total = parts[0].length;
        const pushU16 = (v) => { parts.push([(v >> 8) & 0xff, v & 0xff]); total += 2; };
        const pushRaw = (u) => { parts.push(u); total += u.length; };
        for (const n of sps) { pushU16(n.length); pushRaw(n); }
        parts.push([pps.length]); total += 1;
        for (const n of pps) { pushU16(n.length); pushRaw(n); }
        const rec = new Uint8Array(total);
        let o = 0;
        for (const b of parts) { rec.set(b, o); o += b.length; }
        return rec;
      }
    } catch { /* fall through */ }
    return null;
  }
  async function exportGameplay() {
    if (!window.MP4Box || !window.MP4Box.createFile) {
      flashExport('❌ Video library missing (needs internet once)');
      ui.btnExport.disabled = false;
      return;
    }
    if (!window.MP4Export || !window.MP4Export.supported()) {
      flashExport('❌ WebCodecs unavailable — use Chrome/Edge');
      ui.btnExport.disabled = false;
      return;
    }
    const file = state.videoFile;
    if (!file) {
      flashExport('⚠️ Load a gameplay video first');
      return;
    }
    let fps;
    try { fps = readConfig().fps; } catch (e) { flashExport('⚠️ ' + e.message); return; }
    const br = parseInt(ui.bitrate.value, 10) * 1e6;
    let seg;
    try {
      seg = segment();
      if (seg.frames <= 0) throw new Error('empty segment');
    } catch (e) { flashExport('⚠️ ' + e.message); ui.btnExport.disabled = false; return; }
    const segStartUs = Math.round(seg.start * 1e6);
    ui.btnExport.disabled = true; ui.prog.hidden = false; ui.prog.value = 0;
    pause();
    try {
      await ensureFontsBlocking();
      const buf = await file.arrayBuffer();
      const mp4 = window.MP4Box.createFile();
      const info = await new Promise((res, rej) => {
        mp4.onReady = res; mp4.onError = rej;
        buf.fileStart = 0;
        mp4.appendBuffer(buf);
      });
      const vTrack = (info.videoTracks || [])[0];
      if (!vTrack) throw new Error('no video track found');
      const aTrack = (info.audioTracks || [])[0] || null;
      const vCodec = vTrack.codec || '';
      const isAvc = /^avc1/.test(vCodec), isVp9 = /^vp09/.test(vCodec);
      if (!isAvc && !isVp9) throw new Error('H.264/VP9 gameplay only, found ' + vCodec);
      const vCfg = { codec: vCodec, codedWidth: vTrack.video.width, codedHeight: vTrack.video.height };
      if (isAvc) {
        const desc = avcDescription(mp4, vTrack.id);
        if (!desc) throw new Error('missing AVC description');
        vCfg.description = desc;
      }
      const vTs = vTrack.timescale, aTs = aTrack ? aTrack.timescale : 1;
      const ctsUs = (s, ts) => Math.round((s.cts * 1e6) / ts);
      const durUs = (s, ts) => Math.max(1, Math.round((s.duration * 1e6) / ts));
      const vSamples = [], aSamples = [];
      await new Promise((res, rej) => {
        let gotV = 0, gotA = 0;
        const done = () => { if (gotV >= vTrack.nb_samples && gotA >= (aTrack ? aTrack.nb_samples : 0)) res(); };
        mp4.onSamples = (id, user, samples) => {
          if (id === vTrack.id) { for (const s of samples) vSamples.push(s); gotV += samples.length; }
          else if (aTrack && id === aTrack.id) { for (const s of samples) aSamples.push(s); gotA += samples.length; }
          done();
        };
        mp4.onError = rej;
        mp4.setExtractionOptions(vTrack.id);
        if (aTrack) mp4.setExtractionOptions(aTrack.id);
        mp4.start();
        done();
      });
      if (!vSamples.length) throw new Error('no video samples');
      const W = vTrack.video.width - (vTrack.video.width % 2);
      const H = vTrack.video.height - (vTrack.video.height % 2);
      const N = T.totalFrames(seg.seconds, fps);
      const { Muxer, ArrayBufferTarget, pickCodec } = window.MP4Export.lib;
      const codec = await pickCodec(W, H, br, fps);
      if (!codec) throw new Error('H.264 unavailable in this browser');
      const muxTarget = new ArrayBufferTarget();
      const muxer = new Muxer({
        target: muxTarget,
        fastStart: 'in-memory',
        video: { codec: 'avc', width: W, height: H },
        ...(aTrack ? { audio: { codec: 'aac', sampleRate: aTrack.audio.sample_rate, numberOfChannels: aTrack.audio.channel_count } } : {}),
      });
      let encErr = null;
      const enc = new VideoEncoder({
        output: (c, m) => muxer.addVideoChunk(c, m),
        error: (e) => { encErr = e; },
      });
      enc.configure({ codec, width: W, height: H, bitrate: br, framerate: Math.max(1, Math.round(fps)) });
      let decErr = null;
      const decoded = [];
      const dec = new VideoDecoder({
        output: (f) => decoded.push({ frame: f, ts: f.timestamp }),
        error: (e) => { decErr = e; },
      });
      dec.configure(vCfg);
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const octx = canvas.getContext('2d');
      const fnt = currentFont();
      const px = fitFont(octx, fnt, Math.max(10, Math.round(H * state.overlay.size / 100)), W * 0.92);
      const keyInt = Math.max(1, Math.round(fps * 2));
      const tsOf = (i) => segStartUs + T.frameTimestampUs(i, fps); // source (absolute)
      const outTs = (i) => T.frameTimestampUs(i, fps); // muxer: first chunk must be 0
      let outIdx = 0, lastVf = null;
      const paint = (vf, i) => {
        octx.clearRect(0, 0, W, H);
        octx.drawImage(vf, 0, 0, W, H);
        drawTimerText(octx, T.frameToText(i, fps, { showHours: ui.fmt.value }), W, H, px, fnt, state.overlay);
        const out = new VideoFrame(canvas, { timestamp: outTs(i), duration: T.frameDurationUs(fps) });
        enc.encode(out, { keyFrame: i % keyInt === 0 });
        out.close();
      };
      const emitUpTo = (maxTs) => {
        while (outIdx < N && tsOf(outIdx) <= maxTs) {
          let pick = lastVf;
          for (const d of decoded) {
            if (d.ts <= tsOf(outIdx)) pick = d.frame;
            else break;
          }
          if (!pick) pick = decoded.length ? decoded[0].frame : lastVf;
          if (!pick) break;
          lastVf = pick;
          paint(pick, outIdx);
          outIdx++;
        }
      };
      const BATCH = 120;
      for (let b = 0; b < vSamples.length; b += BATCH) {
        if (decErr) throw decErr;
        if (encErr) throw encErr;
        for (const s of vSamples.slice(b, b + BATCH)) {
          dec.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: ctsUs(s, vTs), duration: durUs(s, vTs), data: s.data,
          }));
        }
        await dec.flush();
        if (decErr) throw decErr;
        decoded.sort((a, b2) => a.ts - b2.ts);
        emitUpTo(decoded.length ? decoded[decoded.length - 1].ts : -1);
        for (const d of decoded) {
          if (d.frame !== lastVf) { try { d.frame.close(); } catch { /* noop */ } }
        }
        const hold = lastVf ? [{ frame: lastVf, ts: -1 }] : [];
        decoded.length = 0;
        for (const h of hold) decoded.push(h);
        ui.prog.value = Math.round((outIdx / N) * 100);
        ui.status.innerHTML = `⏳ Burning timer into gameplay <b>${Math.round((outIdx / N) * 100)}%</b> — you can minimize, do not close…`;
        await new Promise((r) => setTimeout(r, 0));
      }
      while (outIdx < N && lastVf) {
        paint(lastVf, outIdx);
        outIdx++;
      }
      await enc.flush();
      if (encErr) throw encErr;
      try { dec.close(); } catch { /* noop */ }
      try { enc.close(); } catch { /* noop */ }
      if (aTrack && aSamples.length) {
        const meta = { decoderConfig: { codec: aTrack.codec, sampleRate: aTrack.audio.sample_rate, numberOfChannels: aTrack.audio.channel_count } };
        for (const s of aSamples) {
          const at = ctsUs(s, aTs) - segStartUs;
          if (at < 0) continue; // before the segment
          muxer.addAudioChunk(new EncodedAudioChunk({
            type: 'key', timestamp: at, duration: durUs(s, aTs), data: s.data,
          }), meta);
        }
      }
      muxer.finalize();
      try { mp4.stop(); mp4.flush(); } catch { /* noop */ }
      const blob = new Blob([muxTarget.buffer], { type: 'video/mp4' });
      const fname = `gameplay-timer_${fps}fps_${W}x${H}.mp4`;
      downloadBlob(blob, fname);
      exportDone(fname, blob, fps, N, seg.seconds, W, H, 'gameplay H.264');
    } catch (e) {
      ui.status.innerHTML = '❌ Gameplay export failed: ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' ') : e.message);
      ui.btnExport.disabled = false;
    }
  }

  async function exportVideo() {
    let cfg;
    try { cfg = readConfig(); } catch (e) { ui.status.innerHTML = '⚠️ ' + e.message; return; }
    const { dur, fps, W, H } = cfg;
    const frames = T.totalFrames(dur, fps);
    if (frames > fps * 3600) { ui.status.innerHTML = '⚠️ 1h limit per browser export.'; return; }
    const br = parseInt(ui.bitrate.value, 10) * 1e6;
    const estMB = (br * dur) / 8 / 1048576;
    if (estMB > 300 && !confirm(`Estimated video size ~${Math.round(estMB)} MB. Continue?`)) return;
    ui.btnExport.disabled = true; ui.prog.hidden = false; ui.prog.value = 0;
    pause();
    await ensureFontsBlocking(); // webfont ready before frame 0
    try {
      let out;
      if (window.MP4Export && window.MP4Export.supported()) {
        try { out = await exportMP4Offline(cfg, br); }
        catch (e) {
          console.warn('MP4 offline falhou, usando fallback:', e);
          ui.status.innerHTML = `⚠️ Offline MP4 failed (${e.message}). Trying realtime fallback…`;
          out = await exportViaRecorder(cfg, br);
        }
      } else {
        ui.status.innerHTML = 'ℹ️ WebCodecs unavailable (use Chrome/Edge for offline MP4). Using realtime fallback…';
        out = await exportViaRecorder(cfg, br);
      }
      const fname = `speedrun-timer_${fps}fps_${Math.round(dur)}s_${W}x${H}.${out.ext}`;
      downloadBlob(out.blob, fname);
      exportDone(fname, out.blob, fps, frames, dur, W, H, out.method);
    } catch (e) {
      ui.status.innerHTML = '❌ Export failed: ' + e.message;
      ui.btnExport.disabled = false;
    }
  }

  // ---- wiring ----
  const paintRange = (el) => {
    const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
    const p = max > min ? ((parseFloat(el.value) - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--fill', Math.max(0, Math.min(100, p)) + '%');
  };
  const paintAllRanges = () => document.querySelectorAll('input[type=range]').forEach(paintRange);
  document.querySelectorAll('input[type=range]').forEach(el => {
    el.addEventListener('input', () => paintRange(el));
    el.addEventListener('change', () => paintRange(el));
  });
  paintAllRanges();
  // ---- gameplay + timer (local file, nothing uploaded) ----
  // Start/End frames select the exported segment; preview freezes outside it.
  function segment() {
    const vf = parseFloat(String(ui.rtVideoFps.value).replace(',', '.'));
    if (!isFinite(vf) || vf <= 0) throw new Error('video FPS must be > 0');
    const s = Math.max(0, parseInt(ui.rtStart.value, 10) || 0);
    const e = Math.max(0, parseInt(ui.rtEnd.value, 10) || 0);
    if (e < s) throw new Error('end frame must be >= start frame');
    return { frames: e - s, seconds: (e - s) / vf, start: s / vf, end: e / vf, fps: vf };
  }
  function refreshRetime() {
    try {
      const g = segment();
      const tFmt = T.formatMs(Math.round(g.seconds * 1000), { showHours: 'auto' });
      ui.rtOut.innerHTML = `<b>${g.frames}</b> frames · segment <b>${g.seconds.toFixed(3)}s</b> @${g.fps}fps · timer <b>${tFmt}</b>`;
    } catch (err) {
      ui.rtOut.textContent = err.message;
    }
  }
  function syncFromVideo() {
    const v = ui.rtVideo;
    if (!v || !v.src || !isFinite(v.currentTime)) return;
    try {
      const g = segment();
      let frac = (v.currentTime - g.start) / Math.max(1e-9, g.end - g.start);
      frac = Math.max(0, Math.min(1, frac));
      const target = Math.round(frac * (state.frames - 1));
      if (target !== state.cur) {
        state.cur = target;
        refreshFrame();
      }
    } catch { /* invalid segment: leave timer alone */ }
    syncPlayerUi();
    drawComposite();
  }
  // Timer follows whole-video progress; composite shows the timer ON video.
  let rtRaf = 0;
  const rtCv = () => ui.rtCanvas;
  const rtCtx = () => ui.rtCanvas.getContext('2d');
  function drawComposite() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (now - (drawComposite._t || 0) < 40) return; // ~25fps cap: phones stay smooth
    drawComposite._t = now;
    const v = ui.rtVideo;
    if (!v || !v.videoWidth) return;
    const c = rtCv();
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth; c.height = v.videoHeight;
    }
    const W = c.width, H = c.height;
    const x = rtCtx();
    x.clearRect(0, 0, W, H);
    try { x.drawImage(v, 0, 0, W, H); } catch { return; }
    const text = T.frameToText(state.cur, state.fps, { showHours: ui.fmt.value });
    const fnt = currentFont();
    const px = fitFont(x, fnt, Math.max(10, Math.round(H * state.overlay.size / 100)), W * 0.92);
    drawTimerText(x, text, W, H, px, fnt, state.overlay);
  }
  function syncPlayerUi() {
    const v = ui.rtVideo;
    if (!v || !v.src || !isFinite(v.duration)) return;
    ui.rtSeek.max = v.duration;
    if (document.activeElement !== ui.rtSeek) ui.rtSeek.value = v.currentTime;
    const vf = parseFloat(String(ui.rtVideoFps.value).replace(',', '.')) || 60;
    ui.rtTime.textContent = `${v.currentTime.toFixed(3)}s · f${Math.round(v.currentTime * vf)}`;
    ui.rtPlay.textContent = v.paused ? '▶' : '⏸';
  }
  function rtLoop() {
    syncFromVideo();
    if (!ui.rtVideo.paused && !ui.rtVideo.ended) rtRaf = requestAnimationFrame(rtLoop);
  }
  // Safari fires change-only on <select>: listen to both (refresh is idempotent).
  function onControl() { pause(); refresh(); }
  ['duration', 'fps', 'w', 'h', 'bg', 'bgCustom', 'fg', 'fontSize', 'font', 'fmt', 'stroke', 'bitrate']
    .forEach(id => { $(id).addEventListener('input', onControl); $(id).addEventListener('change', onControl); });
  $('durPresets').addEventListener('click', (e) => { if (e.target.dataset.d) { ui.duration.value = e.target.dataset.d; pause(); refresh(); } });
  $('fpsPresets').addEventListener('click', (e) => {
    if (e.target.dataset.f) {
      ui.fps.value = e.target.dataset.f;
      document.querySelectorAll('#fpsPresets button').forEach(b => b.classList.remove('on'));
      e.target.classList.add('on'); pause(); refresh();
    }
  });
  $('resPresets').addEventListener('click', (e) => {
    if (e.target.dataset.w) { ui.w.value = e.target.dataset.w; ui.h.value = e.target.dataset.h; pause(); refresh(); }
  });
  ui.seek.addEventListener('input', () => { pause(); state.cur = parseInt(ui.seek.value, 10) || 0; refreshFrame(); });
  ui.btnPlay.addEventListener('click', () => state.playing ? pause() : play());
  ui.btnRestart.addEventListener('click', () => { pause(); state.cur = 0; refreshFrame(); });
  ui.btnExport.addEventListener('click', exportVideo);
  ui.btnExportGameplay.addEventListener('click', exportGameplay);
  ui.btnExportGameplay.addEventListener('click', exportGameplay);
  ui.rtFile.addEventListener('change', () => {
    const f = ui.rtFile.files && ui.rtFile.files[0];
    if (!f) return;
    if (ui.rtVideo.src) URL.revokeObjectURL(ui.rtVideo.src);
    state.videoFile = f;
    ui.rtVideo.src = URL.createObjectURL(f);
    ui.rtVideo.load();
  });
  ui.rtVideo.addEventListener('play', () => { cancelAnimationFrame(rtRaf); rtLoop(); });
  ui.rtVideo.addEventListener('pause', () => { cancelAnimationFrame(rtRaf); syncFromVideo(); });
  ui.rtVideo.addEventListener('seeked', syncFromVideo);
  ui.rtVideo.addEventListener('loadedmetadata', () => {
    const v = ui.rtVideo;
    // Whole video selected by default; timer duration follows the file.
    if (isFinite(v.duration) && v.duration > 0) {
      const vf = parseFloat(String(ui.rtVideoFps.value).replace(',', '.')) || 60;
      ui.rtStart.value = 0;
      ui.rtEnd.value = Math.round(v.duration * vf);
      ui.duration.value = String(parseFloat(v.duration.toFixed(3)));
      ui.duration.dispatchEvent(new Event('input', { bubbles: true }));
    }
    refreshRetime();
    syncPlayerUi(); drawComposite();
  });
  ['rtVideoFps', 'rtStart', 'rtEnd']
    .forEach(id => { $(id).addEventListener('input', refreshRetime); $(id).addEventListener('change', refreshRetime); });
  // Custom player
  ui.rtPlay.addEventListener('click', () => {
    const v = ui.rtVideo;
    if (!v.src) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  });
  function stepVideo(d) {
    const v = ui.rtVideo;
    if (!v.src || !isFinite(v.duration)) return;
    const vf = parseFloat(String(ui.rtVideoFps.value).replace(',', '.')) || 60;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + (d / vf)));
  }
  ui.rtBack.addEventListener('click', () => stepVideo(-1));
  ui.rtFwd.addEventListener('click', () => stepVideo(1));
  ui.rtSeek.addEventListener('input', () => {
    const v = ui.rtVideo;
    if (v.src && isFinite(v.duration)) v.currentTime = parseFloat(ui.rtSeek.value) || 0;
  });
  // Draggable overlay
  let ovDrag = false;
  function moveOverlay(e) {
    const r = ui.rtCanvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    state.overlay.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    state.overlay.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    drawComposite();
  }
  ui.rtCanvas.addEventListener('pointerdown', (e) => { ovDrag = true; try { ui.rtCanvas.setPointerCapture(e.pointerId); } catch {} moveOverlay(e); });
  ui.rtCanvas.addEventListener('pointermove', (e) => { if (ovDrag) moveOverlay(e); });
  ui.rtCanvas.addEventListener('pointerup', () => { ovDrag = false; });
  ui.rtCanvas.addEventListener('pointercancel', () => { ovDrag = false; });
  ui.rtOverlaySize.addEventListener('input', () => {
    state.overlay.size = parseFloat(ui.rtOverlaySize.value) || 12;
    ui.rtOverlaySizeVal.textContent = ui.rtOverlaySize.value + '%';
    drawComposite();
  });
  ui.rtOverlaySize.addEventListener('change', () => drawComposite());
  if (ui.btnPng) ui.btnPng.addEventListener('click', () => {
    drawFrame(state.cur);
    const a = document.createElement('a');
    a.download = `timer_frame${state.cur}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  });

  refresh();
})();
