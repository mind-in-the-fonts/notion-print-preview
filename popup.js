// popup.js — 팝업 UI ↔ content script 통신
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function isNotion(url) {
    try { return /\bnotion\.(so|com|site)$/.test(new URL(url).hostname); }
    catch (e) { return false; }
  }

  function sendToTab(tabId, msg, cb) {
    chrome.tabs.sendMessage(tabId, msg, function (resp) {
      if (chrome.runtime.lastError) { /* ignore */ }
      if (cb) cb(resp);
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    if (!tab || !isNotion(tab.url)) {
      $("unsupported").style.display = "";
      return;
    }

    var tabId = tab.id;
    $("supported").style.display = "";

    // 현재 상태 가져오기
    sendToTab(tabId, { action: "getState" }, function (state) {
      if (!state) return;
      $("toggle").checked = state.active;
      if (state.totalPages) {
        showResult(state.totalPages, state.pageH);
      }
      updateUI(state.active);
    });

    // 토글
    $("toggle").addEventListener("change", function () {
      var on = $("toggle").checked;
      sendToTab(tabId, { action: on ? "activate" : "deactivate" }, function (resp) {
        updateUI(on);
        if (resp && resp.totalPages) {
          showResult(resp.totalPages, resp.pageH);
        }
      });
    });

    // 마크 모드 (클릭으로 위치 지정)
    $("markBtn").addEventListener("click", function () {
      sendToTab(tabId, { action: "enterMarkMode" });
      // 팝업 닫기 — 유저가 페이지에서 클릭해야 하므로
      window.close();
    });

    // content script → popup 메시지 수신 (마크 완료 시)
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg.action === "markDone") {
        showResult(msg.totalPages, msg.pageH);
      }
    });

    // 미세 조정
    function adjust(delta) {
      sendToTab(tabId, { action: "adjustPageH", delta: delta }, function (resp) {
        if (resp) showResult(resp.totalPages, resp.pageH);
      });
    }

    $("upBig").addEventListener("click", function () { adjust(-20); });
    $("upSmall").addEventListener("click", function () { adjust(-5); });
    $("downSmall").addEventListener("click", function () { adjust(5); });
    $("downBig").addEventListener("click", function () { adjust(20); });

    function showResult(totalPages, pageH) {
      $("status").textContent = "미리보기: 총 " + totalPages + "페이지";
      $("adjust").classList.add("show");
      if (pageH) $("adjustInfo").textContent = pageH + "px";
    }

    function updateUI(on) {
      $("main").classList.toggle("disabled", !on);
      $("dot").classList.toggle("off", !on);
      $("footerText").textContent = on ? "미리보기 활성화됨" : "미리보기 꺼짐";
    }
  });
})();
