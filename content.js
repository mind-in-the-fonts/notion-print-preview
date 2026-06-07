// content.js — Notion 프린트 페이지 미리보기
// A4 용지 기준 페이지 구분선 표시
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  // ── A4 용지 계산 ──
  // Chrome 기본 마진: 상하좌우 약 0.4in(10.16mm)
  // A4: 210mm × 297mm
  // 인쇄 콘텐츠 영역: (210 - 20.32)mm × (297 - 20.32)mm
  // CSS px = mm × 96/25.4
  var MM2PX = 96 / 25.4;
  var PRINT_CONTENT_W = Math.round((210 - 20.32) * MM2PX); // ≈ 718px
  var PRINT_CONTENT_H = Math.round((297 - 20.32) * MM2PX); // ≈ 1046px (한 페이지 높이)

  var STYLE_ID = "fc-pp-style";
  var LINE_CLS = "fc-pp-line";
  var GUIDE_ID = "fc-pp-guide";
  var OVERLAY_ID = "fc-pp-overlay";
  var STORAGE_KEY = "fc-pp-data";

  var active = false;
  var markMode = false;
  var cachedBreaks = null;
  var cachedPageCount = null;
  var timer = null;
  var rObs = null;
  var mObs = null;

  // ── 이전 버전 잔여물 정리 ──
  function cleanupLegacy() {
    ["fc-pp-toggle", "fc-pp-panel"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function saveData(pageCount, breaks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pageCount: pageCount, breaks: breaks }));
    } catch (e) {}
  }
  function loadData() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }

  // ── CSS ──
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "." + LINE_CLS + "{position:absolute;left:0;right:0;height:0;border-top:2px dashed rgba(231,76,60,.5);pointer-events:none;z-index:9998}",
      ".fc-pp-label{position:absolute;right:20px;transform:translateY(-50%);font-size:11px;font-weight:600;font-family:-apple-system,sans-serif;color:rgba(231,76,60,.75);background:rgba(255,255,255,.92);padding:2px 8px;border-radius:10px;white-space:nowrap;border:1px solid rgba(231,76,60,.2)}",
      "#" + GUIDE_ID + "{position:fixed;left:0;right:0;height:0;border-top:2px solid rgba(231,76,60,.8);pointer-events:none;z-index:100000;display:none}",
      "#" + GUIDE_ID + ".active{display:block}",
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

  function ensurePositioned(el) {
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
  }

  // ── 페이지 구분선 계산 ──
  // 방법: 콘텐츠를 인쇄 너비(718px)로 복제 → 복제본 높이 측정 →
  //        A4 한 페이지 높이(1046px)로 나눠서 페이지 경계 계산 →
  //        블록 경계에 스냅 → 원본 화면 좌표로 매핑
  function computeBreaks(pageCount) {
    var pc = document.querySelector(".notion-page-content");
    var scroller = getScroller();
    if (!pc || !scroller || pageCount < 2) return [];

    ensurePositioned(scroller);
    var scrollerRect = scroller.getBoundingClientRect();
    var scrollTop = scroller.scrollTop;

    // 1) 인쇄 너비로 콘텐츠 복제
    var container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:-99999px;top:0;width:" + PRINT_CONTENT_W + "px;" +
      "visibility:hidden;overflow:visible;pointer-events:none;z-index:-1";
    var clone = pc.cloneNode(true);
    // 기존 구분선 제거
    clone.querySelectorAll("." + LINE_CLS).forEach(function (el) { el.remove(); });
    // Notion의 max-width 제한 해제 → 718px 폭에 맞게 리플로우
    clone.style.cssText =
      "width:" + PRINT_CONTENT_W + "px!important;max-width:none!important;" +
      "min-width:0!important;padding:0!important;margin:0!important;position:relative";
    // 내부 콘텐츠 max-width도 해제
    clone.querySelectorAll("*").forEach(function (el) {
      if (el.style) {
        el.style.maxWidth = "none";
        el.style.minWidth = "0";
      }
    });
    container.appendChild(clone);
    document.body.appendChild(container);

    // 강제 레이아웃
    void container.offsetHeight;

    var cloneH = clone.scrollHeight;

    // 클론이 제대로 렌더링되지 않으면 폴백
    if (cloneH < 100) {
      document.body.removeChild(container);
      return computeBreaksSimple(pageCount);
    }

    // 2) 블록 요소 수집 (data-block-id 사용)
    var cloneBlocks = Array.from(clone.querySelectorAll("[data-block-id]"));
    var cloneRect = clone.getBoundingClientRect();

    // data-block-id가 없으면 폴백
    if (cloneBlocks.length === 0) {
      document.body.removeChild(container);
      return computeBreaksSimple(pageCount);
    }

    // 복제본 블록 위치 측정 + ID 기록
    var blockInfos = cloneBlocks.map(function (el) {
      var r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-block-id"),
        top: r.top - cloneRect.top,
        bottom: r.bottom - cloneRect.top,
        height: r.height
      };
    });

    // 3) 페이지 경계 계산 — A4 한 페이지 콘텐츠 높이(1046px) 기준
    // 사용자가 입력한 pageCount로 검증: cloneH / PRINT_CONTENT_H ≈ pageCount
    // 실제로는 pageCount를 신뢰 (유저가 Cmd+P로 확인한 값이므로)
    var printPageH = cloneH / pageCount;
    var breaks = [];

    for (var p = 1; p < pageCount; p++) {
      var breakY = printPageH * p;

      // breakY 위치에서 가장 가까운 블록 경계 찾기
      var bestBlockId = null;
      var bestSnap = breakY;

      for (var j = 0; j < blockInfos.length; j++) {
        var bi = blockInfos[j];

        // break가 블록 내부를 자르는 경우 → 블록 TOP으로 스냅 (다음 페이지로 밀기)
        if (breakY > bi.top + 2 && breakY < bi.bottom - 2) {
          if (bi.height <= printPageH * 0.9) {
            bestBlockId = bi.id;
            bestSnap = bi.top;
          }
          break;
        }

        // break가 블록 사이에 있는 경우
        if (bi.top >= breakY) {
          bestBlockId = bi.id;
          bestSnap = bi.top;
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

      // 폴백: 비율로 매핑
      var ratio = bestSnap / cloneH;
      var pcRect = pc.getBoundingClientRect();
      breaks.push(Math.round(
        (pcRect.top - scrollerRect.top + scrollTop) + pcRect.height * ratio
      ));
    }

    document.body.removeChild(container);

    // 중복/너무 가까운 라인 제거
    return dedup(breaks);
  }

  // 단순 폴백: 콘텐츠 높이 ÷ 페이지 수
  function computeBreaksSimple(pageCount) {
    var pc = document.querySelector(".notion-page-content");
    var scroller = getScroller();
    if (!pc || !scroller || pageCount < 2) return [];

    ensurePositioned(scroller);
    var scrollerRect = scroller.getBoundingClientRect();
    var scrollTop = scroller.scrollTop;
    var pcRect = pc.getBoundingClientRect();
    var pcTop = pcRect.top - scrollerRect.top + scrollTop;
    var contentH = pc.offsetHeight;
    var pageH = contentH / pageCount;

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

  function scheduleRedraw() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (active && cachedPageCount) {
        cachedBreaks = computeBreaks(cachedPageCount);
        drawLines();
      }
    }, 500);
  }

  // ── 캘리브레이션 ──
  function calibrate(pageCount, callback) {
    if (pageCount < 2) {
      if (callback) callback(0);
      return;
    }

    active = true;
    cachedPageCount = pageCount;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        cachedBreaks = computeBreaks(pageCount);
        saveData(pageCount, cachedBreaks);
        var pages = drawLines();
        startObserving();
        if (callback) callback(pages);
      });
    });
  }

  // ── 마크 모드 ──
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
    var pc = document.querySelector(".notion-page-content");
    if (!scroller || !pc) { exitMarkMode(); return; }

    var scrollerRect = scroller.getBoundingClientRect();
    var clickY = e.clientY - scrollerRect.top + scroller.scrollTop;
    var pageH = Math.max(clickY, 50);
    var contentH = pc.offsetHeight;
    var estimatedPages = Math.max(Math.round(contentH / pageH), 2);

    calibrate(estimatedPages, function (pages) {
      try {
        chrome.runtime.sendMessage({ action: "markDone", totalPages: pages });
      } catch (ex) {}
    });

    exitMarkMode();
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
    ensureStyle();
    requestAnimationFrame(function () {
      var pages = 0;
      if (cachedBreaks && cachedBreaks.length > 0) {
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
    } else if (msg.action === "enterMarkMode") {
      enterMarkMode();
      sendResponse({ ok: true });
    } else if (msg.action === "calibrate") {
      calibrate(msg.pageCount, function (totalPages) {
        sendResponse({ totalPages: totalPages });
      });
      return true;
    }
    return true;
  });

  // ── 초기화 ──
  ensureStyle();
  cleanupLegacy();

  // 이전 데이터 복원
  var saved = loadData();
  if (saved) {
    cachedPageCount = saved.pageCount;
    cachedBreaks = saved.breaks;
  }

  // 레거시 정리 (이전 버전 떠있는 UI 제거)
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
      cachedPageCount = null;
      clearLines();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
