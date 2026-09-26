# Condensed Retell playbook: what it is and how to test it

`retell/playbook-condensed.md` is the Retell-native version of MARY's playbook (`docs/mary-voice.md`), written for Option B (Retell's own LLM) so the general prompt stays under Retell's 4,000-token billing line.

## Size and cost

Measured with the builder's own rule, `ceil(chars / 4)`:

| Prompt                                    | Characters | Tokens (est.) | Billing multiplier |
| ----------------------------------------- | ---------- | ------------- | ------------------ |
| `docs/mary-voice.md` + prompt header      | ~32,900    | ~8,200        | ~2.05x             |
| `retell/playbook-condensed.md` (this one) | 12,622     | 3,156         | 1.0x               |

Retell counts the general prompt, the tool descriptions, the transcript and the tool-call history toward the 4,000 (`retell/docs/billing-exceptions.md`, rule 2). The tool JSON from the design (`save_lead`, `note_details`, `end_call`) measures about 1,030 tokens by the same rule, so prompt plus tools sits right at the line and a typical two-to-four-minute call bills at roughly 1.0x to 1.2x instead of 2x. Trimming the tool descriptions (they repeat rules the playbook already states) is the cheapest further saving. Keep this file under 12,800 characters and re-measure after any edit: `node -e 'const t=require("fs").readFileSync("retell/playbook-condensed.md","utf8");console.log(t.length, Math.ceil(t.length/4))'`.

A guard for the builder's test file (`tests/unit/retell-config.test.ts`, owned by the config package), to paste next to the checks on the full playbook:

```ts
const condensed = readFileSync("retell/playbook-condensed.md", "utf8");
expect(condensed.length).toBeLessThanOrEqual(12_800);
expect(condensed).toContain("{{known_summary}}");
expect(condensed.trimEnd().endsWith("{{field_notes}}")).toBe(true);
for (const tool of ["save_lead", "note_details", "end_call"]) expect(condensed).toContain(tool);
for (const gone of ["followUp", "hold the button", "holding a button", "Set complete true"])
  expect(condensed).not.toContain(gone);
for (const v of condensed.match(/\{\{[a-z_]+\}\}/g) ?? [])
  expect(DYNAMIC_VARIABLES).toContain(v.slice(2, -2));
```

## How the file is meant to be used

- It is the **whole** `general_prompt`. It already carries the operating rules that `retell/prompt-header.md` (design A, section 7.3) would add: the typed-text prefix, no button, the phase list, the tool triggers, `{{known_summary}}`, and it ends with `{{field_notes}}`. Do not prepend the header or append a second field-notes block: the header still requires business, industry and operations before the close and still ends on the old fixed close line, both of which this playbook replaces.
- `begin_message` is `{{opening_line}}`, one of `OPENING_LINES` in `src/lib/retell-shared.ts` (or the welcome-back line), and each now says what they get and how long, as the playbook assumes. Retell's 10-second minimum applies only to an LLM-generated opener, not to a variable in a fixed message.
- Agent settings the silence rules rely on, set in `retell/agent.json`: `reminder_trigger_ms: 8000`, `reminder_max_count: 2`, `end_call_after_silence_ms: 45000`. Retell's defaults are 10 s, 1 and 10 min.
- Tools are the ones in `src/lib/retell-shared.ts`: `note_details` (name, business, industry, operations, each with `*_evidence`), `save_lead` (stage `final` or `callback`, every field plus evidence, `callback_requested`) and `end_call`. The playbook reads `saved`, `position`, `missing` and `rejected` from the function result.
- The fast lane (calls 2, 3, 11B) relies on the save-lead handler accepting stage `final` with only a confirmed name and email; `groundSaveLead` in `src/lib/retell-lead.server.ts` does (an ungrounded detail other than the phone holds the save once, so the agent asks plainly or drops it).
- Agent Handbook presets: keep "AI disclosure when asked" on; "Echo verification" is optional (the playbook already reads emails back). Leave "Natural filler words" off.

