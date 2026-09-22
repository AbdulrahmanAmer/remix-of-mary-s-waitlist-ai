# No database — keep everything in the browser, and make MARY sharper

## Part 1 — Sign-ups stay in the browser

- When MARY finishes, the person's details (name, email, phone, business, industry, what they run, plus the conversation) are saved instantly in the browser itself. No round trip, no waiting.
- Details are written the moment each one is confirmed, not only at the end — so a dropped call or a refresh never loses what was already said.
- If someone comes back later, MARY recognises what she already knows and doesn't re-ask it.
- The waitlist position is worked out on the spot, so the closing line never stalls.
- A small owner view (a hidden key press on the page) lets you see and export every sign-up collected on that device as a spreadsheet file.
- The Google Sheet path is removed entirely; nothing about sign-ups leaves the browser.

Trade-off worth knowing: entries live on the visitor's own device, so you only see sign-ups made on your machine unless the person exports or you later add a destination. Say the word and I can add an optional one-line send to a sheet in the background, after MARY has already finished — so it never slows her down.

## Part 2 — The remaining conversation gaps

1. **She greets like a person.** A short human hello first, then who she is — never "my name is this and OmniSuite does this and that" in one breath. Several opening variations so it never sounds scripted, and no personal question on the first turn.
2. **She reads intent, not just the funnel.** Every turn is classed first: greeting, an answer, a question back, a correction, an objection, a callback request, a refusal, or leaving. That takes priority over where she is in the sign-up; she can simply acknowledge and let them lead.
3. **She gets the name naturally.** She learns it once there's rapport or when she needs it, with lines like "Sorry, I got ahead of myself — who am I speaking with?" She repeats it back once if unclear, only accepts it when they actually gave it, and handles nicknames, spellings and "close, but…" corrections as corrections.
4. **"Call me back" becomes a real branch.** She stops selling, takes only name and phone, marks the entry as a callback request, and promises only that the request is with the team — no invented time, no claim it worked unless it saved.
5. **Answer first, always.** Questions, skepticism, off-topic turns and corrections get answered before she moves on. She remembers the person's mode — rushed, skeptical, guarded — and adapts. People with no business, or who decline, get a graceful exit instead of the sign-up ladder.
6. **No repeated lines.** The near-duplicate guard is closed on the last path that leaks through, and small "still there?" nudges stay out of the sales transcript.

## Verification

Scripted conversations run end to end: a plain "hi" opener, business-before-name, an unclear then corrected name, a question mid-discovery, a callback with and without details, rushed / skeptical / hostile / talkative people, someone with no business, someone declining, and interruptions during the opening and the callback capture. Plus a refresh mid-conversation to confirm nothing collected is lost.

## Technical details

- Delete `src/lib/waitlist.functions.ts` (server fn + `SHEETS_WEBAPP_URL`); replace with `src/lib/waitlist-store.ts` — a synchronous `localStorage`-backed store (versioned key, schema-validated read, incremental upsert by session id, CSV export). Position computed locally from the existing email hash.
- `mary-experience.tsx` writes through the store on every grounded field and on completion; completion no longer awaits a network call.
- MARY's turn calls still run server-side (the model key must stay off the client) — unchanged.
- Conversation work: opener variants + callback branch + answer-first rules in `docs/mary-voice.md`; `intent` enum and `callbackRequested` in the turn schema, explicit wrap marker replacing the `includes("?")` heuristic, N/A path in `discoveryDone` (`mary-prompt.server.ts`, `mary.functions.ts`); name branch in `mary-grounding.ts` honours `nameEvidence`, adds a fuzzy/confirmation path and fixes `AFFIRMATION_START` misfiring on "close, but…".
- No visual redesign.
