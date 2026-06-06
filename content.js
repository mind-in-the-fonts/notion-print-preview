// content.js — Notion 프린트 페이지 미리보기 (popup 통신)
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  var MM = 96 / 25.4;
  var PRINT_W = Math.round((210 - 25.4) * MM); // A4 인쇄 콘텐츠 너비 ~698px

  var STYLE_ID = "fc-pp-style";
  var LINE_CLS = "fc-pp-line";
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
      "." + LINE_CLS + "{position:absolute;left:0;right:0;height:0;border-top:2px dashed rgba(231,76,60,.5);pointer-events:none;z-index:9998}",
      ".fc-pp-label{position:absolute;right:20px;transform:translateY(-50%);font-size:11px;font-weight:600;font-family:-apple-system,sans-serif;color:rgba(231,76,60,.75);background:rgba(255,255,255,.92);padding:2px 8px;border-radius:10px;white-space:nowrap;border:1px solid rgba(231,76,60,.2)}",
      "@media print{." + LINE_CLS + "{display:none!important}}",
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
    if (!calibratedPageH) return 0;

    var scroller = getScroller();
    if (!scroller) return 0;

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

    return pages;
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
    if (!scroller || actualPageCount < 1) return 0;
    calibratedPageH = Math.round(scroller.scrollHeight / actualPageCount);
    savePageH(calibratedPageH);
    return drawLines();
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
            return n.nodeType === 1 && n.classList.contains(LINE_CLS);
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

  // ── 활성화/비활성화 ──
  function activate() {
    active = true;
    constrainWidth();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var pages = 0;
        if (calibratedPageH) {
          pages = drawLines();
          startObserving();
        }
        return pages;
      });
    });
  }

  function deactivate() {
    active = false;
    stopObserving();
    clearLines();
    restoreWidth();
  }

  // ── 팝업 메시지 수신 ──
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === "getState") {
      sendResponse({
        active: active,
        pageCount: calibratedPageH ? null : null,
        totalPages: calibratedPageH ? Math.round((getScroller() || { scrollHeight: 0 }).scrollHeight / calibratedPageH) : null
      });
    } else if (msg.action === "activate") {
      activate();
      var pages = calibratedPageH ? Math.round((getScroller() || { scrollHeight: 0 }).scrollHeight / calibratedPageH) : null;
      sendResponse({ totalPages: pages });
    } else if (msg.action === "deactivate") {
      deactivate();
      sendResponse({ ok: true });
    } else if (msg.action === "calibrate") {
      var totalPages = calibrate(msg.pageCount);
      sendResponse({ totalPages: totalPages });
    }
    return true;
  });

  // ── 초기화 ──
  calibratedPageH = loadPageH();
  ensureStyle();

  // SPA 네비게이션 감지
  var lastUrl = location.href;
  new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(function () {
        if (active) {
          constrainWidth();
          if (calibratedPageH) requestAnimationFrame(drawLines);
        }
      }, 1000);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