## What changed versus `docs/mary-voice.md`

Every fix from the conversation lens of the 2026-09-26 audit is in the prompt text, not in code:

| Audit finding                                        | Where it lives in the condensed playbook                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No fast lane for name + email leavers (P0)           | The call, step 2 FAST LANE; "Nobody who gave name and email leaves without a spot"; Tools, save_lead       |
| Email asked last (P1)                                | Step 4 REVEAL asks for the email in the same turn; FAST LANE asks right after the name                     |
| Visitors with no business can never join (P1)        | Drawing details out, last sentence; FAST LANE lists "no business"                                          |
| Email accepted without a check (P1)                  | Step 5 EMAIL CHECK: chunks, spelling, "Did I get that right?", type it after two misses                    |
| False promises: confirmation email, "with the team"  | "Your invite comes to that email"; "Never say saved, recorded or 'with the team' before saved true"        |
| Opener never says what they get or how long (P1)     | The call, second paragraph, plus the recommended `begin_message` above                                     |
| Grounding: vague industry, sideways yes, invented    | Knowing versus guessing: quote or you don't have it, vague is not an industry, sideways reply is an answer |
| Silence handling unreachable (P2)                    | Every turn: the two reminder lines, close as signed up when name and email are held                        |
| Contradictions: reveal vs drive rule, phase lag (P2) | REVEAL ends on the email ask; "If their last message supplies the last missing detail, act now"            |
| Rushed visitor gets the full pitch, lanes replay     | LANES: skip when rushed or after a cut-in; either word heard counts as done                                |
| Close gives no recap or next step (P2)               | Step 7 WRAP recap; step 8 CLOSE with first name, position only from the result, next step                  |
| Hold-button lines, `say`/`followUp` fields (P2)      | Gone; Style guardrails describe the typed-text prefix and "there is no button"                             |
| Phone never offered when the email came early (P3)   | Step 5: phone offered once after the email check, whatever the phase                                       |

Kept from the original on purpose: identity and traits, the three loops and their public lines, the differences list, the CRM names, the planned pricing tiers and the rule to say them once, the sales numbers, the eight elicitation moves, "Convert" said exactly once, both lane words spoken, and every quick answer that a stand visitor actually asks.

## Running the scripted calls

Run them on the published site with `?voice=retell` (desktop Chrome first, then iPhone Safari), or paste each persona and success criteria into Retell's LLM simulation tests (`ux-audit/conversation/test_llm-simulation-testing.md` in the audit scratchpad describes the format). For every call, afterwards open the call in the Retell dashboard and check the function calls tab: the arguments of `note_details` and `save_lead` are the record, and each `*_evidence` must be a verbatim quote from a visitor line. Then check the Google Sheet row.

Common fail conditions, applied to every call: two questions in one turn; a turn over about thirty-five words; any question about something the visitor already said; a tool, field or JSON name spoken aloud; a vendor named; a position number that `save_lead` did not return; "saved", "recorded" or "with the team" before the tool answered; `end_call` before a started `save_lead` returned.

### 1. Talkative owner, the full path

- Persona: Sarah, Brightpath Realty, four agents. Lines, in order: "Sarah." / "We run a real estate team, four agents. Zillow leads at nine at night sit till morning, and our old database just sits there." / (after the reveal) "sarah at brightpath dot com" / "Yes." / "No number, email's fine." / (after the lanes) "Sounds good." / (wrap) "No questions."
- Expected path: name from the opener answer; one or two discovery turns that react to her words and sell one point each; `note_details` before the reveal; reveal says "Convert" once and ends on the email ask; readback plus "Did I get that right?"; phone offered once; LANES naming Cultivate and Recover; WRAP recap says Sarah, Brightpath Realty and the email; `save_lead` stage `final`; close with her first name, the position only if returned, the next step; `end_call`.
- Must be recorded: name "Sarah" (evidence "Sarah"), business "Brightpath Realty", industry "real estate" (evidence "real estate team"), operations about Zillow leads sitting overnight and the idle database, email `sarah@brightpath.com`, phone "skipped".
- Fail if: the reveal comes before `note_details` returned complete; the email is asked after the lanes; the close says "confirmation email" or "a product by Omnikom".

