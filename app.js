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
    btnPlay: $('btnPlay'), btnRestart: $('btnRestart'),
    btnExport: $('btnExport'), btnPng: $('btnPng'),
  };

  let state = { dur: 60, fps: 60, frames: 3600, cur: 0, playing: false, raf: 0, last: 0, acc: 0 };

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
    // font scaled to always fit the width
    let px = parseInt(ui.fontSize.value, 10);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const setFont = (s) => { ctx.font = `700 ${s}px ${ui.font.value}`; };
    setFont(px);
    const maxW = W * 0.92;
    while (ctx.measureText(text).width > maxW && px > 10) { px -= 4; setFont(px); }
    const cx = W / 2, cy = H / 2;
    if (ui.stroke.checked) {
      ctx.lineWidth = Math.max(2, px / 18); ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(text, cx, cy);
    }
    ctx.fillStyle = ui.fg.value;
    // subtle shadow for legibility on chroma green
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = px / 25;
    ctx.fillText(text, cx, cy);
    ctx.shadowBlur = 0;
    return text;
  }

  function readConfigSafe() {
    try { const c = readConfig(); return c; }
    catch { return { dur: state.dur, fps: state.fps, W: parseInt(ui.w.value, 10) || 1920, H: parseInt(ui.h.value, 10) || 1080 }; }
  }

  function refresh() {
    try {
      const { dur, fps } = readConfig();
      state.dur = dur; state.fps = fps;
      state.frames = T.totalFrames(dur, fps);
    } catch (e) { ui.status.innerHTML = '⚠️ ' + e.message; return; }
    state.cur = Math.min(state.cur, state.frames - 1);
    ui.seek.max = state.frames - 1;
    ui.seek.value = state.cur;
    const txt = drawFrame(state.cur);
    ui.timeLabel.textContent = txt;
    ui.frameLabel.textContent = `frame ${state.cur}/${state.frames - 1}`;
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
    if (typeof paintAllRanges === 'function') paintAllRanges();
  }

  // ---- transport (realtime preview) ----
  function loop(t) {
    if (!state.playing) return;
    if (!state.last) state.last = t;
    state.acc += (t - state.last) / 1000; state.last = t;
    const step = 1 / state.fps;
    let adv = false;
    while (state.acc >= step) { state.acc -= step; state.cur++; adv = true; if (state.cur >= state.frames) { state.cur = state.frames - 1; pause(); break; } }
    if (adv) refresh();
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
    let px = parseInt(ui.fontSize.value, 10);
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    const setF = (s) => { octx.font = `700 ${s}px ${ui.font.value}`; };
    setF(px);
    while (octx.measureText(text).width > W * 0.92 && px > 10) { px -= 4; setF(px); }
    if (ui.stroke.checked) { octx.lineWidth = Math.max(2, px / 18); octx.strokeStyle = 'rgba(0,0,0,.85)'; octx.strokeText(text, W / 2, H / 2); }
    octx.fillStyle = ui.fg.value;
    octx.shadowColor = 'rgba(0,0,0,.55)'; octx.shadowBlur = px / 25;
    octx.fillText(text, W / 2, H / 2);
    octx.shadowBlur = 0;
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
  ui.seek.addEventListener('input', () => { pause(); state.cur = parseInt(ui.seek.value, 10) || 0; refresh(); });
  ui.btnPlay.addEventListener('click', () => state.playing ? pause() : play());
  ui.btnRestart.addEventListener('click', () => { pause(); state.cur = 0; refresh(); });
  ui.btnExport.addEventListener('click', exportVideo);
  if (ui.btnPng) ui.btnPng.addEventListener('click', () => {
    drawFrame(state.cur);
    const a = document.createElement('a');
    a.download = `timer_frame${state.cur}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  });

  refresh();
})();
