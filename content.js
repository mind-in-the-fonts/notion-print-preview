// content.js — Notion 프린트 페이지 미리보기 (popup 통신)
// 핵심: 인쇄 너비로 복제 → 측정 → 블록 매핑으로 화면 위치 계산
(function () {
  "use strict";

  if (!/(^|\.)notion\.(so|com|site)$/.test(location.hostname)) return;

  var MM = 96 / 25.4;
  var PRINT_W = Math.round((210 - 20.32) * MM); // A4 - Chrome 기본마진(0.4in*2) ≈ 718px

  var STYLE_ID = "fc-pp-style";
  var LINE_CLS = "fc-pp-line";
  var GUIDE_ID = "fc-pp-guide";
  var OVERLAY_ID = "fc-pp-overlay";
  var STORAGE_KEY = "fc-pp-breaks";

  var active = false;
  var markMode = false;
  var cachedBreaks = null; // 화면 좌표 기준 break 위치 배열
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

  function saveBreaks(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function loadBreaks() {
    try { var v = localStorage.getItem(STORAGE_KEY); return v ? JSON.parse(v) : null; }
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

  // ── 핵심: 인쇄 너비 복제 → 블록 매핑 ──
  function computeBreaksViaClone(pageCount) {
    var pc = document.querySelector(".notion-page-content");
    var scroller = getScroller();
    if (!pc || !scroller || pageCount < 2) return [];

    ensurePositioned(scroller);

    // 1) 인쇄 너비로 콘텐츠 복제
    var container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-9999px;top:0;width:" + PRINT_W + "px;visibility:hidden;overflow:hidden;pointer-events:none";
    var clone = pc.cloneNode(true);
    clone.querySelectorAll("." + LINE_CLS).forEach(function (el) { el.remove(); });
    clone.style.cssText = "width:100%!important;max-width:100%!important;position:relative";
    container.appendChild(clone);
    document.body.appendChild(container);
    void container.offsetHeight; // force layout

    var cloneH = clone.scrollHeight;
    var printPageH = cloneH / pageCount;

    // 2) 복제본에서 블록 요소 수집 (data-block-id 기반, 최상위만)
    // 중첩 블록 제외: 부모도 data-block-id가 있으면 자식은 제외
    function getTopLevelBlocks(root) {
      var all = Array.from(root.querySelectorAll("[data-block-id]"));
      return all.filter(function (el) {
        var parent = el.parentElement;
        while (parent && parent !== root) {
          if (parent.hasAttribute("data-block-id")) return false;
          parent = parent.parentElement;
        }
        return true;
      });
    }

    var cloneBlockEls = getTopLevelBlocks(clone);

    // data-block-id가 없으면 직접 자식 사용
    var useBlockId = cloneBlockEls.length > 0;
    if (!useBlockId) {
      cloneBlockEls = Array.from(clone.children).filter(function (el) {
        return !el.classList.contains(LINE_CLS) && el.offsetHeight > 0;
      });
    }

    // block-id → 원본 요소 맵 (빠른 조회)
    var origBlockMap = {};
    if (useBlockId) {
      getTopLevelBlocks(pc).forEach(function (el) {
        origBlockMap[el.getAttribute("data-block-id")] = el;
      });
    } else {
      var origChildren = Array.from(pc.children).filter(function (el) {
        return !el.classList.contains(LINE_CLS) && el.offsetHeight > 0;
      });
    }

    // 3) 복제본 블록 위치 측정
    var cloneRect = clone.getBoundingClientRect();
    var cloneBlocks = cloneBlockEls.map(function (el, idx) {
      var r = el.getBoundingClientRect();
      return {
        top: r.top - cloneRect.top,
        bottom: r.bottom - cloneRect.top,
        height: r.height,
        blockId: useBlockId ? el.getAttribute("data-block-id") : null,
        idx: idx
      };
    });

    // 4) 각 페이지 break 위치 → 가장 가까운 블록 경계 찾기 → 화면 위치로 매핑
    var scrollerRect = scroller.getBoundingClientRect();
    var scrollTop = scroller.scrollTop;
    var breaks = [];

    for (var p = 1; p < pageCount; p++) {
      var breakY = printPageH * p;

      // breakY를 넘는 첫 번째 블록 찾기 (= 다음 페이지 시작 블록)
      var nextPageBlockIdx = -1;
      for (var j = 0; j < cloneBlocks.length; j++) {
        var cb = cloneBlocks[j];
        if (cb.top >= breakY - 2) {
          // 이 블록은 이미 breakY 이후 → 이 블록부터 다음 페이지
          nextPageBlockIdx = j;
          break;
        }
        if (breakY > cb.top + 2 && breakY < cb.bottom - 2) {
          // break가 블록 내부를 자름
          if (cb.height <= printPageH) {
            // 블록이 한 페이지에 들어감 → 블록을 다음 페이지로 밀기
            nextPageBlockIdx = j;
          } else {
            // 블록이 한 페이지보다 큼 → 자를 수밖에 없음, 다음 블록부터
            nextPageBlockIdx = j + 1;
          }
          break;
        }
      }

      // 화면 좌표로 매핑
      var origEl = null;
      if (nextPageBlockIdx >= 0 && nextPageBlockIdx < cloneBlocks.length) {
        var blk = cloneBlocks[nextPageBlockIdx];
        if (useBlockId && blk.blockId) {
          origEl = origBlockMap[blk.blockId];
        } else if (!useBlockId && nextPageBlockIdx < origChildren.length) {
          origEl = origChildren[nextPageBlockIdx];
        }
      }

      if (origEl) {
        var origRect = origEl.getBoundingClientRect();
        var screenY = Math.round(origRect.top - scrollerRect.top + scrollTop);
        breaks.push(screenY);
      } else {
        // 폴백: 비율 기반
        var ratio = breakY / cloneH;
        var pcRect = pc.getBoundingClientRect();
        var pcTop = pcRect.top - scrollerRect.top + scrollTop;
        var pcH = pcRect.height;
        breaks.push(Math.round(pcTop + pcH * ratio));
      }
    }

    // 정리
    document.body.removeChild(container);

    // 중복/역순 제거
    var filtered = [];
    var prev = 0;
    for (var f = 0; f < breaks.length; f++) {
      if (breaks[f] > prev + 30) {
        filtered.push(breaks[f]);
        prev = breaks[f];
      }
    }

    return filtered;
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
      if (active && cachedBreaks) drawLines();
    }, 400);
  }

  // ── 캘리브레이션 (페이지 수 입력) ──
  function calibrate(pageCount, callback) {
    if (pageCount < 2) {
      if (callback) callback(0);
      return;
    }

    // rAF 대기 후 clone 측정
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        cachedBreaks = computeBreaksViaClone(pageCount);
        saveBreaks(cachedBreaks);
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
    if (!scroller) { exitMarkMode(); return; }

    var scrollerRect = scroller.getBoundingClientRect();
    var clickY = e.clientY - scrollerRect.top + scroller.scrollTop;

    // 간단한 pageH 기반 → drawLines (폴백)
    var pageH = Math.round(clickY);
    if (pageH < 50) pageH = 50;

    // 콘텐츠 높이로 페이지 수 추정
    var pc = document.querySelector(".notion-page-content");
    if (pc) {
      var pcH = pc.offsetTop + pc.offsetHeight;
      var estimatedPages = Math.round(pcH / pageH);
      if (estimatedPages >= 2) {
        cachedBreaks = computeBreaksViaClone(estimatedPages);
      }
    }

    if (!cachedBreaks || cachedBreaks.length === 0) {
      // 폴백: 고정 간격
      cachedBreaks = [];
      var contentH = pc ? pc.offsetTop + pc.offsetHeight : scroller.scrollHeight;
      for (var i = pageH; i < contentH - 50; i += pageH) {
        cachedBreaks.push(i);
      }
    }

    saveBreaks(cachedBreaks);
    active = true;
    var pages = drawLines();
    startObserving();
    exitMarkMode();

    try {
      chrome.runtime.sendMessage({ action: "markDone", totalPages: pages });
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
  cachedBreaks = loadBreaks();
  ensureStyle();
  cleanupLegacy();
  var cleanCount = 0;
  var cleanTimer = setInterval(function () {
    cleanupLegacy();
    if (++cleanCount >= 10) clearInterval(cleanTimer);
  }, 1000);

  var lastUrl = location.href;
  new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(function () {
        cleanupLegacy();
        if (active && cachedBreaks) {
          requestAnimationFrame(drawLines);
        }
      }, 1000);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
