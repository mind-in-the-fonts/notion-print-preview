// popup.js — 토글만으로 미리보기 ON/OFF
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

    // 토글 — 켜면 자동으로 구분선 계산 & 표시
    $("toggle").addEventListener("change", function () {
      var on = $("toggle").checked;
      sendToTab(tabId, { action: on ? "activate" : "deactivate" }, function (resp) {
        updateUI(on);
        if (resp && resp.totalPages) showResult(resp.totalPages);
      });
    });

    function showResult(totalPages) {
      $("status").textContent = "총 " + totalPages + "페이지";
      $("status").classList.add("show");
    }

    function updateUI(on) {
      $("dot").classList.toggle("off", !on);
      $("footerText").textContent = on ? "미리보기 활성화됨" : "미리보기 꺼짐";
    }
  });
})();
