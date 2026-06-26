# Naukri Assisted Apply Queue

I created `naukri_assisted_apply.user.js`, a Chrome userscript for Tampermonkey or Violentmonkey.

It scans Naukri result pages, scrolls each result page to collect lazy-loaded cards, queues job cards, opens job pages one by one, and pauses with simple `Apply` / `Skip` buttons when a normal Naukri quick-apply button is ready. After each completed or skipped job it automatically moves to the next queued job. It skips jobs that are already applied or only offer `Apply on company site`. It pauses for screening popups/questions so you can finish them manually, then detects a successful application and updates the queue.

## Install

1. Install Tampermonkey or Violentmonkey in Chrome if you do not already have one.
2. Open the extension dashboard.
3. Create a new userscript.
4. Replace the default content with the full contents of `naukri_assisted_apply.user.js`.
5. Save the userscript and keep it enabled.

## Use

1. Open any Naukri page. If you are already on a search results page, `Start` uses that exact URL.
2. Use the floating `Naukri Assist` panel.
3. Click `Start`.
4. When it pauses on a normal quick-apply job, click `Apply` or `Skip`.

Open `Advanced` only when you want to change the search URL, optional keywords, max jobs, max result pages, or export the CSV log.

## Notes

- The script queues every visible job card by default. Include/exclude keywords are optional filters.
- The script scrolls each result page before moving on, then scans up to 10 search-result pages by default.
- It preserves the current URL filters while moving to the next page and stops sooner if it reaches the max job limit.
- Use Naukri filters first for location, salary, freshness, company type, and work mode.
- You can replace the `Search URL` with any Naukri results URL.
- It will not solve CAPTCHAs, OTPs, or answer recruiter questions automatically.
- Jobs with screening questions or popups are marked `manual`; after you complete them, the helper watches for successful application text/confirmation and marks them `applied`.
- Jobs with company-site apply or already-applied status are marked `skipped` and the queue moves on.
- `Export CSV` downloads the current queue and status log.
- `Reset` removes the local queue from your browser storage.
