# Wellfound Assisted Apply Queue

`wellfound_assisted_apply.user.js` is a separate Tampermonkey/Violentmonkey userscript for Wellfound.

It scans Wellfound job results, scrolls to collect lazy-loaded job links, queues jobs, opens each detail page, and pauses before the Wellfound `Apply` action. If Wellfound opens an application form or extra questions, the job is marked `manual`; after you finish it, the helper watches for success text and updates the job to `applied`.

## Install

1. Open Tampermonkey or Violentmonkey in Chrome.
2. Create a new userscript.
3. Replace the default content with `wellfound_assisted_apply.user.js`.
4. Save the script and keep it enabled.

## Use

1. Open `https://wellfound.com/jobs`.
2. Apply whatever Wellfound search filters you want.
3. Click `Start` in the floating `Wellfound Assist` panel.
4. When it pauses on a job, click `Apply` or `Skip`.

If a form, cover-letter field, screening question, CAPTCHA, or verification step appears, complete it manually. The helper will detect a successful application when Wellfound shows confirmation text.

## Notes

- `Start` uses the current Wellfound jobs URL when you are on a search page.
- The helper does not submit applications with no human review.
- It skips jobs that appear already applied, company-site/external apply jobs, or jobs without a Wellfound `Apply` button.
- Optional include/exclude keywords and max jobs are in `Advanced`.
- `Export CSV` downloads the current queue and status log.
- `Reset` clears the local Wellfound queue from browser storage.
