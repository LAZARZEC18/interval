/* Interval history: saved sessions, stats, streaks and the minutes chart. */
(function () {
  "use strict";
  var IV = (window.IV = window.IV || {});
  var $ = function (id) { return document.getElementById(id); };
  var list = [];
  var range = "days";
  var DAY = 86400000;

  function dayKey(d) { d = new Date(d); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function startOfDay(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
  function startOfWeek(d) { d = startOfDay(d); var wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d; }
  function addDays(d, n) { d = new Date(d); d.setDate(d.getDate() + n); return d; }

  function load() { var v = ZL.store.get("history", []); list = Array.isArray(v) ? v.filter(function (s) { return s && s.date && typeof s.sec === "number"; }) : []; }
  function save() { ZL.store.set("history", list); }

  /* ---------- stats ---------- */
  function activeDays() {
    var set = {};
    list.forEach(function (s) { if (s.sec >= 30) set[dayKey(s.date)] = true; });
    return set;
  }
  function streaks() {
    var days = activeDays(), cur = 0, best = 0, d = startOfDay(new Date());
    if (!days[dayKey(d)]) d = addDays(d, -1);
    while (days[dayKey(d)]) { cur++; d = addDays(d, -1); }
    var keys = Object.keys(days).sort(), run = 0, prev = null;
    keys.forEach(function (k) {
      var t = new Date(k + "T00:00:00");
      run = prev && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
      if (run > best) best = run; prev = t;
    });
    return { current: cur, best: Math.max(best, cur) };
  }
  function weekMinutes() {
    var from = startOfWeek(new Date()).getTime();
    return list.reduce(function (a, s) { return new Date(s.date).getTime() >= from ? a + s.sec : a; }, 0) / 60;
  }
  function buckets() {
    var out = [], today = startOfDay(new Date());
    if (range === "days") {
      for (var i = 6; i >= 0; i--) {
        var d = addDays(today, -i);
        out.push({ from: d.getTime(), to: addDays(d, 1).getTime(), label: d.toLocaleDateString("en-AU", { weekday: "short" }), long: d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" }), now: i === 0 });
      }
    } else {
      var w = startOfWeek(today);
      for (var j = 7; j >= 0; j--) {
        var s = addDays(w, -7 * j);
        out.push({ from: s.getTime(), to: addDays(s, 7).getTime(), label: s.toLocaleDateString("en-AU", { day: "numeric", month: "short" }), long: "Week of " + s.toLocaleDateString("en-AU", { day: "numeric", month: "long" }), now: j === 0 });
      }
    }
    out.forEach(function (b) {
      b.sec = 0; b.n = 0;
      list.forEach(function (s) { var t = new Date(s.date).getTime(); if (t >= b.from && t < b.to) { b.sec += s.sec; b.n++; } });
      b.min = b.sec / 60;
    });
    return out;
  }
  function niceMax(v) {
    if (v <= 0) return 10;
    var steps = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 480, 600, 900, 1200];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= v) return steps[i];
    return Math.ceil(v / 600) * 600;
  }

  /* ---------- chart ---------- */
  var chartEl, tipEl;
  function renderChart() {
    chartEl = chartEl || $("iv-chart");
    if (!chartEl || chartEl.offsetParent === null && !chartEl.clientWidth) { if (chartEl) chartEl._stale = true; return; }
    chartEl._stale = false;
    var bs = buckets(), W = Math.max(280, chartEl.clientWidth || 600), H = 220;
    var padL = 40, padR = 8, padT = 12, padB = 30, iw = W - padL - padR, ih = H - padT - padB;
    var max = niceMax(Math.max.apply(null, bs.map(function (b) { return b.min; })));
    var ticks = [0, max / 2, max];
    var slot = iw / bs.length, bw = Math.min(44, slot * 0.56);
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Minutes trained, ' + (range === "days" ? "last 7 days" : "last 8 weeks") + '">';
    ticks.forEach(function (t) {
      var y = padT + ih - (t / max) * ih;
      svg += '<line class="iv-grid' + (t === 0 ? " iv-grid-base" : "") + '" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>';
      svg += '<text class="iv-axis" x="' + (padL - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(t) + "</text>";
    });
    svg += '<text class="iv-axis iv-axis-unit" x="' + (padL - 10) + '" y="' + (padT - 2) + '" text-anchor="end"></text>';
    bs.forEach(function (b, i) {
      var cx = padL + slot * i + slot / 2, h = b.min > 0 ? Math.max(6, (b.min / max) * ih) : 3, y = padT + ih - h;
      var lbl = b.long + ": " + Math.round(b.min) + " minutes, " + b.n + (b.n === 1 ? " session" : " sessions");
      svg += '<g class="iv-bar-g' + (b.now ? " is-now" : "") + (b.min ? "" : " is-zero") + '" tabindex="0" role="img" aria-label="' + ZL.esc(lbl) + '" data-i="' + i + '">' +
        '<rect class="iv-bar-hit" x="' + (cx - slot / 2) + '" y="' + padT + '" width="' + slot + '" height="' + ih + '"/>' +
        '<rect class="iv-bar-r" x="' + (cx - bw / 2) + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="' + Math.min(8, bw / 2, h / 2) + '"/>' +
        '<text class="iv-axis' + (b.now ? " iv-axis-now" : "") + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + ZL.esc(b.label) + "</text></g>";
    });
    svg += "</svg>";
    chartEl.innerHTML = svg + '<div class="iv-tip" id="iv-tip" role="status" hidden></div>';
    tipEl = $("iv-tip");
    Array.prototype.forEach.call(chartEl.querySelectorAll(".iv-bar-g"), function (g) {
      var b = bs[+g.getAttribute("data-i")];
      function show() {
        Array.prototype.forEach.call(chartEl.querySelectorAll(".iv-bar-g.is-hover"), function (x) { x.classList.remove("is-hover"); });
        g.classList.add("is-hover");
        tipEl.innerHTML = "<b>" + ZL.esc(b.long) + "</b><span>" + Math.round(b.min) + " min, " + b.n + (b.n === 1 ? " session" : " sessions") + "</span>";
        tipEl.hidden = false;
        var r = g.querySelector(".iv-bar-r").getBoundingClientRect(), c = chartEl.getBoundingClientRect();
        var left = r.left - c.left + r.width / 2, tw = tipEl.offsetWidth;
        tipEl.style.left = Math.max(tw / 2, Math.min(c.width - tw / 2, left)) + "px";
        tipEl.style.top = Math.max(0, r.top - c.top - tipEl.offsetHeight - 10) + "px";
      }
      function hide() { g.classList.remove("is-hover"); tipEl.hidden = true; }
      g.addEventListener("pointerenter", show); g.addEventListener("pointerleave", hide);
      g.addEventListener("click", show); g.addEventListener("focus", show); g.addEventListener("blur", hide);
    });
  }

  /* ---------- list ---------- */
  function when(d) {
    d = new Date(d);
    var today = startOfDay(new Date()), day = startOfDay(d), diff = Math.round((today - day) / DAY);
    var t = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
    var ds = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
    return ds + ", " + t;
  }
  function renderList() {
    var ul = $("iv-log"), empty = $("iv-log-empty");
    var items = list.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    empty.hidden = items.length > 0;
    ul.hidden = !items.length;
    $("iv-h-clear").hidden = !items.length;
    ul.innerHTML = items.slice(0, 60).map(function (s) {
      var pct = s.planned ? Math.min(100, Math.round((s.sec / s.planned) * 100)) : 100;
      return '<li class="iv-log-item" data-id="' + ZL.esc(s.id) + '">' +
        '<span class="iv-log-ic ' + (s.completed ? "ok" : "stop") + '" aria-hidden="true">' + (s.completed ? ZL.icons.check : '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>') + "</span>" +
        '<span class="iv-log-main"><b>' + ZL.esc(s.name) + "</b><span>" + ZL.esc(when(s.date)) + "</span></span>" +
        '<span class="iv-log-dur"><b class="num">' + IV.fmt(s.sec) + '</b><span class="' + (s.completed ? "is-ok" : "") + '">' + (s.completed ? "Finished" : "Stopped at " + pct + "%") + "</span></span>" +
        '<button class="zl-iconbtn iv-log-del" type="button" aria-label="Delete ' + ZL.esc(s.name) + ' session" data-tip="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button></li>';
    }).join("");
  }
  function renderStats() {
    var st = streaks(), wm = weekMinutes(), done = list.filter(function (s) { return s.completed; }).length;
    $("iv-h-streak").textContent = st.current;
    $("iv-h-best").textContent = "Best " + st.best + (st.best === 1 ? " day" : " days");
    $("iv-h-week").textContent = Math.round(wm) + " min";
    $("iv-h-count").textContent = list.length;
    $("iv-h-rate").textContent = list.length ? Math.round((done / list.length) * 100) + "%" : "0%";
    $("iv-chart-sub").textContent = range === "days" ? "Minutes per day, last 7 days" : "Minutes per week, last 8 weeks";
  }
  function render() { renderStats(); renderList(); renderChart(); IV.onHistoryChange && IV.onHistoryChange(list.length); }

  /* ---------- example data ---------- */
  function example() {
    var now = new Date(), out = [];
    var plan = [
      [0, 7, 15, "Tabata", 240, true], [0, 18, 5, "Rest 1:30", 90, true],
      [1, 6, 40, "Boxing rounds", 1380, true], [2, 17, 30, "HIIT 30/30", 570, true], [2, 17, 55, "5-min stretch", 300, true],
      [3, 7, 5, "EMOM 10 min", 600, true], [4, 18, 20, "Leg day finisher", 760, false], [5, 6, 50, "Tabata", 240, true],
      [7, 9, 0, "Pomodoro", 6900, true], [8, 6, 45, "HIIT 30/30", 570, true], [10, 17, 10, "Boxing rounds", 1380, true],
      [12, 7, 0, "EMOM 10 min", 420, false], [14, 18, 0, "Tabata", 240, true], [16, 6, 30, "Leg day finisher", 1020, true],
      [19, 17, 45, "HIIT 30/30", 570, true], [23, 7, 10, "Boxing rounds", 1380, true]
    ];
    plan.forEach(function (p, i) {
      var d = startOfDay(now); d.setDate(d.getDate() - p[0]); d.setHours(p[1], p[2], 0, 0);
      if (d > now) d = new Date(now.getTime() - (i + 1) * 3600000);
      var planned = p[3] === "Leg day finisher" ? 1020 : p[3] === "EMOM 10 min" ? 600 : p[4];
      out.push({ id: "ex" + i, name: p[3], date: d.toISOString(), sec: p[4], planned: planned, completed: p[5] });
    });
    return out;
  }

  IV.history = {
    init: function () {
      load();
      $("iv-chart-seg").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-range]"); if (!b) return;
        range = b.getAttribute("data-range");
        Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b); });
        ZL.store.set("chartRange", range);
        renderStats(); renderChart();
      });
      var saved = ZL.store.get("chartRange", "days");
      if (saved === "weeks") { range = "weeks"; Array.prototype.forEach.call($("iv-chart-seg").querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-range") === "weeks"); }); }
      $("iv-log").addEventListener("click", function (e) {
        var b = e.target.closest(".iv-log-del"); if (!b) return;
        var id = b.closest("li").getAttribute("data-id");
        var idx = list.findIndex(function (s) { return s.id === id; }); if (idx < 0) return;
        var removed = list.splice(idx, 1)[0]; save(); render();
        ZL.toast("Session deleted", { action: { label: "Undo", fn: function () { list.push(removed); save(); render(); ZL.toast("Session restored"); } } });
      });
      $("iv-h-clear").addEventListener("click", function () {
        ZL.confirm({ title: "Clear all history?", body: "This deletes " + list.length + (list.length === 1 ? " session" : " sessions") + " and resets your streak. It can't be undone.", confirmLabel: "Clear history", danger: true }).then(function (ok) {
          if (!ok) return; list = []; save(); render(); ZL.toast("History cleared");
        });
      });
      $("iv-h-example").addEventListener("click", function () { IV.history.loadExample(); ZL.toast("Example history loaded"); });
      if ("ResizeObserver" in window) {
        var lastW = 0;
        new ResizeObserver(function () { var w = $("iv-chart").clientWidth; if (w && Math.abs(w - lastW) > 4) { lastW = w; renderChart(); } }).observe($("iv-chart"));
      }
      render();
    },
    add: function (s) {
      s.id = s.id || IV.id("s"); list.push(s); if (list.length > 1000) list.shift(); save(); render(); return s;
    },
    loadExample: function () { list = example(); save(); render(); },
    all: function () { return list.slice(); },
    render: render, renderChart: renderChart,
    _streaks: streaks
  };
})();
