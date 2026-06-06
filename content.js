// content.js — Notion 프린트 페이지 미리보기 (popup 통신)
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  var STYLE_ID = "fc-pp-style";
  var LINE_CLS = "fc-pp-line";
  var GUIDE_ID = "fc-pp-guide";
  var OVERLAY_ID = "fc-pp-overlay";
  var STORAGE_KEY = "fc-pp-calibrated-pageH";

  var active = false;
  var markMode = false;
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
      "." + LINE_CLS + "{position:absolute;left:0;right:0;height:0;border-top:2px dashed rgba(231,76,60,.5);pointer-events:none;z-index:9998}",
      ".fc-pp-label{position:absolute;right:20px;transform:translateY(-50%);font-size:11px;font-weight:600;font-family:-apple-system,sans-serif;color:rgba(231,76,60,.75);background:rgba(255,255,255,.92);padding:2px 8px;border-radius:10px;white-space:nowrap;border:1px solid rgba(231,76,60,.2)}",
      // 마크 모드 가이드 라인
      "#" + GUIDE_ID + "{position:fixed;left:0;right:0;height:0;border-top:2px solid rgba(231,76,60,.8);pointer-events:none;z-index:100000;display:none}",
      "#" + GUIDE_ID + ".active{display:block}",
      // 마크 모드 오버레이
      "#" + OVERLAY_ID + "{position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:crosshair;display:none}",
      "#" + OVERLAY_ID + ".active{display:block}",
      "#" + OVERLAY_ID + " .fc-pp-msg{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#e74c3c;color:#fff;padding:10px 20px;border-radius:10px;font-family:-apple-system,sans-serif;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.25);white-space:nowrap}",
      "#" + OVERLAY_ID + " .fc-pp-sub{position:fixed;top:56px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;padding:6px 14px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:12px;white-space:nowrap}",
      "@media print{." + LINE_CLS + ",#" + GUIDE_ID + ",#" + OVERLAY_ID + "{display:none!important}}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  // ── DOM ──
  function getScroller() {
    var pc = document.querySelector(".notion-page-content");
    return (pc && pc.closest(".notion-scroller")) || document.querySelector(".notion-scroller");
  }

  function getContentHeight() {
    var scroller = getScroller();
    if (!scroller) return 0;
    if (getComputedStyle(scroller).position === "static") {
      scroller.style.position = "relative";
    }
    var pc = document.querySelector(".notion-page-content");
    if (pc) return pc.offsetTop + pc.offsetHeight;
    return scroller.scrollHeight;
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

  // ── 마크 모드: 클릭으로 1페이지 끝 지정 ──
  var guideEl = null;
  var overlayEl = null;

  function createMarkUI() {
    if (!guideEl) {
      guideEl = document.createElement("div");
      guideEl.id = GUIDE_ID;
      document.body.appendChild(guideEl);
    }
    if (!overlayEl) {
      overlayEl = document.createElement("div");
      overlayEl.id = OVERLAY_ID;
      var msg = document.createElement("div");
      msg.className = "fc-pp-msg";
      msg.textContent = "Cmd+P 1페이지의 마지막 내용을 클릭하세요";
      overlayEl.appendChild(msg);
      var sub = document.createElement("div");
      sub.className = "fc-pp-sub";
      sub.textContent = "ESC 로 취소";
      overlayEl.appendChild(sub);
      document.body.appendChild(overlayEl);
    }
  }

  function enterMarkMode() {
    markMode = true;
    createMarkUI();
    guideEl.classList.add("active");
    overlayEl.classList.add("active");
    overlayEl.addEventListener("mousemove", onMarkMouseMove);
    overlayEl.addEventListener("click", onMarkClick);
    document.addEventListener("keydown", onMarkKeydown);
  }

  function exitMarkMode() {
    markMode = false;
    if (guideEl) guideEl.classList.remove("active");
    if (overlayEl) {
      overlayEl.classList.remove("active");
      overlayEl.removeEventListener("mousemove", onMarkMouseMove);
      overlayEl.removeEventListener("click", onMarkClick);
    }
    document.removeEventListener("keydown", onMarkKeydown);
  }

  function onMarkMouseMove(e) {
    if (guideEl) guideEl.style.top = e.clientY + "px";
  }

  function onMarkClick(e) {
    var scroller = getScroller();
    if (!scroller) { exitMarkMode(); return; }

    // 클릭 위치 → scroller 내 절대 위치
    var scrollerRect = scroller.getBoundingClientRect();
    var clickY = e.clientY - scrollerRect.top + scroller.scrollTop;

    calibratedPageH = Math.round(clickY);
    if (calibratedPageH < 50) calibratedPageH = 50;
    savePageH(calibratedPageH);

    active = true;
    var pages = drawLines();
    startObserving();
    exitMarkMode();

    // 팝업에 결과 전달 (팝업이 열려있으면)
    try {
      chrome.runtime.sendMessage({
        action: "markDone",
        pageH: calibratedPageH,
        totalPages: pages
      });
    } catch (e) {}
  }

  function onMarkKeydown(e) {
    if (e.key === "Escape") exitMarkMode();
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
            return n.nodeType === 1 && (n.classList.contains(LINE_CLS) || n.id === GUIDE_ID || n.id === OVERLAY_ID);
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
    requestAnimationFrame(function () {
      var pages = 0;
      if (calibratedPageH) {
        pages = drawLines();
        startObserving();
      }
      if (callback) callback(pages);
    });
  }

  function deactivate() {
    active = false;
    stopObserving();
    clearLines();
    if (markMode) exitMarkMode();
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
    } else if (msg.action === "enterMarkMode") {
      enterMarkMode();
      sendResponse({ ok: true });
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
        if (active && calibratedPageH) {
          requestAnimationFrame(drawLines);
        }
      }, 1000);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
