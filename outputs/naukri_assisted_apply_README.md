# Naukri Assisted Apply Queue

I created `naukri_assisted_apply.user.js`, a Chrome userscript for Tampermonkey or Violentmonkey.

It does not blindly spam applications. It scans the visible Naukri results page, queues matching jobs, opens job pages one by one, and asks for your confirmation before clicking `Apply` for each job. It skips jobs that show screening questions, and stops when Naukri shows OTP/CAPTCHA, redirects outside Naukri, or when the outcome cannot be confirmed.

## Install

1. Install Tampermonkey or Violentmonkey in Chrome if you do not already have one.
2. Open the extension dashboard.
3. Create a new userscript.
4. Replace the default content with the full contents of `naukri_assisted_apply.user.js`.
5. Save the userscript and keep it enabled.

## Use

1. Open any Naukri page.
2. Use the floating `Naukri Assist` panel.
3. Paste or edit the `Search URL`. The default is:
   `https://www.naukri.com/software-developer-jobs?k=software%20developer&nignbevent_src=jobsearchDeskGNB&experience=1&functionAreaIdGid=5&ctcFilter=15to25&glbl_qcrc=1026&glbl_qcrc=1027&glbl_qcrc=1028&jobAge=1`
4. Adjust include/exclude keywords if needed.
5. Click `Open search` to navigate to that search URL, or click `Start queue` to open the URL, scan it, and begin the queue.
6. Approve or decline each application confirmation.

## Notes

- The script only scans jobs currently visible in the page DOM.
- Use Naukri filters first for location, salary, freshness, company type, and work mode.
- You can replace the `Search URL` with any Naukri results URL.
- It will not solve CAPTCHAs, OTPs, or answer recruiter questions automatically.
- Jobs with screening questions are marked `skipped` and the queue moves on.
- `Export CSV` downloads the current queue and status log.
- `Clear` removes the local queue from your browser storage.
