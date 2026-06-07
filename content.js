// content.js — Notion 프린트 페이지 미리보기
// 토글 ON → 자동으로 A4 페이지 구분선 표시
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  // ── A4 용지 계산 ──
  // Chrome 기본 마진: 상하좌우 약 0.4in (10.16mm)
  // A4: 210mm × 297mm
  // 인쇄 콘텐츠 영역 = 용지 - 마진*2
  var MM2PX = 96 / 25.4;
  var PRINT_W = Math.round((210 - 20.32) * MM2PX);  // ≈ 718px
  var PRINT_H = Math.round((297 - 20.32) * MM2PX);  // ≈ 1046px

  var STYLE_ID = "fc-pp-style";
  var LINE_CLS = "fc-pp-line";

  var active = false;
  var cachedBreaks = null;
  var timer = null;
  var rObs = null;
  var mObs = null;

  // ── 이전 버전 잔여물 정리 ──
  function cleanupLegacy() {
    ["fc-pp-toggle", "fc-pp-panel", "fc-pp-guide", "fc-pp-overlay"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
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

  function ensurePositioned(el) {
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
  }

  // ── 페이지 구분선 계산 ──
  // 콘텐츠를 인쇄 너비(718px)로 복제 → A4 한 페이지 높이(1046px)마다 끊기
  function computeBreaks() {
    var pc = document.querySelector(".notion-page-content");
    var scroller = getScroller();
    if (!pc || !scroller) return [];

    ensurePositioned(scroller);
    var scrollerRect = scroller.getBoundingClientRect();
    var scrollTop = scroller.scrollTop;

    // 1) 인쇄 너비로 콘텐츠 복제
    var container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:-99999px;top:0;width:" + PRINT_W + "px;" +
      "visibility:hidden;overflow:visible;pointer-events:none;z-index:-1";

    var clone = pc.cloneNode(true);
    clone.querySelectorAll("." + LINE_CLS).forEach(function (el) { el.remove(); });
    clone.style.cssText =
      "width:" + PRINT_W + "px!important;max-width:none!important;" +
      "min-width:0!important;padding:0!important;margin:0!important;position:relative";

    container.appendChild(clone);
    document.body.appendChild(container);
    void container.offsetHeight; // 강제 레이아웃

    var cloneH = clone.scrollHeight;

    if (cloneH < 100) {
      document.body.removeChild(container);
      return computeBreaksSimple();
    }

    // 2) A4 한 페이지 높이(1046px)마다 끊기
    var pageCount = Math.ceil(cloneH / PRINT_H);
    if (pageCount < 2) {
      document.body.removeChild(container);
      return [];
    }

    // 3) 블록 요소 수집
    var cloneBlocks = Array.from(clone.querySelectorAll("[data-block-id]"));
    var cloneRect = clone.getBoundingClientRect();

    if (cloneBlocks.length === 0) {
      document.body.removeChild(container);
      return computeBreaksSimple();
    }

    var blockInfos = cloneBlocks.map(function (el) {
      var r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-block-id"),
        top: r.top - cloneRect.top,
        bottom: r.bottom - cloneRect.top,
        height: r.height
      };
    });

    // 4) 각 페이지 경계에서 블록 스냅 → 화면 좌표 매핑
    var breaks = [];

    for (var p = 1; p < pageCount; p++) {
      var breakY = PRINT_H * p;
      var bestBlockId = null;

      for (var j = 0; j < blockInfos.length; j++) {
        var bi = blockInfos[j];

        // break가 블록 내부를 자르는 경우
        if (breakY > bi.top + 2 && breakY < bi.bottom - 2) {
          if (bi.height <= PRINT_H * 0.9) {
            bestBlockId = bi.id;
          }
          break;
        }

        // break가 블록 위에 있는 경우 (블록 시작이 break 이후)
        if (bi.top >= breakY) {
          bestBlockId = bi.id;
          break;
        }
      }

      // 화면 좌표로 매핑
      if (bestBlockId) {
        var origEl = pc.querySelector("[data-block-id='" + bestBlockId + "']");
        if (origEl) {
          var origRect = origEl.getBoundingClientRect();
          breaks.push(Math.round(origRect.top - scrollerRect.top + scrollTop));
          continue;
        }
      }

      // 폴백: 비율 매핑
      var ratio = breakY / cloneH;
      var pcRect = pc.getBoundingClientRect();
      breaks.push(Math.round(
        (pcRect.top - scrollerRect.top + scrollTop) + pcRect.height * ratio
      ));
    }

    document.body.removeChild(container);
    return dedup(breaks);
  }

  // 폴백: 균등 분할
  function computeBreaksSimple() {
    var pc = document.querySelector(".notion-page-content");
    var scroller = getScroller();
    if (!pc || !scroller) return [];

    ensurePositioned(scroller);
    var scrollerRect = scroller.getBoundingClientRect();
    var scrollTop = scroller.scrollTop;
    var pcRect = pc.getBoundingClientRect();
    var pcTop = pcRect.top - scrollerRect.top + scrollTop;
    var pageCount = Math.max(Math.ceil(pc.offsetHeight / PRINT_H), 2);
    var pageH = pc.offsetHeight / pageCount;

    var breaks = [];
    for (var p = 1; p < pageCount; p++) {
      breaks.push(Math.round(pcTop + pageH * p));
    }
    return breaks;
  }

  function dedup(breaks) {
    var result = [];
    var prev = -Infinity;
    for (var i = 0; i < breaks.length; i++) {
      if (breaks[i] > prev + 30) {
        result.push(breaks[i]);
        prev = breaks[i];
      }
    }
    return result;
  }

  // ── 라인 그리기 ──
  function clearLines() {
    document.querySelectorAll("." + LINE_CLS).forEach(function (el) { el.remove(); });
  }

  function drawLines() {
    clearLines();
    if (!cachedBreaks || cachedBreaks.length === 0) return 0;

    var scroller = getScroller();
    if (!scroller) return 0;
    ensurePositioned(scroller);

    for (var i = 0; i < cachedBreaks.length; i++) {
      var line = document.createElement("div");
      line.className = LINE_CLS;
      line.style.top = cachedBreaks[i] + "px";

      var label = document.createElement("span");
      label.className = "fc-pp-label";
      label.textContent = (i + 1) + " / " + (i + 2) + " 페이지";
      line.appendChild(label);

      scroller.appendChild(line);
    }

    return cachedBreaks.length + 1;
  }

  function recalcAndDraw() {
    cachedBreaks = computeBreaks();
    return drawLines();
  }

  function scheduleRedraw() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (active) recalcAndDraw();
    }, 500);
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
    ensureStyle();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var pages = recalcAndDraw();
        startObserving();
        if (callback) callback(pages);
      });
    });
  }

  function deactivate() {
    active = false;
    stopObserving();
    clearLines();
  }

  // ── 팝업 메시지 수신 ──
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === "getState") {
      sendResponse({
        active: active,
        totalPages: cachedBreaks ? cachedBreaks.length + 1 : null
      });
    } else if (msg.action === "activate") {
      activate(function (pages) {
        sendResponse({ totalPages: pages || null });
      });
      return true;
    } else if (msg.action === "deactivate") {
      deactivate();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ── 초기화 ──
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
      cachedBreaks = null;
      clearLines();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
