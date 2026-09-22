# MARY, rebuilt as a real salesperson

Ten research tasks came back on sales psychology, indirect elicitation, the "reveal" moment, objection handling, voice-conversation design, and hard numbers for the three lanes. This plan turns all of it into one written spec and wires it into the conversation.

Note: she already runs on GPT-6 Astra — confirmed in both places the model is set. No change needed there.

## The core change

Today MARY asks for six things. Tomorrow she has a conversation, and the six things fall out of it without the person noticing they answered anything.

She never asks "what's your name / your business / your industry". Instead she:

- **Guesses and invites correction** — "Sounds like a two or three person shop, right?" People correct a wrong guess instantly; they resist an open question.
- **Labels what she hears** — "Seems like you're the one who ends up chasing those callbacks." They elaborate to be understood.
- **Assumes forward** — "So when a new enquiry lands at nine at night…" The detail arrives inside their answer.
- **Threads back** — picks up something they said three turns ago instead of opening a new line of questioning.
- **Plays back a recap** — "So — you, two agents, mortgages, callbacks by hand." Corrections fill the gaps.
- **Minimises the two asks she can't infer** — email and phone arrive as housekeeping attached to something they want ("so I can send your spot confirmation"), and phone is always offered as skippable.

She takes anything volunteered, in any order, and never asks for something they already implied.

## The reveal

Once she has their name, business, industry and how they operate, she stops and shows them what just happened:

> "Quick thing worth noticing — you never filled in a form, and I've got your name, your firm and exactly where your leads are getting stuck. That's not me being slick. That's Convert, running on you."

Rules from the research, all baked in: it lands only after the value is real, never as an opener, never followed straight by an ask, tone is self-effacing rather than smug, and she states plainly that everything came from this conversation and nothing else — the honesty is what makes it land instead of feeling creepy.

## Then the other two lanes, fast

Two short beats, each tied to what that person actually told her:

- **Cultivate** — the database they already own. "Nine in ten of your past clients say they'd use you again; about one in ten actually does — because nobody called." OmniSuite works that list every day.
- **Recover** — missed calls, no-shows, stalled deals. "Most people who hit voicemail just hang up, and most of those never get a callback." OmniSuite catches all of it.

And throughout, the positioning: OmniSuite is the software running the whole revenue operation across voice, text and email. She is one visible surface of it, not the product.

## Handling anyone

The spec gets a matrix she can draw on live — is this a bot, I hate AI calling my clients, compliance, we already have a CRM, we have ISAs, too expensive, send me an email, we tried AI and it was awful, not the decision maker, hostility, silence, one-word answers, competitor fishing, wants pricing now, refuses email, off-topic. Each with the feeling underneath and a two-sentence reply.

Plus branch handling: the talkative owner, the person in a rush (everything compresses), the skeptic (the reveal itself is the answer), the one who dumps everything at once (she skips straight ahead), the wrong-fit industry (graceful, no forcing).

## Pacing rules

One idea per sentence, turns capped at roughly 25 words, never more than two of her turns without them speaking, an acknowledgement before every new direction, and email and phone read back in natural chunks rather than spelled out robotically.

## Technical notes

- Rewrite `docs/mary-voice.md` as the complete spec: persona and what she never does, eight introduction variants by context, ten positionings of OmniSuite as full software, the elicitation playbook with verbatim lines, the reveal with its timing and tone rules, the Convert/Cultivate/Recover lane scripts with the supporting numbers, the objection matrix, the branch scenarios, pacing rules, and worked end-to-end examples. It is loaded raw as the system prompt, so it is the single source of truth.
- Extend the phase machine in `src/lib/mary-prompt.server.ts`: `WELCOME → DISCOVER → REVEAL → LANES → CONTACT → WRAP → CLOSE`. Phase stops being guessed from punctuation: add `phase` and `revealed` to the turn schema so her own last turn drives the next one, with the captured fields as the fallback signal. Entry and exit conditions per phase, and the existing "you may not close while fields are missing" gate stays.
- Mirror the new schema fields through `src/lib/mary.functions.ts`, `src/lib/mary-stream.ts` and `src/routes/api/turn.ts`. Keep the new fields after `followUp`/`nextField` so the early-`say` streaming detection keeps working.
- No UI changes: same two-beat delivery, same rail, same six dots, same completion gate. The reveal and lane beats are ordinary spoken turns.
- De-duplicate `WAITLIST_FIELDS` and the field labels into one shared export while touching these files, since they currently exist in two copies each and will drift.
- Verify with a scripted conversation at desktop and phone size: a talkative owner, a one-word skeptic, and a rushed caller — confirming she never asks a direct intake question, the reveal fires once after the fourth field, both lanes get named, all six fields land, and the close is clean.
