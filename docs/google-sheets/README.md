# Connecting the waitlist to a Google Sheet

MARY saves every conversation to a Google Sheet through a small Apps Script
you deploy once. After that, nothing else to maintain.

## What lands in the sheet

**Waitlist tab** — one row per conversation, kept up to date while it runs:

| Column                                         | What it holds                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| First seen / Last updated                      | When the row was created and last touched                                              |
| Session                                        | The conversation id (row key — never changes)                                          |
| Status                                         | In progress · On the waitlist · Callback requested · Declined · Left mid-conversation  |
| Position                                       | The real waitlist position, handed out once when someone joins                         |
| Name, Email, Phone                             | Contact details MARY confirmed                                                         |
| Business, Industry, Operations                 | The business, its line of work, how they run leads today                               |
| Callback requested                             | Yes / No                                                                               |
| How it ended                                   | MARY closed the sign-up · Asked to be called back · Declined · Left before the end     |
| Summary, Objections, What worked, What stalled | MARY's own one-line debrief of the call                                                |
| Mood                                           | How the person came across (rushed, skeptical, guarded, warm, neutral)                 |
| Channel                                        | Voice · Typed · Voice + typed                                                          |
| Turns, Duration, Started                       | How long they talked and when                                                          |
| Language, Timezone, Page, Referrer, Device     | Where they came from and what they used                                                |
| Transcript                                     | The full conversation, `MARY:` / `Guest:` per line                                     |
| Confirmation sent                              | Which address(es) got the confirmation email and when — empty until you switch that on |

**Experience tab** — MARY's field notes: short lessons she writes after each
conversation (no names, emails or numbers). The app reads them back so she
gets better across every visitor, not just on one device.

**Activity tab** — a rolling log of every request, useful if something looks off.

## Set-up (about five minutes)

1. Create a Google Sheet (any name) — or open the one you want to use.
2. In the sheet: **Extensions → Apps Script**. Delete everything in the editor,
   paste the whole contents of `Code.gs`, and press **Save** (the disk icon).
3. Optional: near the top of the code, set `SHARED_SECRET = "a-long-password"`
   and, if you already have sign-ups counted elsewhere, `POSITION_START`.
4. Run it once: choose **setup** in the function dropdown, press **Run**, and
   approve the permissions (it only touches this spreadsheet). The three tabs appear.
5. **Deploy → New deployment**. Click the gear next to _Select type_, choose
   **Web app**. Set _Execute as_: **Me**. Set _Who has access_: **Anyone**.
   Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. In Lovable, add the secret **`SHEETS_WEBAPP_URL`** with that URL. If you set
   a password in step 3, also add **`SHEETS_WEBAPP_SECRET`** with the same value.

That's it. Have one conversation with MARY on the site and watch the row appear.

Quick checks:

- Open `<your web app URL>?action=ping` in a browser — you should see
  `{"ok":true,"version":...,"leads":0,...}`. An HTML page instead of JSON means
  _Who has access_ isn't set to _Anyone_.
- In the app, press **Ctrl/Cmd + Shift + O** (or tap the "omnikom" wordmark in the footer five times on a phone) — the owner view shows whether
  the sheet is connected and how many rows it has.

## What the visitor sees, and what it means

The end screen only ever shows what the sheet answered:

- **"You're on the list" with a position number** — the row was written and the
  sheet handed out that position. This is the only place a position comes from.
- **"You're on the list" without a number** — the row was written; the sheet
  gave no position (an older script version, for example).
- **"Almost there — one more step"** — the row did **not** reach the sheet:
  either `SHEETS_WEBAPP_URL` is not set (the visitor is told the list "isn't
  taking sign-ups from this page yet") or the sheet did not answer. The details
  stay in that browser's outbox and go again on their own (next visit, back
  online, tab looked at again), or when the visitor taps **Try again**. The
  server log also gets one line per unstored lead (`[mary] lead not stored …`)
  so nothing is silently lost.

Visitors can correct a misheard name, email or phone right on the end screen;
the corrected row is sent again under the same session id, so it updates the
existing row rather than adding one.

## Confirmation email (optional, off by default)

The script can email the visitor the first time their row lands on the
waitlist — a plain-text note with their position (if any) and the details MARY
noted, sent from your Google account. It is off unless you switch it on:

1. Paste the current `Code.gs` (it adds a **Confirmation sent** column on its own).
2. In the Apps Script editor choose **testConfirmationEmail** in the function
   dropdown and press **Run**. Approve the new permission (_Send email as you_)
   — the web app cannot send mail until you have. A test copy lands in your
   own inbox, so you can read the template.
3. **Project Settings (gear) → Script properties → Add script property**:
   - `CONFIRMATION_EMAIL` = `on` — the switch. Anything else, or unset, sends nothing.
   - `CONFIRMATION_REPLY_TO` = an address replies should go to (optional; the
     template invites the visitor to reply if a detail is wrong).
   - `CONFIRMATION_SUBJECT` and `CONFIRMATION_FROM_NAME` (optional overrides).
4. Redeploy — see "Changing the script later" below. Properties take effect
   immediately; the code only after the new version is deployed.

Rules the script follows: one email per address, at most two per row (the
address first heard plus one correction), only when the status is _On the
waitlist_, and never for callbacks or partial rows. A failed send is logged in
the Activity tab and never blocks the row. `?action=ping` reports
`confirmationEmail: true/false`, and the owner view in the app shows it too.

Quotas: a consumer Gmail account may send about 100 emails a day through
Apps Script, a Google Workspace account about 1,500. Run
`testConfirmationEmail` to see the remaining quota in the log.

## Changing the script later

Edit the code, Save, then **Deploy → Manage deployments → ✎ (edit) → Version:
New version → Deploy**. The URL stays the same, so nothing changes in Lovable.
If the new code needs a permission the old one did not (sending mail, for
instance), run any function from the editor once first and approve it;
otherwise the deployed web app fails silently on that step.

## Notes

- The script never deletes rows. A conversation that continues after a pause
  updates its own row; a finished row is never downgraded by a late update.
- Rows are keyed by session id, so a browser retrying a row it could not
  deliver earlier updates the same row — it never adds a duplicate.
- The Transcript cell is capped at 49,000 characters (a Google Sheets limit).
- If you ever need to move to a different spreadsheet, paste its id into
  `SPREADSHEET_ID` at the top of the script.
