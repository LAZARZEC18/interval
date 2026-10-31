/* Interval cues: Web Audio tones, speech and vibration. Every call is safe when the API is missing. */
(function () {
  "use strict";
  var IV = (window.IV = window.IV || {});
  var ctx = null, master = null;
  var cfg = { sound: true, volume: 0.7, voice: true, vibrate: true };
  var log = [];

  function rec(kind, detail) { log.push({ kind: kind, detail: detail, t: Math.round(performance.now()) }); if (log.length > 200) log.shift(); }

  function audio() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      master.gain.value = cfg.volume;
      return ctx;
    } catch (e) { return null; }
  }

  // One soft-edged tone. Two oscillators an octave apart give a rounder, bell-like beep.
  function tone(freq, dur, when, vol, type) {
    var c = audio(); if (!c) return;
    try {
      var t = c.currentTime + (when || 0), g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(master);
      [[freq, type || "sine", 1], [freq * 2, "sine", 0.18]].forEach(function (o) {
        var osc = c.createOscillator(), og = c.createGain();
        osc.type = o[1]; osc.frequency.value = o[0]; og.gain.value = o[2];
        osc.connect(og).connect(g); osc.start(t); osc.stop(t + dur + 0.05);
      });
    } catch (e) { /* audio unavailable */ }
  }

  var SOUNDS = {
    tick: function () { tone(880, 0.12, 0, 0.45); },
    go: function () { tone(1320, 0.5, 0, 0.6); },
    work: function () { tone(784, 0.14, 0, 0.55, "triangle"); tone(1175, 0.42, 0.14, 0.6, "triangle"); },
    rest: function () { tone(988, 0.16, 0, 0.5); tone(659, 0.5, 0.16, 0.5); },
    prep: function () { tone(880, 0.35, 0, 0.5); },
    cooldown: function () { tone(740, 0.2, 0, 0.45); tone(554, 0.5, 0.2, 0.45); },
    done: function () { tone(1047, 0.2, 0, 0.55); tone(1319, 0.2, 0.2, 0.55); tone(1568, 0.7, 0.4, 0.6); },
    test: function () { SOUNDS.tick(); setTimeout(SOUNDS.work, 420); }
  };

  function play(name) {
    rec("sound", name);
    if (!cfg.sound || cfg.volume <= 0) return;
    if (SOUNDS[name]) SOUNDS[name]();
  }

  function say(text) {
    rec("voice", text);
    if (!cfg.voice || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.volume = Math.max(0.1, cfg.volume); u.rate = 1.05; u.lang = "en-AU";
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }

  function buzz(pattern) {
    rec("vibrate", pattern);
    if (!cfg.vibrate || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* vibration unavailable */ }
  }

  IV.cues = {
    config: function (c) { Object.assign(cfg, c); if (master) master.gain.value = cfg.volume; },
    unlock: function () { audio(); },
    play: play, say: say, buzz: buzz, log: log,
    hasVoice: function () { return "speechSynthesis" in window; },
    hasVibrate: function () { return !!navigator.vibrate; }
  };
})();
