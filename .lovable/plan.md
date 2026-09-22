# Natural conversation pacing + rail pinned to the screen edge

Two pieces: the already-approved fix that pins the captured-details rail to the true right edge of the screen, and a rework of how the conversation flows so it feels like a person talking, not a form being filled.

## 1. Rail at the true screen edge (approved, carried forward)

The rail renders mid-screen because it is mounted inside the animated conversation section — the entrance animation makes the browser anchor its "fixed" position to that column instead of the window. Move the mount to the untransformed outer shell so it genuinely floats at the far right edge, vertically centred, and bump the fly-in distance so captured details visibly travel in from off-screen. The conversation column keeps its reserved padding so nothing slides beneath it.

## 2. A conversation that breathes

Today every turn is mechanical: you stop talking, and a beat later MARY instantly fires back one reply that always ends in the next question, in a fixed six-field order. That interrogation rhythm is what feels unnatural. Changes:

- **A human beat before she answers.** After you finish, MARY holds a short thinking moment before speaking — a quick beat after a short answer, a slightly longer one after a long or detailed answer (like a person taking in what you said). Never instant, never identical twice; her presence shows the thinking state during it.
- **Two-beat replies.** Her turn can now land as two short spoken moments — first a genuine reaction to what you said ("Oh nice, clinics are busy"), then the question as a second breath a moment later — instead of one compressed sentence that does both. This alone changes the rhythm from quiz to conversation.
- **Flexible order, real listening.** The six details stop being a rigid checklist order. If you volunteer your name and business in one answer, she takes both and moves on; if your business answer already tells her the industry, she doesn't ask it again — she asks only for what's genuinely missing, in whatever order flows naturally. The goal is a short, warm conversation that ends with everything captured, not six questions asked.
- **Rapport throughout.** She uses your name once she's learned it, reacts to the substance of answers, and varies her question style — the existing wrap ("you're all set — any questions before I finalise your spot?") and single closing line stay as they are.

## Technical notes

- `src/lib/mary.functions.ts`: split her turn into `say` (the reaction) plus an optional `followUp` (the question); relax the fixed collection order in the system prompt — capture whatever is volunteered in any order, ask only for missing fields, never ask about something already implied; keep phases, never-repeat rules, wrap and close.
- `src/components/mary-experience.tsx`: add a jittered thinking beat before speaking (scaled by the length of what you just said), then speak the reaction line, pause briefly, and speak the follow-up as a second line when present; the rail mounts at the shell root; everything else (hands-free, VAD, word-synced reveal, one-screen layout) untouched.
- Verify with Playwright: scripted full conversation capturing the timing and transcript — confirm out-of-order capture works (name+business in one answer), the wrap question and closing line still fire, the rail sits at the window edge, no console errors.