### 2. Fast lane: name and email, in a hurry

- Persona: Dana. One line after the opener: "I'm Dana. Look, I've only got a minute, can you just put me on the list? It's dana k at gmail dot com." Then "Yes, that's right."
- Expected path: no discovery question at all; readback "d-a-n-a-k, at gmail dot com — did I get that right?"; `save_lead` stage `final` with name and email only; close; `end_call`. At most three MARY turns after the opener.
- Must be recorded: name "Dana", email `danak@gmail.com`, no business, industry or operations, stage `final`, outcome signed up (partial profile).
- Fail if: "To finish, what's the business?" or any equivalent; the call ends as declined; a position is spoken without one in the result.

### 3. No business at all

- Persona: Priya, a student. "I'm Priya. I don't have a business, I'm a student, just curious about the AI." Then her email when asked, then "Yes."
- Expected path: one warm line that does not invent a business; the email ask tied to the spot; readback and check; `save_lead` final; close; `end_call`. No reveal, no lanes.
- Must be recorded: name "Priya", her email, nothing in business, industry or operations.
- Fail if: an industry is guessed or recorded; the call ends as declined or with "no spot reserved".

### 4. "What is this?" before anything else

- Persona: a browser who missed the opener. "Um, sorry, what is this exactly? What am I signing up for?" Then "Okay, I'm Tom." and continue as call 2 (email, "yes").
- Expected path: one plain answer (early access to OmniSuite, about two minutes, what it does) and a landing on the name in the same turn; then the fast lane.
- Must be recorded: name "Tom", his email.
- Fail if: the answer is a pitch longer than two sentences; the offer is repeated again later; the name question is skipped.

### 5. Price first, everything dumped at once

- Persona: Dana again, but talkative. After the name: "Bright Smile Dental, two locations. Leads come from Google ads and the front desk calls them back when they get a chance. What does it cost?" Then her email and "Yes."
- Expected path: the price answered once (Growth at five ninety-seven fits two locations; Core is acceptable), as planned pricing with final details in the invite; then straight to `note_details` and the reveal with the email ask, no further discovery question.
- Must be recorded: business "Bright Smile Dental" (evidence in her words), industry "dental" (evidence "Bright Smile Dental"), operations about Google ads and the front desk calling back, plus name and email.
- Fail if: the price is repeated later; credits, minutes or per-use costs are mentioned; a discovery question follows a message that already answered it.

### 6. Vague industry

- Persona: Sam. "I run a small practice." Only after a narrowing question: "Dental, two chairs, I own it." Then a line about operations if asked ("Front desk chases everything by hand."), then email.
- Expected path: one warm reaction and one narrowing question ("What kind of practice?"); nothing recorded for industry until "Dental"; `note_details` after operations; reveal; email.
- Must be recorded: industry "dental" with evidence containing "Dental", business from his words only (or missing, if he never names it, in which case `note_details` reports it missing and she asks plainly).
- Fail if: `note_details` or `save_lead` carries an industry before "Dental" was said; she guesses medical, legal or dental from "practice".

### 7. Sideways answer to a guess

- Persona: Chris. "We get about forty leads a month from Facebook ads, my wife and I run it." If MARY guesses a vertical (real estate, mortgages, anything), answer: "You know, we mostly do cars." If she asks plainly, answer the same.
- Expected path: the reply is treated as an answer, not a yes; industry recorded from "we mostly do cars"; the point she sells next is about cars, not houses.
- Must be recorded: industry "automotive" or "cars" with evidence "we mostly do cars"; operations about Facebook ads and the two of them.
- Fail if: "real estate" appears in any tool argument; she keeps selling to the guessed vertical.

