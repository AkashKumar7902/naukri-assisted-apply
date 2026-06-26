// ==UserScript==
// @name         Naukri Assisted Apply Queue
// @namespace    codex.local
// @version      0.1.3
// @description  Queue Naukri jobs from search results and assist with user-confirmed applications.
// @match        https://www.naukri.com/*
// @include      https://*.naukri.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  console.info("[Naukri Assist] userscript loaded", location.href);

  if (window.__codexNaukriAssistLoaded) return;
  window.__codexNaukriAssistLoaded = true;

  const STORAGE_KEY = "codex.naukriAssistedApply.v1";
  const DEFAULT_SEARCH_URL = "https://www.naukri.com/software-developer-jobs?k=software%20developer&nignbevent_src=jobsearchDeskGNB&experience=1&functionAreaIdGid=5&ctcFilter=15to25&glbl_qcrc=1026&glbl_qcrc=1027&glbl_qcrc=1028&jobAge=1";
  const DEFAULT_OPTIONS = {
    searchUrl: DEFAULT_SEARCH_URL,
    include: "software, developer, backend, cloud, java, python, spring, aws, gcp",
    exclude: "recruiter, sales, walk-in, system administrator, admin, customer support, bpo",
    maxJobs: 20,
    autoNext: true
  };

  const DONE_STATUSES = new Set(["applied", "skipped", "manual", "failed"]);

  function defaultState() {
    return {
      running: false,
      paused: false,
      currentUrl: "",
      queue: [],
      options: Object.assign({}, DEFAULT_OPTIONS),
      logs: []
    };
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      const state = Object.assign(defaultState(), parsed || {});
      state.options = Object.assign({}, DEFAULT_OPTIONS, state.options || {});
      state.queue = Array.isArray(state.queue) ? state.queue : [];
      state.logs = Array.isArray(state.logs) ? state.logs : [];
      return state;
    } catch (error) {
      return defaultState();
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function updateState(mutator) {
    const state = readState();
    mutator(state);
    saveState(state);
    renderPanel();
    return state;
  }

  function log(message) {
    updateState((state) => {
      state.logs.unshift(`${new Date().toLocaleTimeString()} - ${message}`);
      state.logs = state.logs.slice(0, 8);
    });
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function canonicalUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      parsed.hash = "";
      parsed.searchParams.delete("codexAssist");
      return parsed.href.replace(/\/$/, "");
    } catch (error) {
      return String(url || "").split("#")[0].replace(/\/$/, "");
    }
  }

  function normalizeNaukriUrl(value) {
    try {
      const url = new URL(String(value || "").trim(), location.href);
      if (!/(^|\.)naukri\.com$/i.test(url.hostname)) return "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function splitKeywords(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  function includesAny(haystack, needles) {
    const lower = haystack.toLowerCase();
    return needles.some((needle) => lower.includes(needle));
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isSearchResultsPage() {
    return Boolean(document.querySelector(".srp-jobtuple-wrapper, .jobTuple"));
  }

  function isJobDetailPage() {
    return /\/job-listings-/i.test(location.href) || Boolean(document.querySelector("#apply-button, .apply-button"));
  }

  function isConfiguredSearchPage() {
    const searchUrl = normalizeNaukriUrl(readState().options.searchUrl);
    return Boolean(searchUrl && canonicalUrl(location.href) === canonicalUrl(searchUrl));
  }

  function scanJobsFromPage() {
    const state = readState();
    const include = splitKeywords(state.options.include);
    const exclude = splitKeywords(state.options.exclude);
    const existing = new Set(state.queue.map((job) => canonicalUrl(job.url)));
    const cards = Array.from(document.querySelectorAll(".srp-jobtuple-wrapper, .jobTuple, article"));
    const found = [];

    for (const card of cards) {
      const link =
        card.querySelector('a.title[href*="job-listings"]') ||
        card.querySelector('a[href*="/job-listings-"]') ||
        card.querySelector('a[href*="job-listings"]');
      if (!link || !link.href) continue;

      const url = canonicalUrl(link.href);
      if (existing.has(url)) continue;

      const text = normalizeText(card.innerText);
      if (!text) continue;
      if (exclude.length && includesAny(text, exclude)) continue;
      if (include.length && !includesAny(text, include)) continue;

      const company =
        normalizeText(card.querySelector(".comp-name")?.innerText) ||
        normalizeText(card.querySelector('[class*="comp"]')?.innerText);
      const title = normalizeText(link.innerText) || "Naukri job";

      found.push({
        url,
        title,
        company,
        text: text.slice(0, 800),
        status: "queued",
        scannedAt: new Date().toISOString()
      });

      existing.add(url);
      if (found.length >= Number(state.options.maxJobs || DEFAULT_OPTIONS.maxJobs)) break;
    }

    updateState((next) => {
      next.queue.push(...found);
    });

    log(found.length ? `Added ${found.length} job(s) to the queue.` : "No new matching jobs found on this page.");
  }

  function nextQueuedJob(state) {
    return state.queue.find((job) => !DONE_STATUSES.has(job.status));
  }

  function startQueue() {
    let state = readState();
    if (!state.queue.some((job) => !DONE_STATUSES.has(job.status)) && isSearchResultsPage()) {
      scanJobsFromPage();
      state = readState();
    }

    if (!state.queue.some((job) => !DONE_STATUSES.has(job.status)) && !isSearchResultsPage()) {
      updateState((next) => {
        next.running = true;
        next.paused = false;
        next.currentUrl = "";
      });
      openConfiguredSearch();
      return;
    }

    if (!state.queue.some((job) => !DONE_STATUSES.has(job.status))) {
      log("Queue is empty. Adjust filters or scan another results page.");
      return;
    }

    updateState((next) => {
      next.running = true;
      next.paused = false;
    });

    goToNextJob();
  }

  function openConfiguredSearch() {
    const state = readState();
    const url = normalizeNaukriUrl(state.options.searchUrl);
    if (!url) {
      updateState((next) => {
        next.running = false;
        next.paused = true;
      });
      log("Search URL is invalid. Paste a Naukri URL and try again.");
      return false;
    }

    if (canonicalUrl(location.href) === canonicalUrl(url)) {
      log("Already on the configured search URL.");
      return true;
    }

    log("Opening configured search URL.");
    location.href = url;
    return true;
  }

  function pauseQueue() {
    updateState((state) => {
      state.running = false;
      state.paused = true;
    });
    log("Paused.");
  }

  function clearQueue() {
    if (!window.confirm("Clear the Naukri assisted-apply queue and local log?")) return;
    saveState(defaultState());
    renderPanel();
  }

  function goToNextJob() {
    const state = readState();
    const job = nextQueuedJob(state);
    if (!job) {
      updateState((next) => {
        next.running = false;
        next.currentUrl = "";
      });
      log("Queue complete.");
      return;
    }

    updateState((next) => {
      next.currentUrl = canonicalUrl(job.url);
      const current = next.queue.find((item) => canonicalUrl(item.url) === canonicalUrl(job.url));
      if (current) current.status = "opening";
    });

    const currentUrl = canonicalUrl(location.href);
    if (currentUrl !== canonicalUrl(job.url)) {
      location.href = job.url;
      return;
    }

    runJobDetailFlow();
  }

  function markCurrent(status, message) {
    const currentUrl = canonicalUrl(location.href);
    updateState((state) => {
      const job =
        state.queue.find((item) => canonicalUrl(item.url) === currentUrl) ||
        state.queue.find((item) => canonicalUrl(item.url) === canonicalUrl(state.currentUrl));
      if (job) {
        job.status = status;
        job.updatedAt = new Date().toISOString();
        if (message) job.note = message;
      }
    });
  }

  function skipCurrent() {
    markCurrent("skipped", "Skipped by user.");
    log("Skipped current job.");
    if (readState().running) {
      setTimeout(goToNextJob, 700);
    }
  }

  function findApplyButton() {
    const controls = Array.from(document.querySelectorAll("button, a, [role='button']"));
    const candidates = controls.filter((element) => {
      const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
      const marker = `${element.id || ""} ${element.className || ""} ${text}`.toLowerCase();
      if (/applied/i.test(text)) return false;
      if (!/(\bapply\b|apply-button)/i.test(marker)) return false;
      if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      return isVisible(element);
    });

    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function detectApplied() {
    const controls = Array.from(document.querySelectorAll("button, a, [role='button']"));
    const hasAppliedControl = controls.some((element) => {
      const text = normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label"));
      return /^applied$/i.test(text) && isVisible(element);
    });

    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return (
      hasAppliedControl ||
      pageText.includes("you have successfully applied") ||
      pageText.includes("application submitted") ||
      pageText.includes("application sent")
    );
  }

  function detectCaptchaOrVerification() {
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return /captcha|verify you are human|are you a robot|otp|one time password/.test(pageText);
  }

  function detectManualQuestionnaire() {
    const visibleInputs = Array.from(document.querySelectorAll("textarea, select, input"))
      .filter((element) => {
        const type = String(element.getAttribute("type") || "").toLowerCase();
        if (["hidden", "search"].includes(type)) return false;
        if (element.closest("#codex-naukri-assist")) return false;
        if (element.closest(".nI-gNb-search-bar, .nI-gNb-sb, header")) return false;
        return isVisible(element);
      });

    const visibleActionButtons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter(isVisible)
      .map((element) => normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label")))
      .filter(Boolean);

    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    const hasQuestionText = /question|answer|required|screening|additional detail|recruiter/.test(pageText);
    const hasSubmitLikeButton = visibleActionButtons.some((text) => /^(submit|next|continue|save)$/i.test(text));
    return visibleInputs.length > 0 && (hasQuestionText || hasSubmitLikeButton);
  }

  function waitForCondition(check, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        const result = check();
        if (result || Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          resolve(result || null);
        }
      }, 500);
    });
  }

  async function waitForApplyButton() {
    return waitForCondition(() => findApplyButton(), 10000);
  }

  async function waitForOutcome() {
    return waitForCondition(() => {
      if (!/naukri\.com$/i.test(location.hostname)) return "external";
      if (detectCaptchaOrVerification()) return "verification";
      if (detectApplied()) return "applied";
      if (detectManualQuestionnaire()) return "manual";
      return null;
    }, 10000);
  }

  async function runSearchPageFlow() {
    if (!readState().running || readState().paused) return;

    if (nextQueuedJob(readState())) {
      goToNextJob();
      return;
    }

    await waitForCondition(() => document.querySelector(".srp-jobtuple-wrapper, .jobTuple"), 10000);
    if (!readState().running || readState().paused) return;
    if (!isSearchResultsPage()) {
      updateState((state) => {
        state.running = false;
        state.paused = true;
      });
      log("Stopped: no Naukri results loaded from the configured search URL.");
      return;
    }

    scanJobsFromPage();
    if (nextQueuedJob(readState())) {
      setTimeout(goToNextJob, 700);
    } else {
      updateState((state) => {
        state.running = false;
      });
      log("No matching jobs found on the configured search page.");
    }
  }

  function currentJobForPage() {
    const state = readState();
    const pageUrl = canonicalUrl(location.href);
    return state.queue.find((job) => canonicalUrl(job.url) === pageUrl) || null;
  }

  function getDetailTitle(job) {
    return (
      job?.title ||
      normalizeText(document.querySelector("h1")?.innerText) ||
      normalizeText(document.title) ||
      "this Naukri job"
    );
  }

  async function runJobDetailFlow() {
    const state = readState();
    if (!state.running || state.paused || !isJobDetailPage()) return;

    const job = currentJobForPage();
    if (!job) {
      updateState((next) => {
        next.running = false;
        next.paused = true;
      });
      log("Stopped: this job page is not in the queue.");
      return;
    }

    if (detectApplied()) {
      markCurrent("applied", "Already applied.");
      log(`Already applied: ${getDetailTitle(job)}`);
      if (state.options.autoNext) setTimeout(goToNextJob, 900);
      return;
    }

    const applyButton = await waitForApplyButton();
    if (!applyButton) {
      markCurrent("manual", "No visible Apply button found.");
      updateState((next) => {
        next.running = false;
        next.paused = true;
      });
      log("Stopped: no visible Apply button on this job.");
      return;
    }

    const title = getDetailTitle(job);
    const company = job.company ? ` at ${job.company}` : "";
    const message = [
      `Apply to "${title}"${company}?`,
      "",
      "This will send your Naukri profile/resume to the employer.",
      "The helper will skip jobs with screening questions and stop for verification or external redirects."
    ].join("\n");

    if (!window.confirm(message)) {
      markCurrent("skipped", "User declined confirmation.");
      log(`Skipped: ${title}`);
      if (readState().running) setTimeout(goToNextJob, 900);
      return;
    }

    applyButton.click();
    log(`Clicked Apply for: ${title}`);

    const outcome = await waitForOutcome();
    if (outcome === "applied") {
      markCurrent("applied", "Application appears submitted.");
      log(`Applied: ${title}`);
      if (readState().options.autoNext) setTimeout(goToNextJob, 1200);
      return;
    }

    if (outcome === "manual") {
      markCurrent("skipped", "Screening question or extra inputs detected.");
      log(`Skipped screening questions: ${title}`);
      if (readState().options.autoNext) setTimeout(goToNextJob, 1200);
      return;
    }

    if (outcome === "verification") {
      markCurrent("manual", "Verification or CAPTCHA detected.");
      updateState((next) => {
        next.running = false;
        next.paused = true;
      });
      log("Stopped: verification step detected.");
      return;
    }

    if (outcome === "external") {
      markCurrent("manual", "Redirected outside Naukri.");
      updateState((next) => {
        next.running = false;
        next.paused = true;
      });
      log("Stopped: redirected outside Naukri.");
      return;
    }

    markCurrent("manual", "Could not confirm outcome after clicking Apply.");
    updateState((next) => {
      next.running = false;
      next.paused = true;
    });
    log("Stopped: could not confirm the application outcome.");
  }

  function exportCsv() {
    const state = readState();
    const rows = [["status", "title", "company", "url", "note"]];
    for (const job of state.queue) {
      rows.push([job.status || "", job.title || "", job.company || "", job.url || "", job.note || ""]);
    }
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `naukri-assisted-apply-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function ensurePanel() {
    let panel = document.getElementById("codex-naukri-assist");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "codex-naukri-assist";
    panel.innerHTML = `
      <style>
        #codex-naukri-assist {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          width: 340px;
          max-width: calc(100vw - 32px);
          color: #18202a;
          background: #ffffff;
          border: 1px solid #cfd6df;
          border-radius: 8px;
          box-shadow: 0 10px 36px rgba(16, 24, 40, 0.24);
          font-family: Arial, Helvetica, sans-serif;
          font-size: 13px;
          line-height: 1.35;
        }
        #codex-naukri-assist * {
          box-sizing: border-box;
        }
        #codex-naukri-assist header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-bottom: 1px solid #e4e8ee;
          background: #f8fafc;
          border-radius: 8px 8px 0 0;
        }
        #codex-naukri-assist strong {
          font-size: 14px;
        }
        #codex-naukri-assist .cna-body {
          padding: 10px 12px 12px;
        }
        #codex-naukri-assist label {
          display: block;
          margin-top: 8px;
          color: #465465;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        #codex-naukri-assist input {
          width: 100%;
          height: 30px;
          margin-top: 3px;
          padding: 5px 7px;
          border: 1px solid #cfd6df;
          border-radius: 6px;
          color: #18202a;
          background: #ffffff;
          font: inherit;
        }
        #codex-naukri-assist .cna-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 9px;
        }
        #codex-naukri-assist button {
          height: 30px;
          padding: 0 9px;
          border: 1px solid #b8c2cf;
          border-radius: 6px;
          color: #17202a;
          background: #ffffff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
        }
        #codex-naukri-assist button.primary {
          border-color: #2457d6;
          color: #ffffff;
          background: #2457d6;
        }
        #codex-naukri-assist button.warn {
          border-color: #c2410c;
          color: #c2410c;
        }
        #codex-naukri-assist .cna-status,
        #codex-naukri-assist .cna-counts {
          margin-top: 7px;
          color: #465465;
        }
        #codex-naukri-assist .cna-log,
        #codex-naukri-assist .cna-queue {
          max-height: 90px;
          overflow: auto;
          margin-top: 8px;
          padding: 7px;
          border-radius: 6px;
          background: #f6f8fb;
          color: #334155;
          white-space: pre-wrap;
        }
        #codex-naukri-assist.cna-minimized .cna-body {
          display: none;
        }
      </style>
      <header>
        <strong>Naukri Assist</strong>
        <button type="button" id="cnaToggle">Hide</button>
      </header>
      <div class="cna-body">
        <div class="cna-status" id="cnaStatus"></div>
        <div class="cna-counts" id="cnaCounts"></div>
        <label for="cnaSearchUrl">Search URL</label>
        <input id="cnaSearchUrl" type="url" />
        <label for="cnaInclude">Include keywords</label>
        <input id="cnaInclude" type="text" />
        <label for="cnaExclude">Exclude keywords</label>
        <input id="cnaExclude" type="text" />
        <label for="cnaMaxJobs">Max new jobs per scan</label>
        <input id="cnaMaxJobs" type="number" min="1" max="100" />
        <div class="cna-row">
          <button type="button" id="cnaOpenSearch">Open search</button>
          <button type="button" id="cnaScan">Scan page</button>
          <button type="button" id="cnaStart" class="primary">Start queue</button>
          <button type="button" id="cnaPause">Pause</button>
          <button type="button" id="cnaSkip">Skip current</button>
          <button type="button" id="cnaExport">Export CSV</button>
          <button type="button" id="cnaClear" class="warn">Clear</button>
        </div>
        <div class="cna-queue" id="cnaQueue"></div>
        <div class="cna-log" id="cnaLog"></div>
      </div>
    `;

    document.documentElement.append(panel);
    panel.querySelector("#cnaToggle").addEventListener("click", () => {
      const minimized = panel.classList.toggle("cna-minimized");
      panel.querySelector("#cnaToggle").textContent = minimized ? "Show" : "Hide";
    });
    panel.querySelector("#cnaScan").addEventListener("click", () => {
      persistOptionsFromPanel();
      scanJobsFromPage();
    });
    panel.querySelector("#cnaOpenSearch").addEventListener("click", () => {
      persistOptionsFromPanel();
      updateState((state) => {
        state.running = false;
        state.paused = false;
      });
      openConfiguredSearch();
    });
    panel.querySelector("#cnaStart").addEventListener("click", () => {
      persistOptionsFromPanel();
      startQueue();
    });
    panel.querySelector("#cnaPause").addEventListener("click", pauseQueue);
    panel.querySelector("#cnaSkip").addEventListener("click", skipCurrent);
    panel.querySelector("#cnaExport").addEventListener("click", exportCsv);
    panel.querySelector("#cnaClear").addEventListener("click", clearQueue);
    panel.querySelector("#cnaSearchUrl").addEventListener("change", persistOptionsFromPanel);
    panel.querySelector("#cnaInclude").addEventListener("change", persistOptionsFromPanel);
    panel.querySelector("#cnaExclude").addEventListener("change", persistOptionsFromPanel);
    panel.querySelector("#cnaMaxJobs").addEventListener("change", persistOptionsFromPanel);
    return panel;
  }

  function persistOptionsFromPanel() {
    const panel = ensurePanel();
    updateState((state) => {
      state.options.searchUrl = panel.querySelector("#cnaSearchUrl").value;
      state.options.include = panel.querySelector("#cnaInclude").value;
      state.options.exclude = panel.querySelector("#cnaExclude").value;
      state.options.maxJobs = Math.max(1, Number(panel.querySelector("#cnaMaxJobs").value || DEFAULT_OPTIONS.maxJobs));
    });
  }

  function renderPanel() {
    const panel = ensurePanel();
    const state = readState();
    panel.querySelector("#cnaSearchUrl").value = state.options.searchUrl;
    panel.querySelector("#cnaInclude").value = state.options.include;
    panel.querySelector("#cnaExclude").value = state.options.exclude;
    panel.querySelector("#cnaMaxJobs").value = state.options.maxJobs;

    const counts = state.queue.reduce(
      (memo, job) => {
        memo.total += 1;
        memo[job.status || "queued"] = (memo[job.status || "queued"] || 0) + 1;
        return memo;
      },
      { total: 0 }
    );

    const active = state.running ? "Running" : state.paused ? "Paused" : "Ready";
    const pageType = isSearchResultsPage() ? "search page" : isJobDetailPage() ? "job detail" : "Naukri page";
    panel.querySelector("#cnaStatus").textContent = `${active} on ${pageType}. Each apply action asks for your confirmation.`;
    panel.querySelector("#cnaCounts").textContent =
      `Queue: ${counts.total || 0}, queued/opening: ${(counts.queued || 0) + (counts.opening || 0)}, ` +
      `applied: ${counts.applied || 0}, manual: ${counts.manual || 0}, skipped: ${counts.skipped || 0}`;

    const queueBox = panel.querySelector("#cnaQueue");
    queueBox.textContent = state.queue
      .slice(0, 6)
      .map((job, index) => `${index + 1}. [${job.status || "queued"}] ${job.title || "Naukri job"}${job.company ? ` - ${job.company}` : ""}`)
      .join("\n") || "No queued jobs yet. Open a Naukri search page and click Scan page.";

    panel.querySelector("#cnaLog").textContent = state.logs.join("\n") || "No activity yet.";
  }

  function boot() {
    renderPanel();

    if (isJobDetailPage() && readState().running && !readState().paused) {
      setTimeout(runJobDetailFlow, 1200);
    }

    if ((isSearchResultsPage() || isConfiguredSearchPage()) && readState().running && !readState().paused) {
      setTimeout(runSearchPageFlow, 1200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
