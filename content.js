// print-preview.js — Notion 프린트 페이지 미리보기
// 미리보기 ON → 콘텐츠를 인쇄 너비로 축소 → 페이지 수 입력 → 정확한 구분선
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  var MM = 96 / 25.4;
  var PRINT_W = Math.round((210 - 25.4) * MM); // A4 인쇄 콘텐츠 너비 ~698px

  var STYLE_ID = "fc-pp-style";
  var LINE_CLS = "fc-pp-line";
  var TOGGLE_ID = "fc-pp-toggle";
  var PANEL_ID = "fc-pp-panel";
  var STORAGE_KEY = "fc-pp-calibrated-pageH";

  var active = false;
  var calibratedPageH = null;
  var savedMaxWidth;
  var timer = null;
  var rObs = null;
  var mObs = null;

  function savePageH(v) {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch (e) {}
  }
  function loadPageH() {
    try { var v = localStorage.getItem(STORAGE_KEY); return v ? Number(v) : null; }
    catch (e) { return null; }
  }

  // ── CSS ──
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#" + TOGGLE_ID + "{",
      "  position:fixed;bottom:24px;left:24px;z-index:99999;",
      "  width:44px;height:44px;border-radius:50%;",
      "  border:2px solid #e0e0e0;background:#fff;",
      "  cursor:pointer;font-size:20px;line-height:1;",
      "  display:flex;align-items:center;justify-content:center;",
      "  box-shadow:0 2px 10px rgba(0,0,0,.12);",
      "  transition:all .2s;font-family:-apple-system,sans-serif;",
      "}",
      "#" + TOGGLE_ID + ":hover{transform:scale(1.08);box-shadow:0 4px 16px rgba(0,0,0,.2)}",
      "#" + TOGGLE_ID + ".active{border-color:#e74c3c;background:#fdf0ef;box-shadow:0 2px 10px rgba(231,76,60,.25)}",
      "#" + PANEL_ID + "{",
      "  display:none;position:fixed;bottom:76px;left:24px;z-index:99999;",
      "  background:#fff;border:1px solid #e0e0e0;border-radius:12px;",
      "  padding:14px 16px;box-shadow:0 4px 20px rgba(0,0,0,.15);",
      "  font-family:-apple-system,sans-serif;font-size:13px;color:#333;",
      "  min-width:240px;",
      "}",
      "#" + PANEL_ID + ".open{display:block}",
      ".fc-pp-row{display:flex;align-items:center;gap:8px;margin-top:8px}",
      ".fc-pp-input{width:60px;padding:5px 8px;font-size:13px;text-align:center;border:1px solid #ddd;border-radius:6px;outline:none;font-family:inherit}",
      ".fc-pp-input:focus{border-color:#e74c3c;box-shadow:0 0 0 2px rgba(231,76,60,.15)}",
      ".fc-pp-btn{padding:5px 12px;font-size:12px;font-weight:600;border:none;border-radius:6px;cursor:pointer;background:#e74c3c;color:#fff;transition:background .15s}",
      ".fc-pp-btn:hover{background:#c0392b}",
      ".fc-pp-hint{font-size:11px;color:#999;margin-top:6px;line-height:1.4}",
      ".fc-pp-status{font-size:12px;color:#e74c3c;font-weight:600;margin-top:6px}",
      "." + LINE_CLS + "{position:absolute;left:0;right:0;height:0;border-top:2px dashed rgba(231,76,60,.5);pointer-events:none;z-index:9998}",
      ".fc-pp-label{position:absolute;right:20px;transform:translateY(-50%);font-size:11px;font-weight:600;font-family:-apple-system,sans-serif;color:rgba(231,76,60,.75);background:rgba(255,255,255,.92);padding:2px 8px;border-radius:10px;white-space:nowrap;border:1px solid rgba(231,76,60,.2)}",
      "@media print{#" + TOGGLE_ID + ",." + LINE_CLS + ",#" + PANEL_ID + "{display:none!important}}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  // ── DOM ──
  function getScroller() {
    var pc = document.querySelector(".notion-page-content");
    return (pc && pc.closest(".notion-scroller")) || document.querySelector(".notion-scroller");
  }

  // ── 너비 제한: 인쇄 너비에 맞추기 ──
  function constrainWidth() {
    var pc = document.querySelector(".notion-page-content");
    if (!pc) return;
    savedMaxWidth = pc.style.maxWidth;
    pc.style.setProperty("max-width", PRINT_W + "px", "important");
  }

  function restoreWidth() {
    var pc = document.querySelector(".notion-page-content");
    if (!pc) return;
    if (savedMaxWidth !== undefined) {
      pc.style.maxWidth = savedMaxWidth;
    } else {
      pc.style.removeProperty("max-width");
    }
    savedMaxWidth = undefined;
  }

  // ── 라인 ──
  function clearLines() {
    document.querySelectorAll("." + LINE_CLS).forEach(function (el) { el.remove(); });
  }

  function drawLines() {
    clearLines();
    if (!calibratedPageH) return;

    var scroller = getScroller();
    if (!scroller) return;

    if (getComputedStyle(scroller).position === "static") {
      scroller.style.position = "relative";
    }

    var total = scroller.scrollHeight;
    var pages = Math.round(total / calibratedPageH);

    for (var i = 1; i < pages; i++) {
      var line = document.createElement("div");
      line.className = LINE_CLS;
      line.style.top = (i * calibratedPageH) + "px";

      var label = document.createElement("span");
      label.className = "fc-pp-label";
      label.textContent = i + " / " + (i + 1) + " 페이지";
      line.appendChild(label);

      scroller.appendChild(line);
    }

    updateStatus(pages);
  }

  function scheduleRedraw() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (active && calibratedPageH) drawLines();
    }, 400);
  }

  // ── 캘리브레이션 ──
  function calibrate(actualPageCount) {
    var scroller = getScroller();
    if (!scroller || actualPageCount < 1) return;
    // 너비가 인쇄 너비로 제한된 상태에서 측정 → 인쇄 레이아웃과 동일
    calibratedPageH = Math.round(scroller.scrollHeight / actualPageCount);
    savePageH(calibratedPageH);
    drawLines();
  }

  // ── UI ──
  function updateStatus(pageCount) {
    var el = document.querySelector(".fc-pp-status");
    if (el) el.textContent = "미리보기: 총 " + pageCount + "페이지";
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    var panel = document.createElement("div");
    panel.id = PANEL_ID;

    var title = document.createElement("div");
    title.style.cssText = "font-weight:700;font-size:14px;margin-bottom:2px";
    title.textContent = "프린트 미리보기";
    panel.appendChild(title);

    var hint = document.createElement("div");
    hint.className = "fc-pp-hint";
    hint.textContent = "1. Cmd+P \uB85C \uD398\uC774\uC9C0 \uC218 \uD655\uC778";
    panel.appendChild(hint);

    var hint2 = document.createElement("div");
    hint2.className = "fc-pp-hint";
    hint2.textContent = "2. \uC544\uB798\uC5D0 \uC785\uB825 \uD6C4 \uC801\uC6A9";
    panel.appendChild(hint2);

    var row = document.createElement("div");
    row.className = "fc-pp-row";

    var input = document.createElement("input");
    input.type = "number";
    input.className = "fc-pp-input";
    input.min = "1";
    input.placeholder = "31";
    row.appendChild(input);

    var label = document.createElement("span");
    label.textContent = "페이지";
    label.style.cssText = "font-size:13px;color:#666";
    row.appendChild(label);

    var btn = document.createElement("button");
    btn.className = "fc-pp-btn";
    btn.textContent = "적용";
    btn.addEventListener("click", function () {
      var v = parseInt(input.value, 10);
      if (v > 0) calibrate(v);
    });
    row.appendChild(btn);
    panel.appendChild(row);

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var v = parseInt(input.value, 10);
        if (v > 0) calibrate(v);
      }
    });

    var status = document.createElement("div");
    status.className = "fc-pp-status";
    if (calibratedPageH) status.textContent = "이전 설정 적용됨";
    panel.appendChild(status);

    document.body.appendChild(panel);
  }

  // ── 옵저버 ──
  function startObserving() {
    var scroller = getScroller();
    if (!scroller) return;
    rObs = new ResizeObserver(scheduleRedraw);
    rObs.observe(scroller);
    mObs = new MutationObserver(function (muts) {
      var dominated = muts.every(function (m) {
        return Array.from(m.addedNodes).concat(Array.from(m.removedNodes))
          .every(function (n) {
            return n.nodeType === 1 && (n.classList.contains(LINE_CLS) || n.id === TOGGLE_ID || n.id === PANEL_ID);
          });
      });
      if (!dominated) scheduleRedraw();
    });
    mObs.observe(scroller, { childList: true, subtree: true, characterData: true });
  }

  function stopObserving() {
    if (rObs) { rObs.disconnect(); rObs = null; }
    if (mObs) { mObs.disconnect(); mObs = null; }
  }

  // ── 토글 ──
  function activate() {
    active = true;
    constrainWidth();
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.add("open");

    // 너비 변경 후 리플로우 대기
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (calibratedPageH) {
          drawLines();
          startObserving();
        }
      });
    });
  }

  function deactivate() {
    active = false;
    stopObserving();
    clearLines();
    restoreWidth();
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.remove("open");
  }

  function toggle() {
    active ? deactivate() : activate();
    var btn = document.getElementById(TOGGLE_ID);
    if (btn) btn.classList.toggle("active", active);
  }

  function createToggle() {
    if (document.getElementById(TOGGLE_ID)) return;
    var btn = document.createElement("button");
    btn.id = TOGGLE_ID;
    btn.title = "프린트 페이지 미리보기 (on/off)";
    btn.textContent = "\uD83D\uDCC4";
    btn.addEventListener("click", toggle);
    document.body.appendChild(btn);
  }

  // ── 초기화 ──
  function init() {
    calibratedPageH = loadPageH();
    ensureStyle();
    createToggle();
    createPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  var lastUrl = location.href;
  new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(function () {
        if (!document.getElementById(TOGGLE_ID)) createToggle();
        if (!document.getElementById(PANEL_ID)) createPanel();
        if (active) {
          constrainWidth();
          if (calibratedPageH) requestAnimationFrame(drawLines);
        }
      }, 1000);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
