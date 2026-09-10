// timer-core.js — pure core (shared by browser + Node).
// GOLDEN RULE: displayed ms = Math.round(frame * 1000 / fps)
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TimerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // N frames cover instants 0..N-1; the last would show dur-1frame (e.g. 59.983).
  // +1 final frame so the timer ENDS on the round number (e.g. 01:00.000).
  // The round(frame*1000/fps) quantization holds for every frame.
  function totalFrames(durationSec, fps) {
    if (!(fps > 0)) throw new Error('fps must be > 0');
    if (!(durationSec >= 0)) throw new Error('duration must be >= 0');
    return Math.max(1, Math.round(durationSec * fps) + 1);
  }

  // frame -> quantized ms (integer, never 16.677)
  function frameToMs(frame, fps) {
    return Math.round((frame * 1000) / fps);
  }

  function formatMs(ms, opts) {
    opts = opts || {};
    const showHours = opts.showHours === 'always' ? true
      : opts.showHours === 'never' ? false
      : ms >= 3600000; // 'auto' (ou ausente): horas só se ≥1h
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    const mm = String(m % 60).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    const mmm = String(milli).padStart(3, '0');
    if (showHours) {
      const h = Math.floor(ms / 3600000);
      const minInHour = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
      return `${h}:${minInHour}:${ss}.${mmm}`;
    }
    const MM = String(m).padStart(2, '0');
    return `${MM}:${ss}.${mmm}`;
  }

  function frameToText(frame, fps, opts) {
    return formatMs(frameToMs(frame, fps), opts);
  }

  // Accepts: "90", "90.5", "1:30", "01:30.250", "1:02:03.5"
  function parseDuration(input) {
    if (typeof input === 'number') {
      if (!isFinite(input) || input < 0) throw new Error('invalid duration');
      return input;
    }
    const str = String(input || '').trim().replace(',', '.');
    if (!str) throw new Error('empty duration');
    if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    const parts = str.split(':');
    if (parts.length > 3) throw new Error('use H:MM:SS.mmm');
    let sec = 0;
    for (const p of parts) {
      if (!/^\d+(\.\d+)?$/.test(p.trim())) throw new Error(`invalid segment: "${p}"`);
    }
    if (parts.length === 2) {
      sec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    } else if (parts.length === 3) {
      sec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
    } else {
      throw new Error('invalid duration');
    }
    if (!isFinite(sec) || sec <= 0) throw new Error('duration must be > 0');
    return sec;
  }

  function frameDurationMs(fps) {
    return 1000 / fps;
  }

  // Microsecond timestamps for offline encoding (WebCodecs/MP4).
  // Absolute (no accumulated drift): ts(f) = round(f * 1e6 / fps).
  function frameTimestampUs(frame, fps) {
    return Math.round((frame * 1e6) / fps);
  }

  function frameDurationUs(fps) {
    return Math.round(1e6 / fps);
  }

  return { totalFrames, frameToMs, formatMs, frameToText, parseDuration, frameDurationMs, frameTimestampUs, frameDurationUs };
});
