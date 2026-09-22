# Conference readiness: 20-angle end-to-end audit

Goal: anyone who opens the link on any phone or laptop at the conference reaches MARY, hears her, talks or types, and lands in the waitlist — with no permission dead-ends.

## How this runs

Twenty parallel investigations, each with its own angle and its own reviewer mindset. Each one must come back with: what it checked, what it found, evidence, and either "clear" or a concrete fix. Anything that can be reproduced in a real browser gets reproduced, not reasoned about.

## The twenty angles

Access and delivery
1. First-visit skeptic — cold load on the published link: nothing cached, nothing warmed, no prior permission.
2. The published build — checks the production build behaves like preview (no dev-only paths, no missing assets).
3. Custom domain and link sharing — the domain swap, link previews, QR-scan entry from a phone camera.
4. Conference network — slow, throttled, and flaky connections; what she does while audio is starving.

Permissions and devices
5. iPhone Safari — tap-to-start, audio unlock, silent switch, low-power mode.
6. Android Chrome — permission prompt timing, re-prompt after denial.
7. In-app browsers — Instagram, LinkedIn, X, WhatsApp, where the mic is often blocked outright.
8. Desktop Safari and Firefox — the browsers with no speech recognition; typing must be seamless, not a fallback that feels broken.
9. Permission denier — refuses the mic, then changes their mind: is there a clean way back in?
10. Hardware chaos — bluetooth headset connect/disconnect mid-call, another app holding the mic, no mic at all.

The conversation itself
11. Interrupter — cuts her off constantly.
12. Silent visitor — says nothing for a long stretch.
13. Hostile/skeptical visitor — pushes back, tests her, tries to derail.
14. Off-script visitor — wrong language, gibberish, one-word answers, joke answers.
15. Callback requester and decliner — both non-signup endings close cleanly.
16. Happy path, repeated — ten consecutive sign-ups; does quality hold, does she repeat herself.

The plumbing
17. Data capture — every completed conversation produces a complete, correct record.
18. Google Sheet path — end-to-end once the script is deployed, plus what happens while it isn't.
19. Interruption and recovery — refresh mid-call, background the tab, lock the screen, return.
20. Abuse and edge safety — very long input, pasted junk, rapid repeat visits, two tabs at once.

## What gets fixed in this pass

Anything an angle finds that blocks a visitor from starting, hearing, replying, or finishing. Cosmetic nits get listed, not fixed, unless they are visible on a phone at the conference.

## Known open item

The Google Sheet is still not connected — `SHEETS_WEBAPP_URL` isn't set. Angle 18 will verify both states, but the live sheet can only be confirmed after the script is deployed and the address is added. Everything else works without it; waitlist records stay in the browser until then.

## Deliverable

One report: per angle — clear or fixed, with what was changed. Plus a short "day of the conference" checklist: what to open, what to check in the first two minutes, and what to do if the room's network is bad.