### 8. Callback request mid-call

- Persona: Leo, a couple of discovery turns in ("Marsh Plumbing, mostly emergency call-outs"). Then: "Actually, can someone from the team just call me? I'm at the stand." Then, when asked, "Four one five, five five five, oh one nine nine."
- Expected path: selling stops at once; the number asked in one turn (the name is already known); `save_lead` stage `callback` with `callback_requested: true`; only after `saved: true`, "it's with the team" plus a short goodbye; `end_call`.
- Must be recorded: name "Leo", phone digits, business "Marsh Plumbing", industry "plumbing" with evidence, stage `callback`.
- Fail if: any day or time is promised; email, industry or operations are asked after the request; "with the team" is said before the tool returned; the reveal or lanes are delivered.

### 9. The skeptic at the stand

- Persona: Mark, Cool Air Co. "So what is this, another AI dialer?" / "HVAC. Three trucks." / "Yeah, and the phone rings out when we're on jobs." / "Cool Air Co. I'm Mark." / email / "Yes."
- Expected path: "AI, yes — a dialer, no" in substance, then one specific question; no reveal until name, business, industry and operations are all in his words and `note_details` returned complete; the reveal answers the skepticism; email ask in the same turn.
- Must be recorded: name "Mark", business "Cool Air Co", industry "HVAC", operations about the phone ringing out on jobs, each with a quote.
- Fail if: a hype word; a reveal before "Cool Air Co. I'm Mark"; she argues instead of letting the reveal answer.

### 10. Email that speech-to-text gets wrong twice

- Persona: Maya. After the reveal, say quickly and quietly: "m dot okonkwo underscore seven at proton dot me". Answer "No" to the first two readbacks whatever they are. When asked to type, type `m.okonkwo_7@proton.me` in the box.
- Expected path: readback with spelling, "Did I get that right?"; after the second "no", she asks her to type it; the typed text arrives with the "The visitor typed this instead of saying it:" prefix and is used as is; `save_lead` final with that address.
- Must be recorded: email exactly `m.okonkwo_7@proton.me`.
- Fail if: a third spoken attempt; a guessed address is saved; she asks her to spell it again after it was typed.

### 11. Silence after the reveal (two variants)

- Persona: Jordan, a full discovery path, then silence.
  - A: go silent right after the reveal's email ask and stay silent.
  - B: give the email and confirm it, then go silent after the lanes.
- Expected path: about 8 s in, reminder one restates the email question more simply; about 8 s later, reminder two offers the exit ("I'll hold your spot if you give me an email — or type it below"). In A, nothing is saved and the call ends after the 45 s silence limit. In B, she closes as signed up: `save_lead` final, the close line, `end_call`.
- Must be recorded: A, nothing (the webhook debrief only); B, a final row with name, email, business, industry and operations.
- Fail if: reminders keep pitching; A ends with a spoken "saved"; B waits for the wrap answer instead of closing.

### 12. Returning visitor with a known summary

- Persona: Leo, second visit. The web-call `known` carries name "Leo", industry "plumbing" and email `leo@marshplumbing.com`, so `known_summary` reads "name: Leo; industry: plumbing; email: leo@marshplumbing.com". Say "Hey, it's Leo again." then answer only what she asks (business name, operations), then "Yes" to the email readback.
- Expected path: no question about his name, industry or email; discovery covers only business and operations; `note_details` includes the known fields; the email is read back exactly once before `save_lead` final.
- Must be recorded: all six fields except phone, with the known three unchanged.
- Fail if: any known field is asked again; the email is asked from scratch; the known industry is dropped from the tool arguments.

## If there is time

Not in the twelve, but each caught a failure in the audit: a hostile troll ("this is garbage, hang up") should get one calm line, an offer to go, and `end_call` with no save; a cut-in during the lanes should not replay them; "Is this a bot?" should get the AI line and continue; "Which CRMs?" should name the five and ask which one they are on.
