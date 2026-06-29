// ==UserScript==
// @name         Wellfound Assisted Apply Queue
// @namespace    codex.local
// @version      0.1.0
// @description  Queue Wellfound jobs and assist with user-reviewed applications.
// @match        https://wellfound.com/*
// @include      https://*.wellfound.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  console.info("[Wellfound Assist] userscript loaded", location.href);

  if (window.__codexWellfoundAssistLoaded) return;
  window.__codexWellfoundAssistLoaded = true;

  const STORAGE_KEY = "codex.wellfoundAssistedApply.v1";
  const DEFAULT_SEARCH_URL = "https://wellfound.com/jobs";
  const DEFAULT_OPTIONS = {
    searchUrl: DEFAULT_SEARCH_URL,
    include: "",
    exclude: "",
    maxJobs: 100,
    autoNext: true
  };
  const DONE_STATUSES = new Set(["applied", "skipped", "manual", "failed"]);

  function defaultState() {
    return {
      running: false,
      paused: false,
      currentUrl: "",
      scannedSearchUrls: [],
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
      state.scannedSearchUrls = Array.isArray(state.scannedSearchUrls) ? state.scannedSearchUrls : [];
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
      return parsed.href.replace(/\/$/, "");
    } catch (error) {
      return String(url || "").split("#")[0].replace(/\/$/, "");
    }
  }

  function normalizeWellfoundUrl(value) {
    try {
      const url = new URL(String(value || "").trim(), location.href);
      if (!/(^|\.)wellfound\.com$/i.test(url.hostname)) return "";
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
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function isSearchResultsPage() {
    return location.pathname === "/jobs" && Boolean(document.querySelector('a[href*="/jobs/"]'));
  }

  function isJobDetailPage() {
    return /\/jobs\/\d+[-\w]*/i.test(location.pathname);
  }

  function isConfiguredSearchPage() {
    const searchUrl = normalizeWellfoundUrl(readState().options.searchUrl);
    return Boolean(searchUrl && canonicalUrl(location.href) === canonicalUrl(searchUrl));
  }

  function isApplyConfirmationPage() {
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return /application sent|application submitted|applied successfully|your application has been sent|you applied/.test(pageText);
  }

  function queueHasCapacity(state) {
    const maxJobs = Math.max(1, Number(state.options.maxJobs || DEFAULT_OPTIONS.maxJobs));
    return state.queue.length < maxJobs;
  }

  function currentSearchPageWasScanned() {
    const state = readState();
    return state.scannedSearchUrls.includes(canonicalUrl(location.href));
  }

  function markCurrentSearchPageScanned() {
    updateState((state) => {
      const current = canonicalUrl(location.href);
      if (!state.scannedSearchUrls.includes(current)) state.scannedSearchUrls.push(current);
    });
  }

  function jobLinks() {
    return Array.from(document.querySelectorAll('a[href*="/jobs/"]')).filter((link) => {
      try {
        const url = new URL(link.href, location.href);
        return /\/jobs\/\d+[-\w]*/i.test(url.pathname);
      } catch (error) {
        return false;
      }
    });
  }

  function nearbyText(link) {
    let node = link;
    const linkText = normalizeText(link.innerText || link.textContent);
    for (let depth = 0; node && depth < 8; depth += 1) {
      const text = normalizeText(node.innerText || node.textContent);
      if (text.length > Math.max(80, linkText.length + 20) && text.length < 5000) return text;
      node = node.parentElement;
    }
    return linkText;
  }

  function getVisibleJobSignature() {
    return jobLinks()
      .map((link) => canonicalUrl(link.href))
      .filter(Boolean)
      .join("|");
  }

  function getScrollState() {
    const doc = document.documentElement;
    const body = document.body;
    const top = window.scrollY || doc.scrollTop || body?.scrollTop || 0;
    const height = Math.max(doc.scrollHeight || 0, body?.scrollHeight || 0);
    const viewport = window.innerHeight || doc.clientHeight || 0;
    return {
      top,
      height,
      viewport,
      nearBottom: top + viewport >= height - 100
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function scanJobsFromPage(options = {}) {
    const shouldLog = options.logResult !== false;
    const shouldMarkScanned = options.markScanned !== false;
    const state = readState();
    const include = splitKeywords(state.options.include);
    const exclude = splitKeywords(state.options.exclude);
    const existing = new Set(state.queue.map((job) => canonicalUrl(job.url)));
    const links = jobLinks();
    const found = [];
    const seenOnPage = new Set();
    const stats = {
      links: links.length,
      added: 0,
      duplicate: 0,
      excluded: 0,
      missingInclude: 0,
      maxReached: false
    };
    const maxJobs = Math.max(1, Number(state.options.maxJobs || DEFAULT_OPTIONS.maxJobs));
    const slots = Math.max(0, maxJobs - state.queue.length);

    for (const link of links) {
      if (found.length >= slots) {
        stats.maxReached = true;
        break;
      }

      const url = canonicalUrl(link.href);
      if (!url || seenOnPage.has(url) || existing.has(url)) {
        stats.duplicate += 1;
        continue;
      }

      const text = nearbyText(link);
      if (exclude.length && includesAny(text, exclude)) {
        stats.excluded += 1;
        continue;
      }
      if (include.length && !includesAny(text, include)) {
        stats.missingInclude += 1;
        continue;
      }

      found.push({
        url,
        title: normalizeText(link.innerText || link.textContent) || "Wellfound job",
        company: "",
        text: text.slice(0, 1000),
        status: "queued",
        scannedAt: new Date().toISOString()
      });
      seenOnPage.add(url);
      existing.add(url);
    }

    stats.added = found.length;

    updateState((next) => {
      next.queue.push(...found);
      if (shouldMarkScanned) {
        const current = canonicalUrl(location.href);
        if (!next.scannedSearchUrls.includes(current)) next.scannedSearchUrls.push(current);
      }
    });

    if (shouldLog) {
      const filtered = stats.excluded + stats.missingInclude;
      const skipped = stats.duplicate + filtered;
      const suffix = skipped ? ` (${stats.links} job links, ${skipped} skipped${filtered ? `, ${filtered} by keywords` : ""}).` : ` (${stats.links} job links).`;
      log(found.length ? `Added ${found.length} job(s) to the queue${suffix}` : `No new jobs queued${suffix}`);
    }

    return stats;
  }

  async function scanCurrentResultsPageCompletely() {
    const maxPasses = 18;
    let totalAdded = 0;
    let maxLinksSeen = 0;
    let keywordSkipped = 0;
    let stableBottomPasses = 0;

    log("Scanning Wellfound results, including scrolled jobs.");
    window.scrollTo({ top: 0, behavior: "auto" });
    await sleep(800);

    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (!readState().running || readState().paused) return;
      if (!queueHasCapacity(readState())) break;

      const beforeSignature = getVisibleJobSignature();
      const beforeScroll = getScrollState();
      const stats = scanJobsFromPage({ logResult: false, markScanned: false });
      totalAdded += stats.added;
      maxLinksSeen = Math.max(maxLinksSeen, stats.links);
      keywordSkipped += stats.excluded + stats.missingInclude;

      if (!queueHasCapacity(readState())) break;

      const currentScroll = getScrollState();
      if (currentScroll.nearBottom) {
        await sleep(1500);
        const afterWaitSignature = getVisibleJobSignature();
        if (afterWaitSignature === beforeSignature) {
          stableBottomPasses += 1;
          if (stableBottomPasses >= 2) break;
        } else {
          stableBottomPasses = 0;
        }
      } else {
        stableBottomPasses = 0;
        window.scrollTo({
          top: Math.min(currentScroll.height, beforeScroll.top + Math.max(700, Math.floor(currentScroll.viewport * 1.35))),
          behavior: "smooth"
        });
        await sleep(1700);
      }
    }

    markCurrentSearchPageScanned();
    const keywordNote = keywordSkipped ? `, ${keywordSkipped} skipped by keywords` : "";
    log(`Finished scan: ${totalAdded} added from ${maxLinksSeen} visible job link(s)${keywordNote}.`);
  }

  function nextQueuedJob(state) {
    return state.queue.find((job) => !DONE_STATUSES.has(job.status));
  }

  function startQueue() {
    if (isSearchResultsPage()) {
      const currentSearchUrl = normalizeWellfoundUrl(location.href);
      if (currentSearchUrl) {
        updateState((next) => {
          if (canonicalUrl(next.options.searchUrl) !== canonicalUrl(currentSearchUrl)) {
            next.options.searchUrl = currentSearchUrl;
            next.scannedSearchUrls = [];
          } else {
            next.options.searchUrl = currentSearchUrl;
          }
        });
        log("Using the current Wellfound search URL.");
      }
    }

    const state = readState();
    if (!state.queue.some((job) => !DONE_STATUSES.has(job.status)) && isSearchResultsPage()) {
      updateState((next) => {
        next.running = true;
        next.paused = false;
      });
      runSearchPageFlow();
      return;
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
      log("Queue is empty. Open a Wellfound results page and start again.");
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
    const url = normalizeWellfoundUrl(state.options.searchUrl);
    if (!url) {
      updateState((next) => {
        next.running = false;
        next.paused = true;
      });
      log("Search URL is invalid. Paste a Wellfound URL and try again.");
      return false;
    }

    if (canonicalUrl(location.href) === canonicalUrl(url)) {
      log("Already on the configured search URL.");
      return true;
    }

    log("Opening configured Wellfound search URL.");
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
    if (!window.confirm("Reset the Wellfound assisted-apply queue and local log?")) return;
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

    if (canonicalUrl(location.href) !== canonicalUrl(job.url)) {
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

  function currentJobFromState(state) {
    return state.queue.find((item) => canonicalUrl(item.url) === canonicalUrl(state.currentUrl)) || null;
  }

  function resumeQueue(delayMs) {
    updateState((state) => {
      state.running = true;
      state.paused = false;
    });
    if (readState().options.autoNext) setTimeout(goToNextJob, delayMs);
  }

  function pauseForManualStep(title, message) {
    markCurrent("manual", message);
    updateState((state) => {
      state.running = false;
      state.paused = true;
    });
    log(`Paused for manual step: ${title}`);
    startManualApplyMonitor();
  }

  function skipCurrent(resumeAfterSkip) {
    markCurrent("skipped", "Skipped by user.");
    log("Skipped current job.");
    if (resumeAfterSkip) {
      resumeQueue(700);
      return;
    }
    if (readState().running) setTimeout(goToNextJob, 700);
  }

  function visibleControls() {
    return Array.from(document.querySelectorAll("button, a, [role='button'], input[type='submit']")).filter(isVisible);
  }

  function controlText(element) {
    return normalizeText(element.innerText || element.textContent || element.value || element.getAttribute("aria-label"));
  }

  function findApplyButton() {
    const candidates = visibleControls().filter((element) => {
      const text = controlText(element).toLowerCase();
      if (!["apply", "apply now"].includes(text)) return false;
      if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      return true;
    });

    candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function hasCompanyWebsiteApply() {
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return /apply on (the )?company('|’)?s website|apply on company website|external apply/.test(pageText);
  }

  function detectAlreadyApplied() {
    const hasAppliedButton = visibleControls().some((element) => {
      const text = controlText(element);
      return /^(applied|application sent|application submitted)$/i.test(text);
    });
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return hasAppliedButton || /you already applied|you have applied|application already sent/.test(pageText);
  }

  function detectApplied() {
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return detectAlreadyApplied() || /application sent|application submitted|applied successfully|your application has been sent|you applied/.test(pageText);
  }

  function detectCaptchaOrVerification() {
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    return /captcha|verify you are human|are you a robot|otp|one time password/.test(pageText);
  }

  function detectManualForm() {
    const visibleInputs = Array.from(document.querySelectorAll("textarea, select, input")).filter((element) => {
      const type = String(element.getAttribute("type") || "").toLowerCase();
      if (["hidden", "search"].includes(type)) return false;
      if (element.closest("#codex-wellfound-assist")) return false;
      return isVisible(element);
    });

    const submitLike = visibleControls()
      .map(controlText)
      .some((text) => /^(submit|submit application|send application|continue|next)$/i.test(text));
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    const formText = /cover letter|why are you interested|application|resume|linkedin|github|portfolio|required/.test(pageText);
    return (visibleInputs.length > 0 && (submitLike || formText)) || Boolean(document.querySelector("[role='dialog'], [aria-modal='true']"));
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
    return waitForCondition(() => findApplyButton(), 12000);
  }

  async function waitForOutcome() {
    return waitForCondition(() => {
      if (!/(^|\.)wellfound\.com$/i.test(location.hostname)) return "external";
      if (detectCaptchaOrVerification()) return "verification";
      if (detectApplied()) return "applied";
      if (detectManualForm()) return "manual";
      return null;
    }, 10000);
  }

  async function runSearchPageFlow() {
    if (!readState().running || readState().paused) return;

    await waitForCondition(() => jobLinks().length > 0, 12000);
    if (!readState().running || readState().paused) return;

    if (!isSearchResultsPage()) {
      updateState((state) => {
        state.running = false;
        state.paused = true;
      });
      log("Stopped: no Wellfound results loaded from the configured URL.");
      return;
    }

    if (!currentSearchPageWasScanned() && queueHasCapacity(readState())) {
      await scanCurrentResultsPageCompletely();
    }

    if (!readState().running || readState().paused) return;
    if (nextQueuedJob(readState())) {
      setTimeout(goToNextJob, 700);
    } else {
      updateState((state) => {
        state.running = false;
      });
      log("No matching jobs found on this Wellfound results page.");
    }
  }

  function currentJobForPage() {
    const state = readState();
    const pageUrl = canonicalUrl(location.href);
    return state.queue.find((job) => canonicalUrl(job.url) === pageUrl) || null;
  }

  function getDetailTitle(job) {
    return job?.title || normalizeText(document.querySelector("h1")?.innerText) || normalizeText(document.title) || "this Wellfound job";
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

    const title = getDetailTitle(job);
    if (detectAlreadyApplied()) {
      markCurrent("skipped", "Already applied.");
      log(`Skipped already-applied job: ${title}`);
      if (state.options.autoNext) setTimeout(goToNextJob, 900);
      return;
    }

    if (hasCompanyWebsiteApply()) {
      markCurrent("skipped", "Apply on company website.");
      log(`Skipped company-site apply: ${title}`);
      if (state.options.autoNext) setTimeout(goToNextJob, 900);
      return;
    }

    const applyButton = await waitForApplyButton();
    if (!applyButton) {
      markCurrent("skipped", "No Wellfound Apply button found.");
      log(`Skipped no Wellfound apply button: ${title}`);
      if (state.options.autoNext) setTimeout(goToNextJob, 900);
      return;
    }

    markCurrent("ready", "Ready for your Apply click.");
    updateState((next) => {
      next.running = false;
      next.paused = true;
    });
    log(`Ready to apply: ${title}`);
  }

  async function applyCurrentJobFromPanel() {
    const state = readState();
    const job = currentJobForPage() || currentJobFromState(state);
    if (!job) {
      log("No queued job is active on this page.");
      return;
    }

    const title = getDetailTitle(job);
    if (detectAlreadyApplied()) {
      markCurrent("skipped", "Already applied.");
      log(`Skipped already-applied job: ${title}`);
      resumeQueue(900);
      return;
    }

    if (hasCompanyWebsiteApply()) {
      markCurrent("skipped", "Apply on company website.");
      log(`Skipped company-site apply: ${title}`);
      resumeQueue(900);
      return;
    }

    const applyButton = await waitForApplyButton();
    if (!applyButton) {
      markCurrent("skipped", "No Wellfound Apply button found.");
      log(`Skipped no Wellfound apply button: ${title}`);
      resumeQueue(900);
      return;
    }

    updateState((next) => {
      next.running = true;
      next.paused = false;
    });
    markCurrent("opening", "Opening apply flow.");
    applyButton.click();
    log(`Clicked Apply for: ${title}`);
    await handleApplyOutcome(title);
  }

  async function handleApplyOutcome(title) {
    const outcome = await waitForOutcome();
    if (outcome === "applied") {
      markCurrent("applied", "Application appears submitted.");
      log(`Applied: ${title}`);
      if (readState().options.autoNext) setTimeout(goToNextJob, 1200);
      return;
    }

    if (outcome === "manual") {
      pauseForManualStep(title, "Application form or extra questions detected.");
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
      markCurrent("skipped", "Redirected outside Wellfound.");
      log("Skipped: redirected outside Wellfound.");
      resumeQueue(900);
      return;
    }

    pauseForManualStep(title, "Could not confirm outcome after clicking Apply.");
  }

  function detectManualApplySuccess() {
    const state = readState();
    const job = currentJobFromState(state);
    if (!job || job.status !== "manual") return false;
    if (!detectApplied() && !isApplyConfirmationPage()) return false;

    markCurrent("applied", "Application appears submitted after manual step.");
    log(`Applied after manual step: ${job.title || normalizeText(document.title) || "job"}`);
    resumeQueue(1000);
    return true;
  }

  function startManualApplyMonitor() {
    if (window.__codexWellfoundManualApplyMonitor) return;
    window.__codexWellfoundManualApplyMonitor = window.setInterval(() => {
      detectManualApplySuccess();
    }, 1500);
  }

  function runApplyConfirmationFlow() {
    const state = readState();
    const current = currentJobFromState(state);
    if (!current || current.status === "applied") return;

    if (detectApplied() || isApplyConfirmationPage()) {
      markCurrent("applied", "Application appears submitted.");
      log(`Applied: ${current?.title || normalizeText(document.title) || "job"}`);
      if (state.options.autoNext) resumeQueue(1000);
    }
  }

  function exportCsv() {
    const state = readState();
    const rows = [["status", "title", "url", "note"]];
    for (const job of state.queue) {
      rows.push([job.status || "", job.title || "", job.url || "", job.note || ""]);
    }
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wellfound-assisted-apply-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function ensurePanel() {
    let panel = document.getElementById("codex-wellfound-assist");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "codex-wellfound-assist";
    panel.innerHTML = `
      <style>
        #codex-wellfound-assist {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          width: 320px;
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
        #codex-wellfound-assist * { box-sizing: border-box; }
        #codex-wellfound-assist header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-bottom: 1px solid #e4e8ee;
          background: #f8fafc;
          border-radius: 8px 8px 0 0;
        }
        #codex-wellfound-assist strong { font-size: 14px; }
        #codex-wellfound-assist .cwa-body { padding: 10px 12px 12px; }
        #codex-wellfound-assist label {
          display: block;
          margin-top: 8px;
          color: #465465;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        #codex-wellfound-assist input {
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
        #codex-wellfound-assist .cwa-row,
        #codex-wellfound-assist .cwa-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 9px;
        }
        #codex-wellfound-assist button {
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
        #codex-wellfound-assist button[hidden],
        #codex-wellfound-assist .cwa-actions[hidden] { display: none; }
        #codex-wellfound-assist button.primary,
        #codex-wellfound-assist button.warn { flex: 1 1 auto; }
        #codex-wellfound-assist button.primary {
          border-color: #2457d6;
          color: #ffffff;
          background: #2457d6;
        }
        #codex-wellfound-assist button.warn {
          border-color: #c2410c;
          color: #c2410c;
        }
        #codex-wellfound-assist .cwa-status,
        #codex-wellfound-assist .cwa-counts {
          margin-top: 7px;
          color: #465465;
        }
        #codex-wellfound-assist .cwa-current {
          margin-top: 8px;
          color: #18202a;
          font-weight: 700;
        }
        #codex-wellfound-assist details {
          margin-top: 9px;
          border-top: 1px solid #e4e8ee;
          padding-top: 8px;
        }
        #codex-wellfound-assist summary {
          cursor: pointer;
          color: #2457d6;
          font-weight: 700;
        }
        #codex-wellfound-assist .cwa-log,
        #codex-wellfound-assist .cwa-queue {
          max-height: 90px;
          overflow: auto;
          margin-top: 8px;
          padding: 7px;
          border-radius: 6px;
          background: #f6f8fb;
          color: #334155;
          white-space: pre-wrap;
        }
        #codex-wellfound-assist.cwa-minimized .cwa-body { display: none; }
      </style>
      <header>
        <strong>Wellfound Assist</strong>
        <button type="button" id="cwaToggle">Hide</button>
      </header>
      <div class="cwa-body">
        <div class="cwa-status" id="cwaStatus"></div>
        <div class="cwa-counts" id="cwaCounts"></div>
        <div class="cwa-current" id="cwaCurrent"></div>
        <div class="cwa-actions" id="cwaApplyActions" hidden>
          <button type="button" id="cwaApplyCurrent" class="primary">Apply</button>
          <button type="button" id="cwaSkipCurrent" class="warn">Skip</button>
        </div>
        <div class="cwa-row">
          <button type="button" id="cwaRun" class="primary">Start</button>
          <button type="button" id="cwaClear" class="warn">Reset</button>
        </div>
        <div class="cwa-queue" id="cwaQueue"></div>
        <div class="cwa-log" id="cwaLog"></div>
        <details>
          <summary>Advanced</summary>
          <label for="cwaSearchUrl">Search URL</label>
          <input id="cwaSearchUrl" type="url" />
          <label for="cwaInclude">Include keywords (optional)</label>
          <input id="cwaInclude" type="text" />
          <label for="cwaExclude">Exclude keywords (optional)</label>
          <input id="cwaExclude" type="text" />
          <label for="cwaMaxJobs">Max jobs</label>
          <input id="cwaMaxJobs" type="number" min="1" max="200" />
          <div class="cwa-row">
            <button type="button" id="cwaExport">Export CSV</button>
          </div>
        </details>
      </div>
    `;

    document.documentElement.append(panel);
    panel.querySelector("#cwaToggle").addEventListener("click", () => {
      const minimized = panel.classList.toggle("cwa-minimized");
      panel.querySelector("#cwaToggle").textContent = minimized ? "Show" : "Hide";
    });
    panel.querySelector("#cwaRun").addEventListener("click", () => {
      persistOptionsFromPanel();
      if (readState().running) {
        pauseQueue();
      } else {
        startQueue();
      }
    });
    panel.querySelector("#cwaExport").addEventListener("click", exportCsv);
    panel.querySelector("#cwaClear").addEventListener("click", clearQueue);
    panel.querySelector("#cwaApplyCurrent").addEventListener("click", applyCurrentJobFromPanel);
    panel.querySelector("#cwaSkipCurrent").addEventListener("click", () => skipCurrent(true));
    panel.querySelector("#cwaSearchUrl").addEventListener("change", persistOptionsFromPanel);
    panel.querySelector("#cwaInclude").addEventListener("change", persistOptionsFromPanel);
    panel.querySelector("#cwaExclude").addEventListener("change", persistOptionsFromPanel);
    panel.querySelector("#cwaMaxJobs").addEventListener("change", persistOptionsFromPanel);
    return panel;
  }

  function persistOptionsFromPanel() {
    const panel = ensurePanel();
    updateState((state) => {
      state.options.searchUrl = panel.querySelector("#cwaSearchUrl").value;
      state.options.include = panel.querySelector("#cwaInclude").value;
      state.options.exclude = panel.querySelector("#cwaExclude").value;
      state.options.maxJobs = Math.max(1, Number(panel.querySelector("#cwaMaxJobs").value || DEFAULT_OPTIONS.maxJobs));
    });
  }

  function renderPanel() {
    const panel = ensurePanel();
    const state = readState();
    panel.querySelector("#cwaSearchUrl").value = state.options.searchUrl;
    panel.querySelector("#cwaInclude").value = state.options.include;
    panel.querySelector("#cwaExclude").value = state.options.exclude;
    panel.querySelector("#cwaMaxJobs").value = state.options.maxJobs;

    const counts = state.queue.reduce(
      (memo, job) => {
        memo.total += 1;
        memo[job.status || "queued"] = (memo[job.status || "queued"] || 0) + 1;
        return memo;
      },
      { total: 0 }
    );

    const active = state.running ? "Running" : state.paused ? "Paused" : "Ready";
    const pageType = isSearchResultsPage() ? "search page" : isJobDetailPage() ? "job detail" : "Wellfound page";
    panel.querySelector("#cwaStatus").textContent = `${active} on ${pageType}`;
    panel.querySelector("#cwaCounts").textContent =
      `Queue ${counts.total || 0} | Pending ${(counts.queued || 0) + (counts.opening || 0) + (counts.ready || 0)} | Applied ${counts.applied || 0} | Manual ${counts.manual || 0} | Skipped ${counts.skipped || 0}`;

    const currentJob = currentJobFromState(state);
    const waitingForAction =
      currentJob &&
      ["ready", "manual"].includes(currentJob.status) &&
      isJobDetailPage() &&
      canonicalUrl(location.href) === canonicalUrl(currentJob.url);
    panel.querySelector("#cwaCurrent").textContent = currentJob
      ? `${currentJob.status || "queued"}: ${currentJob.title || "Wellfound job"}`
      : "Start on a Wellfound results page.";
    panel.querySelector("#cwaApplyActions").hidden = !waitingForAction;
    panel.querySelector("#cwaApplyCurrent").hidden = !(currentJob && currentJob.status === "ready");
    panel.querySelector("#cwaRun").textContent = state.running ? "Pause" : "Start";

    panel.querySelector("#cwaQueue").textContent =
      state.queue
        .slice(0, 6)
        .map((job, index) => `${index + 1}. [${job.status || "queued"}] ${job.title || "Wellfound job"}`)
        .join("\n") || "No queued jobs yet.";

    panel.querySelector("#cwaLog").textContent = state.logs.join("\n") || "No activity yet.";
  }

  function boot() {
    renderPanel();
    const state = readState();
    const current = currentJobFromState(state);

    if (current?.status === "manual") {
      startManualApplyMonitor();
      setTimeout(detectManualApplySuccess, 1000);
    }

    if (isApplyConfirmationPage()) setTimeout(runApplyConfirmationFlow, 1200);
    if (isJobDetailPage() && state.running && !state.paused) setTimeout(runJobDetailFlow, 1200);
    if ((isSearchResultsPage() || isConfiguredSearchPage()) && state.running && !state.paused) {
      setTimeout(runSearchPageFlow, 1200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
