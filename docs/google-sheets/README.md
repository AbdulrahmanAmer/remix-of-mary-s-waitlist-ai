# Connecting the waitlist to a Google Sheet

MARY saves every conversation to a Google Sheet through a small Apps Script
you deploy once. After that, nothing else to maintain.

## What lands in the sheet

**Waitlist tab** — one row per conversation, kept up to date while it runs:

| Column | What it holds |
| --- | --- |
| First seen / Last updated | When the row was created and last touched |
| Session | The conversation id (row key — never changes) |
| Status | In progress · On the waitlist · Callback requested · Declined · Left mid-conversation |
| Position | The real waitlist position, handed out once when someone joins |
| Name, Email, Phone | Contact details MARY confirmed |
| Business, Industry, Operations | The business, its line of work, how they run leads today |
| Callback requested | Yes / No |
| How it ended | MARY closed the sign-up · Asked to be called back · Declined · Left before the end |
| Summary, Objections, What worked, What stalled | MARY's own one-line debrief of the call |
| Mood | How the person came across (rushed, skeptical, guarded, warm, neutral) |
| Channel | Voice · Typed · Voice + typed |
| Turns, Duration, Started | How long they talked and when |
| Language, Timezone, Page, Referrer, Device | Where they came from and what they used |
| Transcript | The full conversation, `MARY:` / `Guest:` per line |

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
5. **Deploy → New deployment**. Click the gear next to *Select type*, choose
   **Web app**. Set *Execute as*: **Me**. Set *Who has access*: **Anyone**.
   Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. In Lovable, add the secret **`SHEETS_WEBAPP_URL`** with that URL. If you set
   a password in step 3, also add **`SHEETS_WEBAPP_SECRET`** with the same value.

That's it. Have one conversation with MARY on the site and watch the row appear.

Quick checks:

- Open `<your web app URL>?action=ping` in a browser — you should see
  `{"ok":true,"version":...,"leads":0,...}`. An HTML page instead of JSON means
  *Who has access* isn't set to *Anyone*.
- In the app, press **Ctrl/Cmd + Shift + O** (or tap the "omnikom" wordmark in the footer five times on a phone) — the owner view shows whether
  the sheet is connected and how many rows it has.

## Changing the script later

Edit the code, Save, then **Deploy → Manage deployments → ✎ (edit) → Version:
New version → Deploy**. The URL stays the same, so nothing changes in Lovable.

## Notes

- The script never deletes rows. A conversation that continues after a pause
  updates its own row; a finished row is never downgraded by a late update.
- The Transcript cell is capped at 49,000 characters (a Google Sheets limit).
- If you ever need to move to a different spreadsheet, paste its id into
  `SPREADSHEET_ID` at the top of the script.
