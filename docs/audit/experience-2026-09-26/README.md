# Waitlist experience audit, 2026-09-26 (checkpoint)

Seven lenses (funnel, conversation, visual, reliability, leads, market, mobile) audited the
live site and the code; their findings were merged into 85 items (UX-01...). This checkpoint
was taken during the Verify step (12 verdicts in), before the Plan and critic steps.

- `lenses.json`: each lens's raw findings and summary.
- `merged-findings.json`: the deduplicated list with evidence, impact, recommendation, effort.
- `verdicts.json`: skeptic verdicts for the findings verified so far.
- `index.md` below: id, severity, title, verification state.

The five fix packages on PR #2 (bfb87c7 Retell playbook, 35e5126 conversation, f511644 call
reliability, b991dc7 leads, 344e40f screen) were built from the lens findings, so most P0/P1
items are addressed there. Nobody has yet mapped each id to the commit that fixes it; that was
the Plan step. UX-01 (no Google Sheet connected) is an operator action, not code.

Resume (same Claude session only): `Workflow({scriptPath: "<session>/workflows/scripts/waitlist-experience-audit-wf_b7f8d06b-fd9.js", resumeFromRunId: "wf_b7f8d06b-fd9"})`;
finished agents replay from cache. In a new session, run only the Plan step by hand from
`merged-findings.json` + `verdicts.json`.

