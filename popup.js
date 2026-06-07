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
      if (state.totalPages) showResult(state.totalPages);
      updateUI(state.active);
    });

    // 토글
    $("toggle").addEventListener("change", function () {
      var on = $("toggle").checked;
      sendToTab(tabId, { action: on ? "activate" : "deactivate" }, function (resp) {
        updateUI(on);
        if (resp && resp.totalPages) showResult(resp.totalPages);
      });
    });

    // 페이지 수 입력
    function apply() {
      var v = parseInt($("pageCount").value, 10);
      if (!v || v < 1) return;
      sendToTab(tabId, { action: "calibrate", pageCount: v }, function (resp) {
        if (resp && resp.totalPages) showResult(resp.totalPages);
      });
    }
    $("applyBtn").addEventListener("click", apply);
    $("pageCount").addEventListener("keydown", function (e) {
      if (e.key === "Enter") apply();
    });

    // 클릭으로 위치 지정
    $("markBtn").addEventListener("click", function () {
      sendToTab(tabId, { action: "enterMarkMode" });
      window.close();
    });

    // 마크 완료 수신
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg.action === "markDone") showResult(msg.totalPages);
    });

    function showResult(totalPages) {
      $("status").textContent = "미리보기: 총 " + totalPages + "페이지";
    }

    function updateUI(on) {
      $("main").classList.toggle("disabled", !on);
      $("dot").classList.toggle("off", !on);
      $("footerText").textContent = on ? "미리보기 활성화됨" : "미리보기 꺼짐";
    }
  });
})();
