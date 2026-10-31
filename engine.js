/* Interval engine: workout model, expansion and a drift-free timer. No DOM access. */
(function () {
  "use strict";
  var IV = (window.IV = window.IV || {});

  IV.TYPES = {
    work: { label: "Work" },
    rest: { label: "Rest" },
    prep: { label: "Prep" },
    cooldown: { label: "Cool-down" }
  };
  IV.TYPE_ORDER = ["work", "rest", "prep", "cooldown"];

  var uid = 0;
  IV.id = function (p) { uid += 1; return (p || "b") + Date.now().toString(36) + uid.toString(36) + Math.random().toString(36).slice(2, 6); };

  /* ---------- time formatting and parsing ---------- */
  IV.fmt = function (sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var ss = (s < 10 ? "0" : "") + s;
    if (h) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
    return m + ":" + ss;
  };
  // Remaining ms shown as whole seconds, rounded up, so "0:01" shows until the very end.
  IV.fmtRemain = function (ms) { return IV.fmt(Math.ceil(Math.max(0, ms) / 1000 - 1e-6)); };
  // Short human form: "4 min", "1 h 55 min", "45 s"
  IV.fmtLong = function (sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + " s";
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var out = (h ? h + " h " : "") + (m ? m + " min" : "");
    if (!h && s) out += " " + s + " s";
    return out.trim();
  };
  // Accepts "45", "1:30", "01:30", "1:02:03", "90s", "2m". Returns seconds or NaN.
  IV.parseDur = function (str) {
    str = String(str == null ? "" : str).trim().toLowerCase().replace(/\s+/g, "");
    if (!str) return NaN;
    var m;
    if ((m = /^(\d+)s?$/.exec(str))) return +m[1];
    if ((m = /^(\d+(?:\.\d+)?)m(?:in)?$/.exec(str))) return Math.round(+m[1] * 60);
    if ((m = /^(\d+):(\d{1,2})$/.exec(str))) return +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN;
    if ((m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(str))) return +m[2] < 60 && +m[3] < 60 ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
    return NaN;
  };
  IV.MAX_BLOCK = 4 * 3600;

  /* ---------- workouts ---------- */
  // A workout is { id, name, blocks:[{id,type,name,sec}], group:{start,end,times,skipLastRest}|null, noLeadIn? }
  IV.block = function (type, name, sec) { return { id: IV.id("b"), type: type, name: name || IV.TYPES[type].label, sec: sec }; };
  IV.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  IV.normGroup = function (w) {
    var g = w.group, n = w.blocks.length;
    if (!g || !n) return null;
    var s = Math.max(0, Math.min(n - 1, g.start | 0)), e = Math.max(0, Math.min(n - 1, g.end | 0));
    if (e < s) { var t = s; s = e; e = t; }
    return { start: s, end: e, times: Math.max(1, Math.min(99, g.times | 0 || 1)), skipLastRest: !!g.skipLastRest };
  };

  // Expand blocks + repeat group into a flat list of timed segments.
  IV.expand = function (w) {
    var out = [], blocks = (w.blocks || []).filter(function (b) { return b.sec > 0; });
    var g = IV.normGroup({ blocks: blocks, group: w.group });
    function push(b, idx, rep, reps) {
      out.push({ type: b.type, name: (b.name || "").trim() || IV.TYPES[b.type].label, dur: b.sec * 1000, block: idx, rep: rep, reps: reps });
    }
    for (var i = 0; i < blocks.length; i++) {
      if (g && i === g.start) {
        for (var r = 1; r <= g.times; r++) {
          for (var j = g.start; j <= g.end; j++) {
            var last = r === g.times && j === g.end;
            if (last && g.skipLastRest && blocks[j].type === "rest" && g.end > g.start) continue;
            push(blocks[j], j, r, g.times);
          }
        }
        i = g.end;
        continue;
      }
      push(blocks[i], i, 0, 0);
    }
    return out;
  };
  IV.totalSec = function (w) { return IV.expand(w).reduce(function (a, s) { return a + s.dur; }, 0) / 1000; };

  /* ---------- presets ---------- */
  function grp(start, end, times, skip) { return { start: start, end: end, times: times, skipLastRest: !!skip }; }
  IV.presets = function () {
    var B = IV.block;
    return [
      { id: "p-tabata", name: "Tabata", desc: "20 s flat out, 10 s rest, eight rounds.", blocks: [B("work", "Work", 20), B("rest", "Rest", 10)], group: grp(0, 1, 8, false) },
      { id: "p-emom", name: "EMOM 10 min", desc: "Start your reps at the top of every minute.", blocks: [B("work", "Every minute", 60)], group: grp(0, 0, 10, false) },
      { id: "p-hiit", name: "HIIT 30/30", desc: "30 s hard, 30 s easy, ten rounds.", blocks: [B("work", "Work", 30), B("rest", "Rest", 30)], group: grp(0, 1, 10, true) },
      { id: "p-boxing", name: "Boxing rounds", desc: "Six 3-minute rounds with a minute between.", blocks: [B("work", "Round", 180), B("rest", "Rest", 60)], group: grp(0, 1, 6, true) },
      { id: "p-pomodoro", name: "Pomodoro", desc: "25 min focus, 5 min break, four times.", blocks: [B("work", "Focus", 1500), B("rest", "Break", 300)], group: grp(0, 1, 4, true) },
      { id: "p-stretch", name: "5-min stretch", desc: "A guided cool-down, one stretch every 30 s.", group: null, blocks: [
        B("prep", "Deep breaths", 30), B("cooldown", "Neck rolls", 30), B("cooldown", "Shoulder, left", 30), B("cooldown", "Shoulder, right", 30),
        B("cooldown", "Chest opener", 30), B("cooldown", "Forward fold", 30), B("cooldown", "Hip flexor, left", 30), B("cooldown", "Hip flexor, right", 30),
        B("cooldown", "Hamstrings", 30), B("cooldown", "Child's pose", 30)] }
    ];
  };
  IV.restTimer = function (sec) {
    return { id: "rest-" + sec, name: "Rest " + IV.fmt(sec), blocks: [IV.block("rest", "Rest", sec)], group: null, noLeadIn: true, rest: true };
  };

  /* ---------- clock ---------- */
  // performance.now() is monotonic, but some phones pause it while the device sleeps.
  // Date.now() keeps counting, so any gap between the two is added to an offset.
  var sleepOffset = 0, lastPerf = performance.now(), lastDate = Date.now();
  IV.now = function () {
    var p = performance.now(), d = Date.now();
    var gap = (d - lastDate) - (p - lastPerf);
    if (gap > 1000) sleepOffset += gap;
    lastPerf = p; lastDate = d;
    return p + sleepOffset;
  };

  /* ---------- timer ---------- */
  // Elapsed time = accumulated ms + (now - resumedAt) while running. The current phase is found from
  // elapsed time and cumulative offsets, so there is never a counting loop that can drift.
  function Timer(opts) {
    opts = opts || {};
    this.clock = opts.clock || IV.now;
    this.onEvent = opts.onEvent || function () {};
    this.leadMs = 3000;
    this.load([]);
  }
  Timer.prototype.load = function (segs) {
    this.segs = segs.map(function (s) { return Object.assign({}, s); });
    this.status = "idle";
    this.accum = 0; this.resumedAt = 0; this.lastEl = 0; this.idx = 0; this.halfDone = false;
    this.countEnd = 0; this.lastCount = 4; this.runMs = 0;
    this._offsets();
  };
  Timer.prototype._offsets = function () {
    var t = 0; this.offsets = this.segs.map(function (s) { var o = t; t += s.dur; return o; }); this.total = t;
  };
  Timer.prototype.elapsed = function () {
    var e = this.accum + (this.status === "running" ? this.clock() - this.resumedAt : 0);
    return Math.min(Math.max(0, e), this.total);
  };
  Timer.prototype.indexAt = function (el) {
    var i = 0;
    while (i < this.segs.length - 1 && el >= this.offsets[i + 1]) i++;
    return i;
  };
  Timer.prototype.info = function () {
    var el = this.status === "done" ? this.total : this.elapsed();
    var i = this.status === "done" ? this.segs.length - 1 : this.indexAt(el);
    var seg = this.segs[i] || null;
    var into = seg ? el - this.offsets[i] : 0;
    var out = {
      status: this.status, idx: i, seg: seg, next: this.segs[i + 1] || null, elapsed: el, total: this.total,
      into: into, remain: seg ? Math.max(0, seg.dur - into) : 0, frac: seg && seg.dur ? Math.min(1, into / seg.dur) : 0,
      sessFrac: this.total ? el / this.total : 0
    };
    if (this.status === "countdown") { out.countRemain = Math.max(0, this.countEnd - this.clock()); }
    return out;
  };
  Timer.prototype.start = function (lead) {
    if (!this.segs.length) return;
    if (this.status === "running" || this.status === "countdown") return;
    if (this.status === "done") { this.accum = 0; this.lastEl = 0; this.idx = 0; this.halfDone = false; this.runMs = 0; }
    if (this.status === "idle" && lead && this.accum === 0) {
      this.status = "countdown"; this.countEnd = this.clock() + this.leadMs; this.lastCount = 4;
      this.onEvent({ type: "countdown-start" });
      this.tick();
      return;
    }
    this._run();
  };
  Timer.prototype._run = function (at) {
    var resumed = this.accum > 0;
    this.status = "running"; this.resumedAt = at || this.clock(); this.lastEl = this.accum;
    this.onEvent({ type: resumed ? "resume" : "begin", seg: this.segs[this.indexAt(this.accum)] });
  };
  Timer.prototype.pause = function () {
    if (this.status === "countdown") { this.status = "idle"; this.onEvent({ type: "countdown-cancel" }); return; }
    if (this.status !== "running") return;
    this.tick();
    if (this.status !== "running") return;
    this.accum = this.elapsed(); this.status = "paused";
    this.onEvent({ type: "pause" });
  };
  Timer.prototype.toggle = function (lead) {
    if (this.status === "running" || this.status === "countdown") this.pause(); else this.start(lead);
  };
  Timer.prototype.reset = function () {
    this.status = "idle"; this.accum = 0; this.lastEl = 0; this.idx = 0; this.halfDone = false; this.runMs = 0;
    this.onEvent({ type: "reset" });
  };
  Timer.prototype._seek = function (el, why) {
    var running = this.status === "running";
    this.accum = Math.max(0, Math.min(el, this.total));
    if (running) this.resumedAt = this.clock();
    if (this.status === "idle" || this.status === "done") this.status = "paused";
    this.lastEl = this.accum;
    if (this.accum >= this.total) { this._finish(); return; }
    this.idx = this.indexAt(this.accum);
    this.onEvent({ type: "phase", seg: this.segs[this.idx], idx: this.idx, manual: why });
  };
  Timer.prototype.skip = function () {
    if (!this.segs.length || this.status === "done") return;
    if (this.status === "countdown") { this.status = "idle"; }
    var i = this.indexAt(this.elapsed());
    this._seek(i + 1 < this.segs.length ? this.offsets[i + 1] : this.total, "skip");
  };
  // Back restarts the current phase, or goes to the previous one if you are in its first 2 seconds.
  Timer.prototype.back = function () {
    if (!this.segs.length) return;
    if (this.status === "countdown") { this.status = "idle"; }
    var el = this.status === "done" ? this.total : this.elapsed();
    var i = this.status === "done" ? this.segs.length - 1 : this.indexAt(el);
    if (this.status === "done") { this.status = "paused"; this.halfDone = false; }
    var target = el - this.offsets[i] > 2000 || i === 0 ? this.offsets[i] : this.offsets[i - 1];
    this._seek(target, "back");
  };
  Timer.prototype.jump = function (i) {
    if (i < 0 || i >= this.segs.length) return;
    if (this.status === "countdown" || this.status === "done") this.status = "idle";
    this._seek(this.offsets[i], "jump");
  };
  Timer.prototype.addTime = function (ms) {
    if (!this.segs.length || this.status === "done") return false;
    var el = this.elapsed(), i = this.indexAt(el);
    this.segs[i].dur += ms;
    this._offsets();
    this.onEvent({ type: "extend", seg: this.segs[i], ms: ms });
    return true;
  };
  Timer.prototype.restore = function (segs, el) {
    this.load(segs);
    if (el > 0 && el < this.total) { this.accum = el; this.lastEl = el; this.status = "paused"; this.idx = this.indexAt(el); this.halfDone = el >= this.total / 2; }
  };
  Timer.prototype._finish = function () {
    this.status = "done"; this.accum = this.total; this.lastEl = this.total; this.idx = this.segs.length - 1;
    this.onEvent({ type: "done" });
  };
  // Call often (rAF and an interval). Emits threshold events for anything crossed since the last tick.
  Timer.prototype.tick = function () {
    if (this.status === "countdown") {
      var cr = this.countEnd - this.clock();
      var n = Math.ceil(cr / 1000);
      if (n < this.lastCount && n >= 1) { this.lastCount = n; this.onEvent({ type: "count", n: n }); }
      if (cr <= 0) { this._run(this.countEnd); this.tick(); }
      return;
    }
    if (this.status !== "running") return;
    var prev = this.lastEl, el = this.elapsed();
    if (el <= prev) return;
    var lag = el - prev > 1500; // we were asleep or throttled: catch up quietly
    // 3-2-1 before each phase end
    for (var i = this.indexAt(prev); i < this.segs.length; i++) {
      var end = this.offsets[i] + this.segs[i].dur;
      if (this.offsets[i] > el) break;
      if (this.segs[i].dur >= 5000) {
        for (var k = 3; k >= 1; k--) {
          var at = end - k * 1000;
          if (at > prev && at <= el) this.onEvent({ type: "tick", n: k, quiet: lag });
        }
      }
    }
    if (!this.halfDone && this.total >= 60000 && el >= this.total / 2) {
      this.halfDone = true; this.onEvent({ type: "halfway", quiet: lag });
    }
    this.runMs += el - prev;
    this.lastEl = el;
    if (el >= this.total) { this._finish(); return; }
    var ni = this.indexAt(el);
    if (ni !== this.idx) {
      this.idx = ni;
      this.onEvent({ type: "phase", seg: this.segs[ni], idx: ni, quiet: lag });
    }
  };
  IV.Timer = Timer;
})();