| id    | severity | title                                                                                                          | state            |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| UX-01 | P0       | Live site delivers zero leads: the Google Sheet is still not connected, so every lead lives only in the visito | confirmed        |
| UX-02 | P0       | Every visitor is told 'Early access confirmed' with a made-up position number, whether or not anything was sav | confirmed        |
| UX-03 | P0       | No fast lane: a visitor who gives name and email and wants to leave is recorded as 'declined' and told 'No spo | confirmed        |
| UX-04 | P0       | During an AI outage MARY loops on apologies, typed answers get no reply, and there is no way to leave details  | confirmed        |
| UX-05 | P1       | The email is asked for last, after discovery, the reveal and the lanes pitch, so anyone who drops mid-call lea | confirmed        |
| UX-06 | P1       | A failed final save is sent once and never retried, and the per-IP limit can reject it at a busy venue         | confirmed        |
| UX-07 | P1       | Mic denied, missing or blocked by an in-app browser: the correct message is overwritten by a generic one that  | refuted          |
| UX-08 | P1       | The first 16-18 s: about 4.5 s of silence after Start, then a 10 s jargon opener from the LLM before her first | confirmed        |
| UX-09 | P1       | A tap or brush on the big Hold button while MARY talks or thinks cuts her off, drops her question and loses wh | confirmed        |
| UX-10 | P1       | MARY promises an early-access confirmation email that nothing ever sends                                       | confirmed        |
| UX-11 | P1       | Emails are never validated, read back or correctable: grounding accepts an invented domain, and the visitor ca | confirmed        |
| UX-12 | P1       | No notice before the mic opens that MARY is an AI, that the call is recorded and transcribed, or how the data  | confirmed        |
| UX-13 | P1       | The fixed-height caption box clips content: on phones the visitor's echo and 'Show conversation' vanish on two | not verified yet |
| UX-14 | P1       | The live UI is built from code that is in no git ref (44 className differences), so publishing PR #2 as-is wou | not verified yet |
| UX-15 | P1       | Every turn takes 2.4-7.6 s to MARY's first text, before speech-to-text and TTS are added, with only a thinking | not verified yet |
| UX-16 | P1       | The near-repeat filter over-fires on normal short replies, adds an extra LLM call, and can swallow her reply e | not verified yet |
| UX-17 | P1       | One hung request freezes the call for good, and messages typed in the meantime vanish                          | not verified yet |
| UX-18 | P1       | A failed transcription blames the visitor, and any empty transcript leaves 'Thinking…' stuck                   | not verified yet |
| UX-19 | P1       | Nobody is told when a lead or a callback request arrives                                                       | not verified yet |
| UX-20 | P1       | Visitors with no business (students, job-seekers, the curious) can never join, contradicting the playbook      | not verified yet |
| UX-21 | P1       | There is no way to end the call; closing the tab silently saves the partial transcript                         | not verified yet |
| UX-22 | P1       | Grounding records business and industry values that the quoted words don't support ('dental' from 'a small pra | not verified yet |
| UX-23 | P1       | Sideways replies count as 'yes' and confirm her guess, bypassing the real-estate guard                         | not verified yet |
| UX-24 | P1       | The Retell migration can silently lose MARY's captions, live progress pills and the orb's 'hearing you' state  | not verified yet |
| UX-25 | P1       | Retell path: save_lead and the webhook need a durability guarantee before go-live                              | not verified yet |
| UX-26 | P2       | The iPhone 'Can't hear her?' row shows from second 0 for three answers: it squeezes out her question, makes th | not verified yet |
| UX-27 | P2       | 'Type instead' opens a voice call: MARY speaks aloud, Hold stays the main control, and the copy says to hold   | not verified yet |
| UX-28 | P2       | Tapping Start twice while the mic prompt is open opens two mics and runs two welcomes, so MARY asks the name t | not verified yet |
| UX-29 | P2       | Silence is never handled: no nudge after a statement, no timeout when the visitor walks away, and Retell's def | not verified yet |
| UX-30 | P2       | A reload restarts the pitch, the next person on a shared device inherits the previous visitor's details, and b | not verified yet |
| UX-31 | P2       | Anyone can write rows into the sheet, including spreadsheet formulas                                           | not verified yet |
| UX-32 | P2       | Visitors whose browser blocks storage all share one sheet row named 'session'                                  | not verified yet |
| UX-33 | P2       | The same person gets several rows and several positions                                                        | not verified yet |
| UX-34 | P2       | One over-long field makes the server reject the whole lead                                                     | not verified yet |
| UX-35 | P2       | No product telemetry: outages and funnel drop-off are invisible                                                | not verified yet |
| UX-36 | P2       | Screen wake lock: missing from the live build, silent when refused, and not provided by the Retell SDK         | not verified yet |
| UX-37 | P2       | In-app browser detection misses TikTok and Android WebViews, and nothing warns the visitor before they tap Sta | not verified yet |
| UX-38 | P2       | In hold mode nothing notices the mic being muted or taken (AirPods switch, incoming call, Siri), and MARY then | not verified yet |
| UX-39 | P2       | Going offline mid-call is reported as a server snag and a broken microphone, and the error stays after recover | not verified yet |
| UX-40 | P2       | When the speech service hangs, every line sits dim for about 9 s, and during outages the screen gives conflict | not verified yet |
| UX-41 | P2       | One 'not now' ends the funnel with no lighter option to capture                                                | not verified yet |
| UX-42 | P2       | A rushed visitor still gets the full pitch, and a cut-in during the lanes pitch replays it                     | not verified yet |
| UX-43 | P2       | The close doesn't read the details back and gives no concrete next step or position                            | not verified yet |
| UX-44 | P2       | The prompt contradicts itself: reveal vs drive rule, followUp null, word cap, and worked examples that can't h | not verified yet |
| UX-45 | P2       | Porting the playbook to Retell as it is would raise the per-minute cost and keep lines that tell people to hol | not verified yet |
| UX-46 | P2       | The landing page doesn't prepare visitors for the mic prompt, what MARY will ask, or how long the call really  | not verified yet |
| UX-47 | P2       | The 'your turn' cue is an 11 px grey line, and the big button looks the same whether MARY is talking or waitin | not verified yet |
| UX-48 | P2       | Hold-to-talk is the default, while the market standard is an open mic you can interrupt                        | not verified yet |
| UX-49 | P2       | A fixed boot screen and staggered entrance animations hold back the Start button by about 1.7 s after first pa | not verified yet |
| UX-50 | P2       | Share previews and the canonical URL point to omnisuite.omnikom.ai, a domain that does not exist (NXDOMAIN)    | not verified yet |
| UX-51 | P2       | The live typing box is 14 px on phones, so iPhone Safari zooms the whole call screen when it is tapped         | not verified yet |
| UX-52 | P2       | Emails and phone numbers typed on a phone get iOS auto-capitalisation and autocorrect, and no email or number  | not verified yet |
| UX-53 | P2       | The end screen offers no next action: no share link, and no booking slot for callbacks                         | not verified yet |
| UX-54 | P2       | No 'all lines busy' state: Retell allows 20 concurrent calls by default, and a launch spike will exceed that   | not verified yet |
| UX-55 | P2       | MARY goes silent while save_lead runs; Retell's speak-during-execution and filler speech can cover it          | not verified yet |
| UX-56 | P2       | Build the Retell path on SDK 3.x now: 2.x and /v2/create-web-call are deprecated on 2026-09-30, and 3.0.1 answ | not verified yet |
| UX-57 | P2       | Retell's audio on iPhone has a recent report of playing through the earpiece, and the page cannot detect it    | not verified yet |
| UX-58 | P2       | With Retell, leaving the app for more than 45 seconds (for example to copy an email) ends the call, where MARY | not verified yet |
| UX-59 | P2       | Real-device checks are still missing for the no-mic path under the silent switch, AirPods mid-call, the Instag | not verified yet |
| UX-60 | P2       | Prompt changes reach visitors untested; use Retell's simulation testing, versioning and live monitoring to gua | not verified yet |
| UX-61 | P2       | Offer 'Call me instead' (a real phone call) for in-app browsers and failed audio, as Retell's own demo does    | not verified yet |
| UX-62 | P2       | The Apps Script that is deployed is not the one in the repo                                                    | not verified yet |
| UX-63 | P2       | The previous caption ghosts over the new one for about 330 ms on every turn, even with reduced motion          | not verified yet |
| UX-64 | P2       | Focus falls to <body> at every screen change, the call screen has no heading, and 'You're on the list' is neve | not verified yet |
| UX-65 | P2       | The 'Conversation so far' panel is not a real modal, and focus is pulled into the composer behind it           | not verified yet |
| UX-66 | P2       | The screen reader reads MARY's whole line the instant her voice starts, so two voices talk over each other     | not verified yet |
| UX-67 | P2       | Words MARY has not spoken yet sit at 1.57:1 contrast (axe: serious)                                            | not verified yet |
| UX-68 | P2       | Key call-screen guidance is 9.9 px on phones (live)                                                            | not verified yet |
| UX-69 | P2       | Recovery and header controls are below comfortable tap size                                                    | not verified yet |
| UX-70 | P2       | The progress pills read as a six-field form: they overflow off-screen without a cue, show the optional phone a | not verified yet |
| UX-71 | P2       | motion/react ignores prefers-reduced-motion: the orb still flies and scales between screens                    | not verified yet |
| UX-72 | P2       | The orb redraws at 60 fps in every state, forever, including on the static end screen                          | not verified yet |
| UX-73 | P2       | Tablet landing: MARY's preview card is cut off at the right edge from 640 to about 830 px wide                 | not verified yet |
| UX-74 | P3       | The phone number is never offered when the email arrives before the email-ask step                             | not verified yet |
| UX-75 | P3       | A callback request can't finish without a phone number                                                         | not verified yet |
| UX-76 | P3       | Retry notices stay on screen after the visitor switches to typing                                              | not verified yet |
| UX-77 | P3       | Three to four 'thinking' signals and a stack of small status lines compete during a turn                       | not verified yet |
| UX-78 | P3       | Header controls are inconsistent and cryptic on phones, and the talk-mode toggle breaks the ARIA toggle patter | not verified yet |
| UX-79 | P3       | End screen: the email breaks mid-word, and at 1440x900 the restart link is below the fold                      | not verified yet |
| UX-80 | P3       | Safe-area insets are ignored: in landscape and home-screen mode the notch and status bar overlap the header an | not verified yet |
| UX-81 | P3       | Brand words (OmniSuite, Omnikom, MARY) are not given to speech recognition or TTS                              | not verified yet |
| UX-82 | P3       | No post-call feedback or sentiment signal; Retell's post-call analysis provides one for free                   | not verified yet |
| UX-83 | P3       | Retell voice settings: test Expressive Mode and dynamic speed, but keep the Colloquial Model away from confirm | not verified yet |
| UX-84 | P3       | No dark theme, and the browser theme-color does not match the page background                                  | not verified yet |
| UX-85 | P3       | The gap register the docs rely on is not in the repo                                                           | not verified yet |
