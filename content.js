// content.js — Notion 프린트 페이지 미리보기 (popup 통신)
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  var MM = 96 / 25.4;
  var PRINT_W = Math.round((210 - 25.4) * MM); // A4 인쇄 콘텐츠 너비 ~698px

  var STYLE_ID = "fc-pp-style";
  var CONSTRAIN_CLS = "fc-pp-constrained";
  var LINE_CLS = "fc-pp-line";
  var STORAGE_KEY = "fc-pp-calibrated-pageH";

  var active = false;
  var calibratedPageH = null;
  var timer = null;
  var rObs = null;
  var mObs = null;

  // ── 이전 버전 잔여물 정리 ──
  function cleanupLegacy() {
    var old = document.getElementById("fc-pp-toggle");
    if (old) old.remove();
    old = document.getElementById("fc-pp-panel");
    if (old) old.remove();
  }

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
      // 너비 제한 — 인쇄 너비에 맞추기
      "." + CONSTRAIN_CLS + " .notion-page-content{max-width:" + PRINT_W + "px!important;width:" + PRINT_W + "px!important}",
      "." + CONSTRAIN_CLS + " .notion-page-content>div{max-width:100%!important}",
      // 라인
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

  // ── 콘텐츠 높이 측정 (Notion 하단 패딩 제외) ──
  function getContentHeight() {
    var scroller = getScroller();
    if (!scroller) return 0;

    // scroller 기준 position 확보
    if (getComputedStyle(scroller).position === "static") {
      scroller.style.position = "relative";
    }

    var pc = document.querySelector(".notion-page-content");
    if (pc) {
      // .notion-page-content 의 실제 끝까지만 측정
      // (scroller 의 하단 패딩 = 스크롤 여유 공간 제외)
      return pc.offsetTop + pc.offsetHeight;
    }
    return scroller.scrollHeight;
  }

  // ── 너비 제한 ──
  function constrainWidth() {
    var scroller = getScroller();
    if (scroller) scroller.classList.add(CONSTRAIN_CLS);
  }

  function restoreWidth() {
    var scroller = getScroller();
    if (scroller) scroller.classList.remove(CONSTRAIN_CLS);
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

    var contentH = getContentHeight();
    var pages = Math.round(contentH / calibratedPageH);

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
  function calibrate(actualPageCount, callback) {
    var scroller = getScroller();
    if (!scroller || actualPageCount < 1) {
      if (callback) callback(0);
      return;
    }
    // 너비 제한 적용 + 리플로우 대기
    constrainWidth();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var contentH = getContentHeight();
        calibratedPageH = Math.round(contentH / actualPageCount);
        savePageH(calibratedPageH);
        var pages = drawLines();
        startObserving();
        if (callback) callback(pages);
      });
    });
  }

  // ── 옵저버 ──
  function startObserving() {
    stopObserving();
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
  function activate(callback) {
    active = true;
    constrainWidth();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var pages = 0;
        if (calibratedPageH) {
          pages = drawLines();
          startObserving();
        }
        if (callback) callback(pages);
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
        pageH: calibratedPageH,
        totalPages: calibratedPageH ? Math.round(getContentHeight() / calibratedPageH) : null
      });
    } else if (msg.action === "activate") {
      activate(function (pages) {
        sendResponse({ totalPages: pages || null, pageH: calibratedPageH });
      });
      return true;
    } else if (msg.action === "deactivate") {
      deactivate();
      sendResponse({ ok: true });
    } else if (msg.action === "calibrate") {
      calibrate(msg.pageCount, function (totalPages) {
        sendResponse({ totalPages: totalPages, pageH: calibratedPageH });
      });
      return true;
    } else if (msg.action === "adjustPageH") {
      if (calibratedPageH) {
        calibratedPageH = Math.max(50, calibratedPageH + msg.delta);
        savePageH(calibratedPageH);
        var pages = drawLines();
        sendResponse({ totalPages: pages, pageH: calibratedPageH });
      }
    }
    return true;
  });

  // ── 초기화 ──
  calibratedPageH = loadPageH();
  ensureStyle();
  cleanupLegacy();
  // 이전 스크립트가 재생성할 수 있으므로 반복 정리 (10회)
  var cleanCount = 0;
  var cleanTimer = setInterval(function () {
    cleanupLegacy();
    if (++cleanCount >= 10) clearInterval(cleanTimer);
  }, 1000);

  // SPA 네비게이션 감지
  var lastUrl = location.href;
  new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(function () {
        cleanupLegacy();
        if (active) {
          constrainWidth();
          if (calibratedPageH) {
            requestAnimationFrame(function () {
              requestAnimationFrame(drawLines);
            });
          }
        }
      }, 1000);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
