// content.js — Notion 프린트 페이지 미리보기
// Chrome 인쇄와 동일한 블록 단위 페이지 나눔 시뮬레이션
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  // ── A4 인쇄 설정 ──
  // Notion CSS: @page { margin: 20mm 0px } → 이 값이 Chrome 인쇄에 적용됨
  // A4: 210mm × 297mm, 96 DPI 기준 CSS px 변환
  var MM2PX = 96 / 25.4;
  var A4_W = Math.round(210 * MM2PX);  // 794px
  var A4_H = Math.round(297 * MM2PX);  // 1123px

  // @page CSS에서 마진 감지
  function getPageMargins() {
    var margins = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var sheet = document.styleSheets[i];
        try {
          for (var j = 0; j < sheet.cssRules.length; j++) {
            var rule = sheet.cssRules[j];
            if (rule.type === CSSRule.PAGE_RULE && rule.style) {
              var mt = rule.style.marginTop || rule.style.getPropertyValue("margin-top");
              var mr = rule.style.marginRight || rule.style.getPropertyValue("margin-right");
              var mb = rule.style.marginBottom || rule.style.getPropertyValue("margin-bottom");
              var ml = rule.style.marginLeft || rule.style.getPropertyValue("margin-left");
              if (mt) margins.top = parseMarginValue(mt);
              if (mr) margins.right = parseMarginValue(mr);
              if (mb) margins.bottom = parseMarginValue(mb);
              if (ml) margins.left = parseMarginValue(ml);
            }
          }
        } catch (e) { /* cross-origin */ }
      }
    } catch (e) {}
    return margins;
  }

  function parseMarginValue(val) {
    if (!val || val === "0" || val === "0px") return 0;
    var n = parseFloat(val);
    if (isNaN(n)) return 0;
    if (val.indexOf("mm") > -1) return Math.round(n * MM2PX);
    if (val.indexOf("in") > -1) return Math.round(n * 96);
    if (val.indexOf("cm") > -1) return Math.round(n * MM2PX * 10);
    if (val.indexOf("pt") > -1) return Math.round(n * 96 / 72);
    return Math.round(n); // px
  }

  function getPrintDimensions() {
    var m = getPageMargins();
    return {
      w: A4_W - m.left - m.right,
      h: A4_H - m.top - m.bottom
    };
  }

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
  function computeBreaks() {
    var pc = document.querySelector(".notion-page-content");
    var scroller = getScroller();
    if (!pc || !scroller) return [];

    ensurePositioned(scroller);

    // @page CSS에서 인쇄 영역 크기 계산
    var dims = getPrintDimensions();
    var PRINT_W = dims.w;
    var PRINT_H = dims.h;

    // notion-frame을 클론하여 원본 부모에 삽입 (CSS 컨텍스트 완전 보존)
    var frame = scroller.closest(".notion-frame") || scroller.parentElement;

    var frameClone = frame.cloneNode(true);
    frameClone.style.cssText =
      "position:fixed;left:-99999px;top:0;width:" + PRINT_W + "px;max-width:" + PRINT_W + "px;" +
      "visibility:hidden;overflow:visible;pointer-events:none;z-index:-1;height:auto;";

    var scrollerClone = frameClone.querySelector(".notion-scroller");
    if (scrollerClone) {
      scrollerClone.style.width = PRINT_W + "px";
      scrollerClone.style.maxWidth = PRINT_W + "px";
      scrollerClone.style.overflow = "visible";
      scrollerClone.style.height = "auto";
    }

    // 기존 페이지 구분선 제거
    frameClone.querySelectorAll("." + LINE_CLS).forEach(function (el) { el.remove(); });

    // 원본 부모에 삽입하여 CSS 셀렉터 컨텍스트 보존
    frame.parentElement.appendChild(frameClone);
    void frameClone.offsetHeight; // 강제 레이아웃

    var clonePC = frameClone.querySelector(".notion-page-content");
    if (!clonePC) {
      frame.parentElement.removeChild(frameClone);
      return [];
    }

    var cloneChildren = Array.from(clonePC.children).filter(function (el) {
      return !el.classList.contains(LINE_CLS);
    });
    var origChildren = Array.from(pc.children).filter(function (el) {
      return !el.classList.contains(LINE_CLS);
    });

    if (cloneChildren.length === 0) {
      frame.parentElement.removeChild(frameClone);
      return [];
    }

    // 프레임 기준 블록 위치 측정 (Chrome 인쇄 엔진과 동일)
    var cloneFrameRect = frameClone.getBoundingClientRect();
    var blocks = cloneChildren.map(function (el) {
      var r = el.getBoundingClientRect();
      return {
        top: r.top - cloneFrameRect.top,
        bottom: r.top - cloneFrameRect.top + r.height,
        height: r.height
      };
    });

    // Chrome 인쇄 페이지 나눔 시뮬레이션
    // 블록이 페이지 경계에 걸리면: 한 페이지에 들어가는 블록은 다음 페이지로 이동
    var breakIndices = [];
    var pageEnd = PRINT_H;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.height <= 0) continue;
      if (b.top < pageEnd && b.bottom > pageEnd) {
        if (b.height <= PRINT_H) {
          // 블록이 한 페이지에 들어감 → 다음 페이지로 통째로 이동
          breakIndices.push(i);
          pageEnd = b.top + PRINT_H;
        } else {
          // 블록이 한 페이지보다 큼 → 잘라서 넘김
          breakIndices.push(i);
          var ns = pageEnd;
          pageEnd = ns + PRINT_H;
          while (b.bottom > pageEnd) {
            pageEnd += PRINT_H;
          }
        }
      }
    }

    // 원본 DOM의 화면 좌표로 매핑
    var scrollerRect = scroller.getBoundingClientRect();
    var scrollTop = scroller.scrollTop;

    var breaks = [];
    for (var i = 0; i < breakIndices.length; i++) {
      var idx = breakIndices[i];
      if (idx < origChildren.length) {
        var rect = origChildren[idx].getBoundingClientRect();
        breaks.push(Math.round(rect.top - scrollerRect.top + scrollTop));
      }
    }

    // 정리
    frame.parentElement.removeChild(frameClone);
    return breaks;
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
