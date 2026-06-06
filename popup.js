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
        $("status").textContent = "미리보기: 총 " + state.totalPages + "페이지";
        $("adjust").classList.add("show");
        updateAdjustInfo(state.pageH);
      }
      updateUI(state.active);
    });

    // 토글
    $("toggle").addEventListener("change", function () {
      var on = $("toggle").checked;
      sendToTab(tabId, { action: on ? "activate" : "deactivate" }, function (resp) {
        updateUI(on);
        if (resp && resp.totalPages) {
          $("status").textContent = "미리보기: 총 " + resp.totalPages + "페이지";
        }
      });
    });

    // 적용
    function apply() {
      var v = parseInt($("pageCount").value, 10);
      if (!v || v < 1) return;
      sendToTab(tabId, { action: "calibrate", pageCount: v }, function (resp) {
        if (resp && resp.totalPages) {
          $("status").textContent = "미리보기: 총 " + resp.totalPages + "페이지";
          $("adjust").classList.add("show");
          updateAdjustInfo(resp.pageH);
        }
      });
    }

    $("applyBtn").addEventListener("click", apply);
    $("pageCount").addEventListener("keydown", function (e) {
      if (e.key === "Enter") apply();
    });

    // 미세 조정
    function adjust(delta) {
      sendToTab(tabId, { action: "adjustPageH", delta: delta }, function (resp) {
        if (resp && resp.totalPages) {
          $("status").textContent = "미리보기: 총 " + resp.totalPages + "페이지";
          updateAdjustInfo(resp.pageH);
        }
      });
    }

    $("upBig").addEventListener("click", function () { adjust(-20); });
    $("upSmall").addEventListener("click", function () { adjust(-5); });
    $("downSmall").addEventListener("click", function () { adjust(5); });
    $("downBig").addEventListener("click", function () { adjust(20); });

    function updateAdjustInfo(pageH) {
      if (pageH) {
        $("adjustInfo").textContent = "페이지 높이: " + pageH + "px";
      }
    }

    function updateUI(on) {
      $("main").classList.toggle("disabled", !on);
      $("dot").classList.toggle("off", !on);
      $("footerText").textContent = on ? "미리보기 활성화됨" : "미리보기 꺼짐";
    }
  });
})();
