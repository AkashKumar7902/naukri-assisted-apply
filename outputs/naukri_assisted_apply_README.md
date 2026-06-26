# Naukri Assisted Apply Queue

I created `naukri_assisted_apply.user.js`, a Chrome userscript for Tampermonkey or Violentmonkey.

It scans the visible Naukri results page, queues matching jobs, opens job pages one by one, and asks for your confirmation before clicking `Apply` for each job. After each job it automatically moves to the next queued job. It skips jobs that are already applied, show screening popups/questions, or only offer `Apply on company site`. It stops for OTP/CAPTCHA or unclear outcomes.

## Install

1. Install Tampermonkey or Violentmonkey in Chrome if you do not already have one.
2. Open the extension dashboard.
3. Create a new userscript.
4. Replace the default content with the full contents of `naukri_assisted_apply.user.js`.
5. Save the userscript and keep it enabled.

## Use

1. Open any Naukri page.
2. Use the floating `Naukri Assist` panel.
3. Click `Start`.
4. Approve or decline each application confirmation.

Open `Advanced` only when you want to change the search URL, keywords, max jobs, or export the CSV log.

## Notes

- The script only scans jobs currently visible in the page DOM.
- Use Naukri filters first for location, salary, freshness, company type, and work mode.
- You can replace the `Search URL` with any Naukri results URL.
- It will not solve CAPTCHAs, OTPs, or answer recruiter questions automatically.
- Jobs with screening questions, popups, company-site apply, or already-applied status are marked `skipped` and the queue moves on.
- `Export CSV` downloads the current queue and status log.
- `Reset` removes the local queue from your browser storage.
