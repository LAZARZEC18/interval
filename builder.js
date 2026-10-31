/* Interval builder: block editor, repeat group, saved workouts. */
(function () {
  "use strict";
  var IV = (window.IV = window.IV || {});
  var $ = function (id) { return document.getElementById(id); };
  var draft, saved = [], saveT = 0;

  var ICON = {
    handle: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10l6 6 6-6"/></svg>',
    dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'
  };

  function defaultDraft() {
    var B = IV.block;
    return { id: null, name: "Leg day finisher", blocks: [B("prep", "Get ready", 10), B("work", "Jump squats", 40), B("rest", "Rest", 20), B("work", "Walking lunges", 40), B("rest", "Rest", 20), B("cooldown", "Walk it off", 60)],
      group: { start: 1, end: 4, times: 3, skipLastRest: true } };
  }
  function valid(w) { return w && Array.isArray(w.blocks) && w.blocks.every(function (b) { return b && IV.TYPES[b.type] && typeof b.sec === "number"; }); }

  function persist() { clearTimeout(saveT); saveT = setTimeout(function () { ZL.store.set("draft", draft); }, 150); }
  function persistSaved() { ZL.store.set("workouts", saved); }

  /* ---------- summary helpers ---------- */
  IV.describe = function (w) {
    var segs = IV.expand(w), g = IV.normGroup(w);
    var n = segs.length, parts = [IV.fmtLong(IV.totalSec(w))];
    if (g && g.times > 1) parts.push(g.times + " rounds"); else parts.push(n + (n === 1 ? " block" : " blocks"));
    return parts.join(", ");
  };
  IV.miniBar = function (w) {
    var segs = IV.expand(w), tot = segs.reduce(function (a, s) { return a + s.dur; }, 0) || 1;
    return segs.map(function (s) { return '<i data-type="' + s.type + '" style="flex-grow:' + (s.dur / tot * 1000).toFixed(1) + '"></i>'; }).join("");
  };

  /* ---------- rendering ---------- */
  function typeOptions(sel) {
    return IV.TYPE_ORDER.map(function (t) { return '<option value="' + t + '"' + (t === sel ? " selected" : "") + ">" + IV.TYPES[t].label + "</option>"; }).join("");
  }
  function renderBlocks(focusSel) {
    var ol = $("iv-blocks"), g = IV.normGroup(draft);
    $("iv-blocks-empty").hidden = draft.blocks.length > 0;
    ol.hidden = !draft.blocks.length;
    ol.innerHTML = draft.blocks.map(function (b, i) {
      var n = i + 1, inG = g && i >= g.start && i <= g.end;
      var cls = "iv-brow" + (inG ? " in-group" : "") + (inG && i === g.start ? " g-first" : "") + (inG && i === g.end ? " g-last" : "");
      return '<li class="' + cls + '" data-id="' + b.id + '" data-type="' + b.type + '"' + (inG && i === g.start ? ' data-glabel="Repeat ×' + g.times + '"' : "") + ">" +
        '<button class="iv-handle" type="button" aria-label="Drag block ' + n + ' to reorder" tabindex="-1">' + ICON.handle + "</button>" +
        '<span class="iv-bnum num" aria-hidden="true">' + n + "</span>" +
        '<div class="iv-bfields">' +
        '<select class="zl-select iv-btype" aria-label="Type of block ' + n + '" data-f="type">' + typeOptions(b.type) + "</select>" +
        '<input class="zl-input iv-bname" aria-label="Name of block ' + n + '" data-f="name" maxlength="32" value="' + ZL.esc(b.name) + '" placeholder="' + IV.TYPES[b.type].label + '">' +
        '<input class="zl-input iv-bdur num" aria-label="Duration of block ' + n + ', minutes and seconds" data-f="sec" inputmode="numeric" autocomplete="off" value="' + IV.fmt(b.sec) + '">' +
        "</div>" +
        '<div class="iv-bacts">' +
        '<button class="iv-bact" type="button" data-act="up" aria-label="Move block ' + n + ' up" data-tip="Move up"' + (i === 0 ? " disabled" : "") + ">" + ICON.up + "</button>" +
        '<button class="iv-bact" type="button" data-act="down" aria-label="Move block ' + n + ' down" data-tip="Move down"' + (i === draft.blocks.length - 1 ? " disabled" : "") + ">" + ICON.down + "</button>" +
        '<button class="iv-bact" type="button" data-act="dup" aria-label="Duplicate block ' + n + '" data-tip="Duplicate">' + ICON.dup + "</button>" +
        '<button class="iv-bact iv-bact-del" type="button" data-act="del" aria-label="Delete block ' + n + '" data-tip="Delete">' + ICON.del + "</button>" +
        "</div>" +
        '<span class="zl-error iv-berr" hidden></span></li>';
    }).join("");
    if (focusSel) { var f = ol.querySelector(focusSel); if (f && !f.disabled) f.focus(); else if (f) { var alt = f.closest("li").querySelector("[data-act=" + (f.getAttribute("data-act") === "up" ? "down" : "up") + "]"); if (alt) alt.focus(); } }
    renderGroup(); renderTotal();
  }
  function renderGroup() {
    var g = IV.normGroup(draft), on = !!g, n = draft.blocks.length;
    $("iv-g-on").checked = on; $("iv-g-on").disabled = !n;
    $("iv-group-fields").hidden = !on;
    $("iv-group-card").classList.toggle("is-on", on);
    if (!on) return;
    draft.group = g;
    var opts = draft.blocks.map(function (b, i) { return '<option value="' + i + '">Block ' + (i + 1) + "</option>"; }).join("");
    $("iv-g-from").innerHTML = opts; $("iv-g-to").innerHTML = opts;
    $("iv-g-from").value = g.start; $("iv-g-to").value = g.end;
    if (document.activeElement !== $("iv-g-times")) $("iv-g-times").value = g.times;
    $("iv-g-skip").checked = g.skipLastRest;
    var endsRest = draft.blocks[g.end].type === "rest" && g.end > g.start;
    $("iv-g-skip").disabled = !endsRest;
    var nm = function (i) { return draft.blocks[i].name || IV.TYPES[draft.blocks[i].type].label; };
    $("iv-g-hint").textContent = (g.end > g.start ? nm(g.start) + " to " + nm(g.end) : nm(g.start)) + " play " + g.times + (g.times === 1 ? " time" : " times") + "." +
      (endsRest ? (g.skipLastRest ? " The final rest is dropped so you finish on work." : "") : " Skipping the final rest only applies when the group ends with a rest.");
  }
  function renderTotal() {
    var segs = IV.expand(draft), tot = IV.totalSec(draft);
    var work = segs.filter(function (s) { return s.type === "work"; }).reduce(function (a, s) { return a + s.dur; }, 0) / 1000;
    $("iv-b-total").textContent = IV.fmt(tot);
    $("iv-b-sub").textContent = segs.length + (segs.length === 1 ? " interval" : " intervals") + (work ? ", " + IV.fmtLong(work) + " of work" : "");
    $("iv-b-bar").innerHTML = IV.miniBar(draft);
    var isSaved = draft.id && saved.some(function (w) { return w.id === draft.id; });
    $("iv-b-editing").textContent = isSaved ? "Editing saved workout" : "New workout";
    $("iv-b-save").textContent = isSaved ? "Save changes" : "Save workout";
    $("iv-b-saveas").hidden = !isSaved;
    persist();
  }
  function renderAll() { $("iv-b-name").value = draft.name || ""; clearNameErr(); renderBlocks(); }

  /* ---------- saved workouts list (Presets tab) ---------- */
  function renderSaved() {
    var box = $("iv-saved");
    $("iv-saved-count").textContent = saved.length ? saved.length + (saved.length === 1 ? " saved workout" : " saved workouts") + " on this device." : "Workouts you save in the builder appear here.";
    if (!saved.length) {
      box.innerHTML = '<div class="zl-empty iv-saved-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg><h3>No saved workouts</h3><p>Build a circuit with your own blocks and rounds, then save it to run again any time.</p><button class="zl-btn zl-btn-primary" type="button" data-goto="builder">Open the builder</button></div>';
      return;
    }
    box.innerHTML = saved.map(function (w) {
      return '<article class="iv-saved-item" data-id="' + w.id + '">' +
        '<div class="iv-saved-main"><h3>' + ZL.esc(w.name) + '</h3><p class="num">' + ZL.esc(IV.describe(w)) + '</p><div class="iv-mini" aria-hidden="true">' + IV.miniBar(w) + "</div></div>" +
        '<div class="iv-saved-acts">' +
        '<button class="zl-btn zl-btn-primary zl-btn-sm" type="button" data-sact="start" aria-label="Start ' + ZL.esc(w.name) + '">Start</button>' +
        '<button class="zl-btn zl-btn-secondary zl-btn-sm" type="button" data-sact="edit" aria-label="Edit ' + ZL.esc(w.name) + '">Edit</button>' +
        '<button class="zl-iconbtn iv-saved-del" type="button" data-sact="del" aria-label="Delete ' + ZL.esc(w.name) + '" data-tip="Delete">' + ICON.del + "</button>" +
        "</div></article>";
    }).join("");
  }

  /* ---------- errors ---------- */
  function setRowErr(li, msg) {
    var inp = li.querySelector(".iv-bdur"), err = li.querySelector(".iv-berr");
    inp.setAttribute("aria-invalid", msg ? "true" : "false");
    err.hidden = !msg; err.textContent = msg || "";
    if (msg) { err.id = err.id || IV.id("e"); inp.setAttribute("aria-describedby", err.id); } else inp.removeAttribute("aria-describedby");
  }
  function durError(str) {
    var s = IV.parseDur(str);
    if (isNaN(s)) return "Use minutes:seconds, like 0:45 or 2:00.";
    if (s < 1) return "A block needs at least 1 second.";
    if (s > IV.MAX_BLOCK) return "Keep each block under 4 hours.";
    return "";
  }
  function clearNameErr() { $("iv-b-name").setAttribute("aria-invalid", "false"); $("iv-b-name-err").hidden = true; }
  function checkRows() {
    var bad = null;
    Array.prototype.forEach.call($("iv-blocks").children, function (li) {
      var msg = durError(li.querySelector(".iv-bdur").value); setRowErr(li, msg); if (msg && !bad) bad = li.querySelector(".iv-bdur");
    });
    return bad;
  }

  /* ---------- mutations ---------- */
  function idxOf(li) { return Array.prototype.indexOf.call($("iv-blocks").children, li); }
  function shiftGroupForInsert(at) {
    var g = draft.group; if (!g) return;
    if (at <= g.start) { g.start++; g.end++; } else if (at <= g.end + 0) { g.end++; }
  }
  function shiftGroupForDelete(at) {
    var g = draft.group; if (!g) return;
    if (at < g.start) { g.start--; g.end--; } else if (at <= g.end) { g.end--; }
    if (g.end < g.start || !draft.blocks.length) draft.group = null;
  }
  function move(i, j) {
    if (j < 0 || j >= draft.blocks.length || i === j) return;
    var b = draft.blocks.splice(i, 1)[0]; draft.blocks.splice(j, 0, b);
  }
  function add(type) {
    var defaults = { work: 40, rest: 20, prep: 10, cooldown: 60 };
    var b = IV.block(type, IV.TYPES[type].label, defaults[type]);
    draft.blocks.push(b);
    renderBlocks();
    var li = $("iv-blocks").lastElementChild; if (li) { li.classList.add("is-new"); li.querySelector(".iv-bname").focus(); li.querySelector(".iv-bname").select(); }
    ZL.toast(IV.TYPES[type].label + " block added");
  }

  function snapshot() { return IV.clone(draft); }

  function validateForRun() {
    if (!draft.blocks.length) { ZL.toast("Add at least one block first", { type: "bad" }); return false; }
    var bad = checkRows();
    if (bad) { bad.focus(); ZL.toast("Fix the highlighted duration first", { type: "bad" }); return false; }
    return true;
  }

  function save(asNew) {
    var name = $("iv-b-name").value.trim();
    var ok = validateForRun();
    if (!name) {
      $("iv-b-name").setAttribute("aria-invalid", "true");
      $("iv-b-name-err").textContent = "Give your workout a name so you can find it later.";
      $("iv-b-name-err").hidden = false;
      $("iv-b-name").focus();
      return null;
    }
    if (!ok) return null;
    draft.name = name;
    var w = IV.clone(draft);
    var existing = !asNew && draft.id ? saved.findIndex(function (x) { return x.id === draft.id; }) : -1;
    if (existing >= 0) { saved[existing] = w; ZL.toast("Changes to " + name + " saved"); }
    else {
      w.id = IV.id("w"); draft.id = w.id;
      saved.unshift(w); ZL.toast(name + " saved to your workouts", { action: { label: "View", fn: function () { IV.app.go("presets"); } } });
    }
    persistSaved(); renderSaved(); renderTotal();
    IV.app && IV.app.onWorkoutSaved && IV.app.onWorkoutSaved(w);
    return w;
  }

  /* ---------- drag to reorder (pointer events, works with touch) ---------- */
  function initDrag() {
    var ol = $("iv-blocks"), drag = null;
    ol.addEventListener("pointerdown", function (e) {
      var h = e.target.closest(".iv-handle"); if (!h || e.button !== 0) return;
      e.preventDefault();
      var li = h.closest("li");
      drag = { li: li, from: idxOf(li), id: e.pointerId };
      li.classList.add("is-dragging"); ol.classList.add("is-sorting");
      try { h.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    });
    ol.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var y = e.clientY, rows = Array.prototype.filter.call(ol.children, function (x) { return x !== drag.li; });
      var before = null;
      for (var i = 0; i < rows.length; i++) { var r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { before = rows[i]; break; } }
      if (before !== drag.li.nextElementSibling) ol.insertBefore(drag.li, before);
    });
    function end() {
      if (!drag) return;
      var to = idxOf(drag.li), from = drag.from;
      drag.li.classList.remove("is-dragging"); ol.classList.remove("is-sorting");
      drag = null;
      if (to !== from) { move(from, to); renderBlocks(); ZL.toast("Block moved to position " + (to + 1)); }
    }
    ol.addEventListener("pointerup", end);
    ol.addEventListener("pointercancel", end);
    ol.addEventListener("lostpointercapture", end);
  }

  /* ---------- events ---------- */
  function init() {
    var d = ZL.store.get("draft", null);
    draft = valid(d) ? d : defaultDraft();
    var s = ZL.store.get("workouts", []);
    saved = Array.isArray(s) ? s.filter(valid) : [];

    var ol = $("iv-blocks");
    ol.addEventListener("input", function (e) {
      var f = e.target.getAttribute("data-f"); if (!f) return;
      var li = e.target.closest("li"), b = draft.blocks[idxOf(li)]; if (!b) return;
      if (f === "name") { b.name = e.target.value; renderGroup(); renderTotal(); }
      if (f === "sec") {
        var msg = durError(e.target.value);
        if (!msg) { b.sec = IV.parseDur(e.target.value); setRowErr(li, ""); renderTotal(); }
      }
    });
    ol.addEventListener("change", function (e) {
      var f = e.target.getAttribute("data-f"); if (!f) return;
      var li = e.target.closest("li"), b = draft.blocks[idxOf(li)]; if (!b) return;
      if (f === "type") {
        var oldLabel = IV.TYPES[b.type].label;
        b.type = e.target.value; li.setAttribute("data-type", b.type);
        if (!b.name || b.name === oldLabel) { b.name = IV.TYPES[b.type].label; li.querySelector(".iv-bname").value = b.name; }
        li.querySelector(".iv-bname").placeholder = IV.TYPES[b.type].label;
        renderGroup(); renderTotal();
      }
    });
    ol.addEventListener("focusout", function (e) {
      if (e.target.getAttribute("data-f") !== "sec") return;
      var li = e.target.closest("li"); if (!li) return;
      var msg = durError(e.target.value);
      setRowErr(li, msg);
      if (!msg) e.target.value = IV.fmt(IV.parseDur(e.target.value));
    });
    ol.addEventListener("keydown", function (e) {
      if (e.target.getAttribute("data-f") === "sec" && e.key === "Enter") e.target.blur();
    });
    ol.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]"); if (!btn) return;
      var li = btn.closest("li"), i = idxOf(li), act = btn.getAttribute("data-act");
      if (act === "up" || act === "down") {
        var j = act === "up" ? i - 1 : i + 1; move(i, j);
        renderBlocks('li:nth-child(' + (j + 1) + ') [data-act="' + act + '"]');
        ZL.toast("Block moved to position " + (j + 1));
      } else if (act === "dup") {
        var c = IV.clone(draft.blocks[i]); c.id = IV.id("b");
        shiftGroupForInsert(i + 1); draft.blocks.splice(i + 1, 0, c);
        renderBlocks('li:nth-child(' + (i + 2) + ') .iv-bname');
        ZL.toast((c.name || "Block") + " duplicated");
      } else if (act === "del") {
        var snap = snapshot(), name = draft.blocks[i].name || IV.TYPES[draft.blocks[i].type].label;
        draft.blocks.splice(i, 1); shiftGroupForDelete(i);
        renderBlocks();
        var next = $("iv-blocks").children[Math.min(i, draft.blocks.length - 1)];
        if (next) next.querySelector('[data-act="del"]').focus();
        ZL.toast(name + " deleted", { action: { label: "Undo", fn: function () { draft = snap; renderAll(); ZL.toast(name + " restored"); } } });
      }
    });
    initDrag();

    document.querySelector(".iv-add-row").addEventListener("click", function (e) { var b = e.target.closest("[data-add]"); if (b) add(b.getAttribute("data-add")); });
    $("iv-b-name").addEventListener("input", function () { draft.name = this.value; if (this.value.trim()) clearNameErr(); persist(); });

    $("iv-g-on").addEventListener("change", function () {
      if (this.checked) {
        var n = draft.blocks.length, s = Math.max(0, draft.blocks.findIndex(function (b) { return b.type === "work"; }));
        draft.group = { start: s, end: Math.min(n - 1, s + 1), times: 4, skipLastRest: true };
        ZL.toast("Repeat group on");
      } else { draft.group = null; ZL.toast("Repeat group off", { type: "info" }); }
      renderBlocks();
    });
    function setGroup(k, v) { if (!draft.group) return; draft.group[k] = v; if (k === "start" && draft.group.end < v) draft.group.end = v; if (k === "end" && draft.group.start > v) draft.group.start = v; renderBlocks(); }
    $("iv-g-from").addEventListener("change", function () { setGroup("start", +this.value); });
    $("iv-g-to").addEventListener("change", function () { setGroup("end", +this.value); });
    $("iv-g-skip").addEventListener("change", function () { setGroup("skipLastRest", this.checked); });
    function setTimes(v) { v = Math.max(1, Math.min(99, v | 0)); $("iv-g-times").value = v; setGroup("times", v); }
    $("iv-g-minus").addEventListener("click", function () { setTimes((draft.group ? draft.group.times : 1) - 1); });
    $("iv-g-plus").addEventListener("click", function () { setTimes((draft.group ? draft.group.times : 1) + 1); });
    $("iv-g-times").addEventListener("input", function () { var v = parseInt(this.value, 10); if (v >= 1 && v <= 99 && draft.group) { draft.group.times = v; renderGroup(); renderTotal(); var fl = $("iv-blocks").querySelector(".g-first"); if (fl) fl.setAttribute("data-glabel", "Repeat ×" + v); } });
    $("iv-g-times").addEventListener("change", function () { setTimes(parseInt(this.value, 10) || 1); });

    $("iv-b-save").addEventListener("click", function () { save(false); });
    $("iv-b-saveas").addEventListener("click", function () { save(true); });
    $("iv-b-start").addEventListener("click", function () {
      if (!validateForRun()) return;
      var w = IV.clone(draft); w.name = ($("iv-b-name").value.trim() || "Untitled workout");
      IV.app.loadWorkout(w, { start: true, from: "builder" });
    });
    $("iv-b-clear").addEventListener("click", function () {
      var snap = snapshot();
      draft = { id: null, name: "", blocks: [], group: null }; renderAll();
      $("iv-b-name").focus();
      ZL.toast("Builder cleared", { action: { label: "Undo", fn: function () { draft = snap; renderAll(); ZL.toast("Builder restored"); } } });
    });

    $("iv-saved").addEventListener("click", function (e) {
      var b = e.target.closest("[data-sact]"); if (!b) return;
      var id = b.closest("[data-id]").getAttribute("data-id"), i = saved.findIndex(function (w) { return w.id === id; }); if (i < 0) return;
      var w = saved[i], act = b.getAttribute("data-sact");
      if (act === "start") IV.app.loadWorkout(IV.clone(w), { start: true, from: "saved" });
      if (act === "edit") IV.builder.edit(w, true);
      if (act === "del") {
        saved.splice(i, 1); persistSaved(); renderSaved(); renderTotal();
        ZL.toast(w.name + " deleted", { action: { label: "Undo", fn: function () { saved.splice(i, 0, w); persistSaved(); renderSaved(); renderTotal(); ZL.toast(w.name + " restored"); } } });
      }
    });
    $("iv-new-workout").addEventListener("click", function () {
      draft = { id: null, name: "", blocks: [IV.block("work", "Work", 40), IV.block("rest", "Rest", 20)], group: { start: 0, end: 1, times: 4, skipLastRest: true } };
      renderAll(); IV.app.go("builder"); $("iv-b-name").focus();
      ZL.toast("New workout started in the builder", { type: "info" });
    });

    renderAll(); renderSaved();
  }

  IV.builder = {
    init: init,
    // Load a workout into the builder. Saved workouts keep their id so Save updates them; presets become new copies.
    edit: function (w, isSaved) {
      draft = IV.clone(w);
      draft.blocks.forEach(function (b) { b.id = IV.id("b"); });
      if (!isSaved) { draft.id = null; delete draft.rest; delete draft.noLeadIn; }
      renderAll(); IV.app.go("builder");
      ZL.toast(isSaved ? "Editing " + w.name : w.name + " copied to the builder", { type: "info" });
    },
    saved: function () { return saved; },
    draft: function () { return draft; },
    renderSaved: renderSaved
  };
})();
