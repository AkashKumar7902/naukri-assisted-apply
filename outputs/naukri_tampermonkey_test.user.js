// ==UserScript==
// @name         Naukri Tampermonkey Injection Test
// @namespace    codex.local
// @version      0.1.0
// @description  Shows a small fixed badge on Naukri pages to confirm Tampermonkey injection works.
// @match        https://www.naukri.com/*
// @include      https://*.naukri.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  console.info("[Naukri TM Test] userscript loaded", location.href);

  const badge = document.createElement("div");
  badge.id = "naukri-tm-test-badge";
  badge.textContent = "Tampermonkey OK";
  badge.style.cssText = [
    "position:fixed",
    "right:16px",
    "top:16px",
    "z-index:2147483647",
    "background:#0f766e",
    "color:#fff",
    "padding:10px 12px",
    "border-radius:8px",
    "font:700 14px Arial,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.25)"
  ].join(";");
  document.documentElement.append(badge);
})();
