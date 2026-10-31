/* Interval app controller: timer view, presets, settings, focus mode, keyboard and tour. */
(function () {
  "use strict";
  var IV = window.IV;
  var $ = function (id) { return document.getElementById(id); };
  var DEFAULT_SETTINGS = { sound: true, volume: 0.7, voice: true, half: true, vibrate: true, lead: true, wake: true };
  var settings = Object.assign({}, DEFAULT_SETTINGS, ZL.store.get("settings", {}));
  var PRESETS = IV.presets();
  var cur = null;            // the loaded workout
  var session = null;        // { startedAt } once a run begins
  var timer, raf = 0, lastSessSave = 0, focusOn = false, wakeLock = null;
  var view = "timer";
  var R = {};                // render cache

  IV.cues.config(settings);

  /* ---------- workout loading ---------- */
  function sanitize(w) {
    if (!w || !Array.isArray(w.blocks) || !w.blocks.length) return null;
    if (!w.blocks.every(function (b) { return b && IV.TYPES[b.type] && b.sec > 0; })) return null;
    return w;
  }
  function inProgress() {
    var s = timer.status;
    return s === "countdown" || ((s === "running" || s === "paused") && timer.elapsed() > 0);
  }
  function setCurrent(w) {
    cur = w;
    ZL.store.set("current", w);
    timer.load(IV.expand(w));
    session = null;
    ZL.store.del("session");
    buildTimeline(); R = {}; render(true);
  }
  function loadWorkout(w, opts) {
    opts = opts || {};
    w = sanitize(IV.clone(w));
    if (!w) { ZL.toast("That workout has no blocks to run", { type: "bad" }); return Promise.resolve(false); }
    var ask = inProgress() && !(cur && cur.rest && w.rest)
      ? ZL.confirm({ title: "End the current session?", body: cur.name + " is still going. It will be saved to your history as stopped.", confirmLabel: "End and switch" })
      : Promise.resolve(true);
    return ask.then(function (ok) {
      if (!ok) return false;
      if (inProgress()) recordStop(true);
      setCurrent(w);
      go("timer");
      var t = $("iv-timer");
      if (opts.from && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: "start", behavior: "smooth" });
      if (opts.start) { IV.cues.unlock(); startRun(); ZL.toast(w.rest ? w.name + " started" : "Starting " + w.name); }
      else ZL.toast(w.name + " loaded");
      return true;
    });
  }

  /* ---------- history recording ---------- */
  function record(completed) {
    var entry = { name: cur.name, date: new Date((session && session.startedAt) || Date.now()).toISOString(), sec: Math.round(timer.runMs / 1000), planned: Math.round(timer.total / 1000), completed: completed };
    IV.history.add(entry);
    session = null; ZL.store.del("session");
    return entry;
  }
  function recordStop(quiet) {
    if (timer.runMs < 5000) { session = null; ZL.store.del("session"); return null; }
    var e = record(false);
    if (!quiet) ZL.toast("Saved to history: " + IV.fmt(e.sec) + " of " + e.name, { type: "info" });
    return e;
  }
  function saveSession() {
    if (!cur || !(timer.status === "running" || timer.status === "paused")) return;
    ZL.store.set("session", { durs: timer.segs.map(function (s) { return s.dur; }), elapsed: timer.elapsed(), runMs: timer.runMs, startedAt: session && session.startedAt, name: cur.name });
    lastSessSave = Date.now();
  }

  /* ---------- run controls ---------- */
  function startRun() {
    IV.cues.unlock();
    var lead = settings.lead && !cur.noLeadIn;
    timer.start(lead);
    render(true);
    loop();
  }
  function toggle() {
    IV.cues.unlock();
    if (timer.status === "running" || timer.status === "countdown") { timer.pause(); }
    else if (timer.status === "done") { timer.load(IV.expand(cur)); buildTimeline(); startRun(); }
    else startRun();
    render(true);
  }
  function reset() {
    var wasDone = timer.status === "done";
    if (timer.status === "idle" && timer.elapsed() === 0) { ZL.toast("Already at the start", { type: "info" }); return; }
    var e = !wasDone ? recordStop(true) : null;
    timer.load(IV.expand(cur)); buildTimeline();
    session = null; ZL.store.del("session");
    R = {}; render(true);
    ZL.toast(e ? "Reset. " + IV.fmt(e.sec) + " saved to history" : "Timer reset");
  }
  function skip() {
    if (timer.status === "done") { ZL.toast("Session is finished. Press Again to restart", { type: "info" }); return; }
    var last = timer.indexAt(timer.elapsed()) === timer.segs.length - 1;
    timer.skip(); loop(); render(true);
    if (!last) ZL.toast("Skipped to " + timer.info().seg.name);
  }
  function back() {
    timer.back(); render(true);
    ZL.toast("Back to " + timer.info().seg.name + " start");
  }
  function plus() {
    if (timer.status === "done") { ZL.toast("Session is finished", { type: "info" }); return; }
    var seg = timer.info().seg;
    if (timer.addTime(15000)) { buildTimeline(); render(true); saveSession(); ZL.toast("Added 15 s to " + seg.name); }
  }

  /* ---------- events from the timer ---------- */
  function announce(t) { $("iv-announce").textContent = t; }
  function onEvent(ev) {
    var running = timer.status === "running";
    switch (ev.type) {
      case "count": IV.cues.play("tick"); break;
      case "begin":
        session = { startedAt: Date.now() };
        IV.cues.play("go"); IV.cues.buzz(120);
        if (ev.seg) { IV.cues.say(ev.seg.name); announce(ev.seg.name + " started"); }
        wakeOn(); saveSession();
        break;
      case "resume": if (!session) session = { startedAt: Date.now() }; wakeOn(); announce("Resumed"); break;
      case "pause": wakeOff(); saveSession(); announce("Paused"); break;
      case "countdown-cancel": announce("Start cancelled"); break;
      case "tick": if (!ev.quiet) { IV.cues.play("tick"); IV.cues.buzz(30); } break;
      case "phase":
        if (!ev.quiet && (running || !ev.manual)) {
          IV.cues.play(ev.seg.type); IV.cues.buzz([180, 80, 180]);
          var say = ev.seg.name;
          if (ev.seg.reps > 1 && ev.seg.type === "work" && isGroupStart(ev.idx)) say = "Round " + ev.seg.rep + ". " + ev.seg.name;
          IV.cues.say(say);
        }
        announce(ev.seg.name + ", " + IV.fmt(ev.seg.dur / 1000) + (ev.seg.reps > 1 ? ", round " + ev.seg.rep + " of " + ev.seg.reps : ""));
        saveSession();
        break;
      case "halfway": if (!ev.quiet && settings.half) IV.cues.say("Halfway"); break;
      case "extend": break;
      case "done":
        IV.cues.play("done"); IV.cues.say("Done"); IV.cues.buzz([300, 100, 300, 100, 500]);
        wakeOff();
        if (session && timer.runMs >= 1000) { var e = record(true); ZL.toast(e.name + " complete. Saved to history", { action: { label: "View", fn: function () { go("history"); } } }); }
        else { session = null; ZL.store.del("session"); ZL.toast("Reached the end. Nothing was timed, so it wasn't saved", { type: "info" }); }
        announce("Session complete");
        break;
      case "reset": wakeOff(); break;
    }
  }
  function isGroupStart(i) {
    var s = timer.segs[i], p = timer.segs[i - 1];
    return !p || p.rep !== s.rep;
  }

  /* ---------- render loop ---------- */
  function loop() {
    if (raf) return;
    var step = function () {
      raf = 0;
      timer.tick(); render();
      if (timer.status === "running" || timer.status === "countdown") raf = requestAnimationFrame(step);
      else render(true);
    };
    raf = requestAnimationFrame(step);
  }
  // Background safety net: rAF stops in hidden tabs, intervals keep cues and phase changes on time.
  setInterval(function () {
    if (!timer || !(timer.status === "running" || timer.status === "countdown")) return;
    timer.tick();
    if (document.hidden) renderTitle(timer.info());
    else loop();
    if (Date.now() - lastSessSave > 3000) saveSession();
  }, 200);

  /* ---------- rendering ---------- */
  function set(id, key, val, prop) {
    if (R[key] === val) return;
    R[key] = val;
    var el = $(id); if (!el) return;
    if (prop) el.style.setProperty(prop, val); else el.textContent = val;
  }
  function attr(el, name, val) { if (el.getAttribute(name) !== String(val)) el.setAttribute(name, val); }

  function buildTimeline() {
    var tl = $("iv-timeline"), segs = timer.segs, tot = timer.total || 1;
    tl.classList.toggle("is-dense", segs.length > 40);
    tl.innerHTML = segs.map(function (s, i) {
      var lbl = "Block " + (i + 1) + ": " + s.name + ", " + IV.fmt(s.dur / 1000) + (s.reps > 1 ? ", round " + s.rep + " of " + s.reps : "");
      return '<button type="button" class="iv-seg" tabindex="-1" data-i="' + i + '" data-type="' + s.type + '" style="flex-grow:' + (s.dur / tot * 1000).toFixed(2) + '" aria-label="' + ZL.esc(lbl) + '" title="' + ZL.esc(s.name + " " + IV.fmt(s.dur / 1000)) + '"><i><b></b></i></button>';
    }).join("");
    var g = cur ? IV.normGroup(cur) : null;
    $("iv-tl-label").textContent = g && g.times > 1 ? g.times + " rounds, " + segs.length + " blocks" : segs.length + (segs.length === 1 ? " block" : " blocks");
    R.tlIdx = -1; R.tlStatus = "";
  }

  function renderTitle(I) {
    var t = I.status === "running" || I.status === "paused" ? IV.fmtRemain(I.remain) + " " + I.seg.name + " — Interval" : I.status === "countdown" ? "Get ready — Interval" : "Interval — workout and rest timer";
    if (document.title !== t) document.title = t;
  }

  var STATUS = { idle: "Ready", countdown: "Starting", running: "Running", paused: "Paused", done: "Done" };
  function render(force) {
    if (!timer || !cur) return;
    if (force) R = {};
    var I = timer.info(), st = I.status, seg = I.seg, t = $("iv-timer");
    var type = st === "countdown" ? "prep" : st === "done" ? "done" : seg ? seg.type : "work";
    attr(t, "data-type", type); attr(t, "data-status", st);
    attr($("iv-dot"), "data-status", st);
    set("iv-status", "status", STATUS[st] + (st === "running" || st === "paused" ? ", " + IV.fmt(Math.ceil((I.total - I.elapsed) / 1000 - 1e-6)) + " left" : ""));
    set("iv-title", "title", cur.name);
    set("iv-focus-name", "fname", cur.name);
    set("iv-sess-name", "sname", cur.name);

    // centre text
    var phase, time, round, nextName = "", nextTime = "", showNext = true;
    if (st === "countdown") {
      phase = "Get ready"; time = String(Math.max(1, Math.ceil(I.countRemain / 1000))); round = "Starting with " + seg.name; nextName = seg.name; nextTime = IV.fmt(seg.dur / 1000);
    } else if (st === "done") {
      phase = "Done"; time = IV.fmt(I.total / 1000); round = "Saved to your history"; showNext = false;
    } else {
      phase = seg.name; time = IV.fmtRemain(I.remain);
      round = seg.reps > 1 ? "Round " + seg.rep + " of " + seg.reps : "Block " + (I.idx + 1) + " of " + timer.segs.length;
      if (I.next) { nextName = I.next.name; nextTime = IV.fmt(I.next.dur / 1000); } else { nextName = "Finish"; nextTime = ""; }
    }
    set("iv-phase-name", "phase", phase);
    set("iv-time", "time", time);
    if (R.timeLen !== time.length) { R.timeLen = time.length; attr($("iv-time"), "data-len", time.length); }
    set("iv-round", "round", round);
    set("iv-next-name", "nname", nextName);
    set("iv-next-time", "ntime", nextTime);
    if (R.showNext !== showNext) { R.showNext = showNext; $("iv-next").hidden = !showNext; }
    var final3 = st === "running" && I.remain <= 3000 && seg.dur >= 5000 || st === "countdown";
    if (R.final3 !== final3) { R.final3 = final3; t.classList.toggle("is-final", final3); }

    // rings (pathLength 1000). The phase ring empties as time runs out; the session ring fills.
    var pf = st === "countdown" ? 1 - I.countRemain / timer.leadMs : st === "done" ? 1 : I.frac;
    $("iv-bar").style.strokeDashoffset = (1000 * Math.min(1, Math.max(0, st === "done" ? 0 : pf))).toFixed(1);
    $("iv-sess-bar").style.strokeDashoffset = (1000 * (1 - I.sessFrac)).toFixed(1);

    // controls
    var playing = st === "running" || st === "countdown";
    attr($("iv-start"), "data-playing", playing);
    set("iv-start-label", "slabel", st === "running" ? "Pause" : st === "countdown" ? "Cancel" : st === "paused" ? "Resume" : st === "done" ? "Again" : "Start");
    attr($("iv-start"), "aria-label", (st === "running" ? "Pause" : st === "countdown" ? "Cancel start" : st === "paused" ? "Resume" : st === "done" ? "Start again" : "Start") + " (Space)");
    $("iv-plus").disabled = st === "done";
    $("iv-skip").disabled = st === "done";

    // timeline
    var tl = $("iv-timeline");
    if (R.tlIdx !== I.idx || R.tlStatus !== st) {
      R.tlIdx = I.idx; R.tlStatus = st;
      Array.prototype.forEach.call(tl.children, function (b, i) {
        var past = st === "done" || i < I.idx, now = st !== "done" && i === I.idx && st !== "idle" && st !== "countdown";
        b.classList.toggle("is-past", past); b.classList.toggle("is-now", now);
        b.classList.toggle("is-next", (st === "idle" || st === "countdown") && i === 0);
        if (!now) b.firstChild.firstChild.style.width = "";
      });
    }
    var nowEl = tl.children[I.idx];
    if (nowEl && nowEl.classList.contains("is-now")) nowEl.firstChild.firstChild.style.width = (I.frac * 100).toFixed(2) + "%";
    set("iv-elapsed", "el", IV.fmt(Math.floor(I.elapsed / 1000)));
    set("iv-total", "tot", IV.fmt(I.total / 1000));

    // side card
    set("iv-st-elapsed", "sel", IV.fmt(Math.floor(I.elapsed / 1000)));
    set("iv-st-left", "sleft", IV.fmt(Math.ceil((I.total - I.elapsed) / 1000 - 1e-6)));
    var doneCount = st === "done" ? timer.segs.length : st === "idle" || st === "countdown" ? 0 : I.idx;
    set("iv-st-blocks", "sblocks", doneCount + "/" + timer.segs.length);
    renderUpNext(I);
    renderTitle(I);
  }

  function renderUpNext(I) {
    var key = I.idx + ":" + I.status + ":" + timer.total;
    if (R.upKey === key) return; R.upKey = key;
    var ol = $("iv-upnext");
    if (I.status === "done") { ol.innerHTML = '<li class="iv-up-done">' + ZL.icons.check + "<span>All " + timer.segs.length + " blocks done. Nice work.</span></li>"; return; }
    var from = I.idx, rows = timer.segs.slice(from, from + 5);
    ol.innerHTML = rows.map(function (s, k) {
      var isNow = k === 0 && (I.status === "running" || I.status === "paused");
      return '<li data-type="' + s.type + '"' + (isNow ? ' class="is-now"' : "") + '><span class="iv-up-dot"></span><span class="iv-up-name">' + ZL.esc(s.name) +
        (s.reps > 1 ? ' <small>Round ' + s.rep + "</small>" : "") + '</span><span class="iv-up-time num">' + (isNow ? "Now" : IV.fmt(s.dur / 1000)) + "</span></li>";
    }).join("") + (timer.segs.length - from > 5 ? '<li class="iv-up-more">' + (timer.segs.length - from - 5) + " more after these</li>" : "");
  }

  /* ---------- tabs ---------- */
  var VIEWS = ["timer", "presets", "builder", "history"];
  function go(v) {
    if (VIEWS.indexOf(v) < 0) v = "timer";
    view = v;
    VIEWS.forEach(function (n) {
      var tab = $("tab-" + n), panel = $("view-" + n), on = n === v;
      tab.setAttribute("aria-selected", on); tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    ZL.store.set("view", v);
    if (v === "history") IV.history.renderChart();
    if (v === "timer") render(true);
  }
  function initTabs() {
    var tl = $("iv-tabs");
    tl.addEventListener("click", function (e) { var b = e.target.closest("[data-view]"); if (b) go(b.getAttribute("data-view")); });
    tl.addEventListener("keydown", function (e) {
      var i = VIEWS.indexOf(view), n = null;
      if (e.key === "ArrowRight") n = (i + 1) % VIEWS.length;
      if (e.key === "ArrowLeft") n = (i + VIEWS.length - 1) % VIEWS.length;
      if (e.key === "Home") n = 0; if (e.key === "End") n = VIEWS.length - 1;
      if (n === null) return;
      e.preventDefault(); go(VIEWS[n]); $("tab-" + VIEWS[n]).focus();
    });
    document.addEventListener("click", function (e) { var b = e.target.closest("[data-goto]"); if (b) go(b.getAttribute("data-goto")); });
  }

  /* ---------- presets ---------- */
  function renderPresets() {
    var grid = $("iv-preset-grid");
    grid.insertAdjacentHTML("beforeend", PRESETS.map(function (p) {
      var types = {}; IV.expand(p).forEach(function (s) { types[s.type] = 1; });
      return '<article class="iv-preset" data-id="' + p.id + '">' +
        '<div class="iv-preset-top">' + Object.keys(types).map(function (t) { return '<span class="iv-swatch" data-type="' + t + '"></span>'; }).join("") + "<h3>" + ZL.esc(p.name) + "</h3></div>" +
        "<p>" + ZL.esc(p.desc) + "</p>" +
        '<div class="iv-mini" aria-hidden="true">' + IV.miniBar(p) + "</div>" +
        '<div class="iv-preset-foot"><span class="iv-preset-meta"><b class="num">' + IV.fmt(IV.totalSec(p)) + "</b>" + ZL.esc(IV.describe(p).split(", ").slice(1).join(", ")) + "</span>" +
        '<span class="iv-preset-acts"><button class="zl-btn zl-btn-secondary zl-btn-sm" type="button" data-pact="edit" aria-label="Copy ' + ZL.esc(p.name) + ' to the builder">Edit</button>' +
        '<button class="zl-btn zl-btn-primary zl-btn-sm" type="button" data-pact="start" aria-label="Start ' + ZL.esc(p.name) + '">Start</button></span></div></article>';
    }).join(""));
    grid.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pact]"); if (!b) return;
      var p = PRESETS.filter(function (x) { return x.id === b.closest("[data-id]").getAttribute("data-id"); })[0];
      if (b.getAttribute("data-pact") === "start") loadWorkout(p, { start: true, from: "preset" });
      else IV.builder.edit(p, false);
    });
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-rest]"); if (!b) return;
      loadWorkout(IV.restTimer(+b.getAttribute("data-rest")), { start: true, from: "rest" });
    });
  }

  /* ---------- settings ---------- */
  function saveSettings() { ZL.store.set("settings", settings); IV.cues.config(settings); }
  function initSettings() {
    var dlg = $("iv-settings"), changed = false;
    var map = { "s-sound": "sound", "s-voice": "voice", "s-half": "half", "s-vibrate": "vibrate", "s-lead": "lead", "s-wake": "wake" };
    function sync() {
      Object.keys(map).forEach(function (id) { $(id).checked = !!settings[map[id]]; });
      $("s-volume").value = Math.round(settings.volume * 100);
      $("s-volume-val").textContent = Math.round(settings.volume * 100) + "%";
      $("s-volume").disabled = !settings.sound; $("s-test").disabled = !settings.sound;
      $("s-half").disabled = !settings.voice || !IV.cues.hasVoice(); $("s-test-voice").disabled = !settings.voice || !IV.cues.hasVoice();
      if (!IV.cues.hasVoice()) { $("s-voice").disabled = true; $("s-voice-hint").textContent = "This browser has no speech voices, so voice cues are unavailable."; }
      if (!IV.cues.hasVibrate()) { $("s-vibrate").disabled = true; $("s-vibrate-hint").textContent = "This device can't vibrate from the browser. iPhones don't allow it."; }
    }
    $("iv-settings-btn").addEventListener("click", function () { changed = false; sync(); dlg.showModal(); });
    Object.keys(map).forEach(function (id) {
      $(id).addEventListener("change", function () {
        settings[map[id]] = this.checked; changed = true; saveSettings(); sync();
        if (id === "s-wake") { if (!this.checked) wakeOff(true); else if (timer.status === "running") wakeOn(); else setWake("idle"); }
      });
    });
    $("s-volume").addEventListener("input", function () { settings.volume = this.value / 100; changed = true; $("s-volume-val").textContent = this.value + "%"; saveSettings(); });
    $("s-volume").addEventListener("change", function () { IV.cues.play("tick"); });
    $("s-test").addEventListener("click", function () {
      IV.cues.unlock(); IV.cues.play("test");
      var b = this; b.textContent = "Playing"; setTimeout(function () { b.textContent = "Test sound"; }, 900);
    });
    $("s-test-voice").addEventListener("click", function () { IV.cues.say("Work. Rest. Halfway. Done."); });
    dlg.addEventListener("close", function () { if (changed) ZL.toast("Sound settings saved"); });
    sync();
  }

  /* ---------- screen wake lock ---------- */
  var WAKE = {
    idle: "Screen on while running", on: "Screen staying on", off: "Screen can sleep",
    unsupported: "Screen may sleep", denied: "Screen may sleep"
  };
  var WAKE_TIP = {
    idle: "The screen stays awake while the timer runs",
    on: "Wake lock is active. Your screen won't dim while the timer runs",
    off: "Keep screen on is turned off in Sound settings",
    unsupported: "This browser can't keep the screen on. Raise your auto-lock time",
    denied: "The browser declined the wake lock. Battery saver can cause this"
  };
  function setWake(s) {
    var el = $("iv-wake"); el.setAttribute("data-state", s);
    $("iv-wake-text").textContent = WAKE[s]; el.setAttribute("data-tip", WAKE_TIP[s]);
  }
  function wakeOn() {
    if (!settings.wake) { setWake("off"); return; }
    if (!("wakeLock" in navigator)) { setWake("unsupported"); return; }
    if (wakeLock) { setWake("on"); return; }
    navigator.wakeLock.request("screen").then(function (l) {
      wakeLock = l; setWake("on");
      if (timer.status !== "running") { wakeOff(); return; }
      l.addEventListener("release", function () { wakeLock = null; setWake(timer.status === "running" && !document.hidden ? "denied" : settings.wake ? "idle" : "off"); });
    }, function () { setWake("denied"); });
  }
  function wakeOff(keepText) {
    if (wakeLock) { var l = wakeLock; wakeLock = null; l.release().catch(function () {}); }
    setWake(settings.wake ? "idle" : "off");
  }
  document.addEventListener("visibilitychange", function () {
    if (!timer) return;
    if (!document.hidden) { timer.tick(); render(true); if (timer.status === "running") { wakeOn(); loop(); } }
    else saveSession();
  });

  /* ---------- focus mode ---------- */
  function setFocus(on) {
    if (on === focusOn) return;
    focusOn = on;
    var t = $("iv-timer");
    t.classList.toggle("is-focus", on);
    document.documentElement.classList.toggle("iv-focus-open", on);
    $("iv-focus-btn").setAttribute("aria-pressed", on);
    if (on) {
      if (t.requestFullscreen && !document.fullscreenElement) { try { t.requestFullscreen({ navigationUI: "hide" }).catch(function () {}); } catch (e) { /* not allowed */ } }
      $("iv-exit-focus").focus();
    } else {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      $("iv-focus-btn").focus({ preventScroll: true });
      ZL.toast("Left focus mode", { type: "info" });
    }
    render(true);
  }
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && focusOn) setFocus(false); });

  /* ---------- keyboard ---------- */
  var swallowKeyup = false;
  function openKeys() { var d = $("iv-keys"); if (!d.open) d.showModal(); }
  function initKeys() {
    $("iv-keys-btn").addEventListener("click", openKeys);
    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && t.closest && t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector(".zl-tour-card")) return;
      if (document.querySelector("dialog[open]")) return;
      var k = e.key;
      if (k === " " || k === "Spacebar") {
        var btn = t && t.closest && t.closest("button, a, summary");
        if (btn && !btn.closest("#iv-timer") && !btn.closest(".iv-rest-btns")) return; // let other buttons activate normally
        e.preventDefault(); swallowKeyup = true; toggle(); return;
      }
      if (e.repeat) return;
      var lk = k.toLowerCase();
      if (lk === "r") { e.preventDefault(); reset(); }
      else if (lk === "n") { e.preventDefault(); skip(); }
      else if (lk === "b") { e.preventDefault(); back(); }
      else if (lk === "f") { e.preventDefault(); setFocus(!focusOn); }
      else if (k === "?") { e.preventDefault(); openKeys(); }
      else if (k === "Escape" && focusOn && !document.fullscreenElement) { setFocus(false); }
    });
    document.addEventListener("keyup", function (e) { if (swallowKeyup && (e.key === " " || e.key === "Spacebar")) { e.preventDefault(); swallowKeyup = false; } });
  }

  /* ---------- controls wiring ---------- */
  function initControls() {
    $("iv-start").addEventListener("click", toggle);
    $("iv-reset").addEventListener("click", reset);
    $("iv-skip").addEventListener("click", skip);
    $("iv-back").addEventListener("click", back);
    $("iv-plus").addEventListener("click", plus);
    $("iv-focus-btn").addEventListener("click", function () { setFocus(!focusOn); });
    $("iv-exit-focus").addEventListener("click", function () { setFocus(false); });
    $("iv-timeline").addEventListener("click", function (e) {
      var b = e.target.closest(".iv-seg"); if (!b) return;
      var i = +b.getAttribute("data-i");
      timer.jump(i); loop(); render(true);
      ZL.toast("Jumped to block " + (i + 1) + ": " + timer.segs[i].name);
    });
    $("iv-edit-current").addEventListener("click", function () {
      var isSaved = cur.id && IV.builder.saved().some(function (w) { return w.id === cur.id; });
      IV.builder.edit(isSaved ? IV.builder.saved().filter(function (w) { return w.id === cur.id; })[0] : cur, isSaved);
    });
  }

  /* ---------- tour ---------- */
  function initTour() {
    ZL.tour([
      { el: "#iv-ring", title: "The ring", body: "The inner ring empties as this block runs down and changes colour by phase. The outer ring fills over the whole session.", before: function () { setFocus(false); go("timer"); } },
      { el: "#iv-controls", title: "Controls", body: "Start or pause with Space. Back restarts the block, Skip moves on, and +15 adds time when you need a longer rest.", before: function () { go("timer"); } },
      { el: "#iv-timeline-wrap", title: "Timeline", body: "Every block in the session, coloured by type. Select any block to jump to it.", before: function () { go("timer"); } },
      { el: "#iv-preset-grid", title: "Presets", body: "Tabata, EMOM, HIIT, boxing, Pomodoro, a stretch flow and one-tap rest timers.", before: function () { go("presets"); } },
      { el: ".iv-builder", title: "Builder", body: "Make your own workout from blocks, repeat a group of them, and save it for next time.", before: function () { go("builder"); } },
      { el: "#iv-hist-stats", title: "History", body: "Every finished or stopped session is saved here with your streak and weekly minutes.", before: function () { go("history"); } },
      { el: "#iv-settings-btn", title: "Sound and cues", body: "Set the volume, turn voice cues and vibration on or off, and test them before you start.", before: function () { go("timer"); } }
    ]);
  }

  /* ---------- init ---------- */
  function init() {
    timer = new IV.Timer({ onEvent: onEvent });
    IV.history.init();
    IV.builder.init();
    renderPresets(); initTabs(); initControls(); initSettings(); initKeys();

    var w = sanitize(ZL.store.get("current", null)) || IV.clone(PRESETS[0]);
    cur = w; timer.load(IV.expand(w)); buildTimeline();
    // Restore a session interrupted by a reload, paused where it was.
    var s = ZL.store.get("session", null);
    if (s && Array.isArray(s.durs) && s.durs.length === timer.segs.length && s.elapsed > 0) {
      var segs = IV.expand(w).map(function (seg, i) { seg.dur = s.durs[i]; return seg; });
      timer.restore(segs, s.elapsed); timer.runMs = s.runMs || 0; buildTimeline();
      session = { startedAt: s.startedAt || Date.now() };
      setTimeout(function () {
        ZL.toast("Picked up where you left off: paused in " + timer.info().seg.name, { type: "info", action: { label: "Reset", fn: reset } });
      }, 400);
    }
    setWake(settings.wake ? "idle" : "off");
    go(ZL.store.get("view", "timer"));
    render(true);
    initTour();
    document.documentElement.classList.add("iv-ready");
  }

  IV.onHistoryChange = function (n) { var t = $("tab-history"); if (t) t.textContent = n ? "History (" + n + ")" : "History"; };
  IV.app = {
    loadWorkout: loadWorkout, go: go, toggle: toggle, reset: reset, skip: skip, back: back,
    onWorkoutSaved: function (w) { if (cur && cur.id === w.id && !inProgress()) { cur = IV.clone(w); ZL.store.set("current", cur); timer.load(IV.expand(cur)); buildTimeline(); render(true); } },
    get timer() { return timer; }, get current() { return cur; }, settings: function () { return settings; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
