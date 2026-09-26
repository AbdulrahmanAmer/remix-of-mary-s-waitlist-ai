# MARY on Retell - the built, dormant voice path

Status: BUILT, DORMANT. The code sits behind `VOICE_PROVIDER` and the Retell keys; with none of
them set the app behaves exactly as before. Going live waits on the operator's Retell account
(section 10, and `retell/README.md`). Diagram: `retell-target.mmd`. `diagram.retell.png` is the
render of the 2026-09-23 design and is stale.

Written 2026-09-26 against the code and the SDK sources (`retell-client-js-sdk` 3.0.1, `retell-sdk`
6.0.1). Everything in section 9 has not run against a real Retell account, a real phone or Lovable
hosting.

## 1. What it is, in one paragraph

MARY's own voice stack (`lib/audio-engine.ts`, hold-to-talk, `/api/transcribe`, `/api/speech`,
`/api/addressee`) stays, and stays the default. Next to it sits a second voice path: the browser
mints a Retell web call through our server, joins it with the Retell SDK over WebRTC, and Retell
does the listening, turn-taking, echo handling and speaking with its own LLM running MARY's ported
playbook (Option B). Our code keeps the screen, the lead pipeline and the debrief. Mid-call the agent
calls two functions on our server (`note_details`, `save_lead`); after the call Retell's webhooks
write the durable row and run MARY's debrief. Nothing on the MARY path was removed.

## 2. File map

| Area     | File                                                                                                                                | Role                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| contract | `src/lib/retell-shared.ts`                                                                                                          | paths, env-facing types, request schemas, `save_lead` args, opening lines; zod and types only, so the `retell/` scripts can load it |
| server   | `src/lib/retell-env.server.ts`                                                                                                      | reads `process.env` on every request; `browserRoutesEnabled`, `serverRoutesEnabled`, `voiceStatus`                                  |
| server   | `src/lib/retell-signature.server.ts`                                                                                                | `verifyRetellSignature`, `signRetellBody` (WebCrypto HMAC; mirrors `retell-sdk` `webhook_auth.ts`)                                  |
| server   | `src/lib/retell-lead.server.ts`                                                                                                     | pure mapping: call to conversation, grounding through the existing `groundCollected`, sheet row, webhook plan, tool result messages |
| server   | `src/lib/retell-handlers.server.ts`                                                                                                 | the six handlers with injected dependencies (fetch, sheet, reflect, field notes, defer)                                             |
| server   | `src/lib/retell-deps.server.ts`                                                                                                     | wiring only: env, `sheets.server.ts`, `reflectAndStore`, `experienceForTurn`, `waitUntil`                                           |
| routes   | `src/routes/api/voice.ts`                                                                                                           | `GET /api/voice`                                                                                                                    |
| routes   | `src/routes/api/retell/{web-call,call-status,inject,webhook}.ts`, `src/routes/api/retell/functions/save-lead.ts`                    | thin `createFileRoute` handlers                                                                                                     |
| guard    | `src/lib/api-guard.ts`                                                                                                              | budgets for the five POST routes (section 6)                                                                                        |
| client   | `src/features/mary/voice/voice-provider.ts`                                                                                         | `fetchVoiceStatus`, `chooseVoiceProvider` (main bundle)                                                                             |
| client   | `src/features/mary/voice/retell-call.ts`                                                                                            | the `RetellCall` adapter, `makeProxyFetch`, `transcriptActions`, `retellErrorMessage` (SDK types only, so tests never load livekit) |
| client   | `src/features/mary/voice/retell-loader.ts`                                                                                          | the only value import of `retell-client-js-sdk`; reached through `await import()` in a mount effect, so it is a lazy chunk          |
| client   | `src/features/mary/mary-app.tsx`, `ui/call-stage.tsx`, `conversation/{types,reducer}.ts`                                            | provider probe at mount, early returns in the tap handlers, `via`, `UPSERT_LINE`, the End call button                               |
| config   | `retell/llm.json`, `retell/agent.json`, `retell/prompt-header.md`, `retell/config.ts`, `retell/setup.ts`, `retell/sign.ts`          | the agent as code; `retell/README.md` explains each                                                                                 |
| tests    | `tests/unit/retell-*.test.ts`, `tests/unit/voice-provider.test.ts`, `tests/unit/helpers/retell-server.ts`, `tests/fixtures/retell/` | signing, mapping, handlers, adapter and config, against docs-shaped fixtures and fakes                                              |

`voice-logic.ts` is not deleted and must not be: `mary-grounding.ts:11` and `mary-prompt.server.ts:6`
import it, and both still serve the MARY path and Retell's grounding. The 2026-09-23 design's claim
that it could go was wrong.

## 3. How a call runs

1. At mount, `mary-app.tsx` does one small no-store `GET /api/voice` (the only extra request on
   the MARY path) and picks the provider with `chooseVoiceProvider(status, location.search)`. When
   the answer is Retell, it lazy-loads `retell-loader.ts`. Boot never waits for this.
2. The Start tap primes the microphone permission (`primeMicPermission`) and calls
   `RetellCall.start(known, micReady)`. No call is minted while the permission prompt is open, and
   none when the mic is refused; a refusal falls back to MARY's typing path.
3. The SDK's `RetellClient({ key, fetch })` is built with a proxy `fetch`: its
   `POST /v3/create-web-call` becomes `POST /api/retell/web-call` carrying the session id, the
   known fields and the browser context, and no key. `POST /v2/stop-call/{id}` is answered with a
   local 204, and every other path with a local 404. Only the SDK's control API goes through this fetch; WHIP signalling uses
   the global `fetch` and goes straight to `api.retellai.com`.
4. Our server calls `POST https://api.retellai.com/v3/create-web-call` with `RETELL_API_KEY`,
   `agent_id`, `agent_version` (always sent, default `latest_published`), `metadata`
   (`{v:1, app, sessionId, known, context, startedAt}`) and the three dynamic variables
   (`opening_line`, `known_summary`, `field_notes`), then passes Retell's response through byte
   for byte: `{call_id, access_token, transport:"gateway", ice_servers, expires_at}`, all five
   fields, plus the SDK version headers. `/v2/create-web-call` and SDK 2.x are deprecated on
   2026-09-30.
5. Audio flows browser to Retell over WebRTC. The gateway transport has no agent-talking,
   `update` or `metadata` events, so the orb runs from `onAudio` (the agent's raw samples: RMS above
   0.015 is "speaking", 350 ms of quiet is "listening"). Captions are optional: with
   `RETELL_PUBLIC_KEY` the SDK opens the monitor socket and `onTranscript` drives `UPSERT_LINE`
   lines and the interim text; without it the call screen shows the orb, the pills and the status
   line only.
6. Typed text during a Retell call goes to `POST /api/retell/inject`, which checks that the call
   belongs to this session and is ongoing, then `PATCH /v2/update-live-call/{id}` with
   `additional_context` = `"The visitor typed this instead of saying it: …"` and
   `trigger_response: true`.
7. The End call button, and `pagehide`, call `session.end()`. After the end the client polls
   `POST /api/retell/call-status` at 0, 1.5 and 3.5 s for the recorded progress, then finishes
   through a second `LeadLifecycle` whose `syncLead` is a no-op (the server already wrote the row).

## 4. The lead flow

- **`note_details`** (silent, before the reveal): the agent sends name, business, industry and
  operations with their evidence quotes. The handler grounds them with `groundCollected` against
  the transcript in the payload, writes nothing to the sheet, patches the call metadata with the
  progress (`lead: {saved:false, outcome:"in_progress", collected, …}`, deferred), and answers with
  what is missing or rejected. The prompt makes the agent ask again until it comes back complete.
- **`save_lead`** (`stage: "final"` after the wrap answer, or `"callback"`): grounded the same way.
  When the outcome is `signed_up` or `callback` and the sheet is configured, the handler awaits the
  `lead` upsert (6 s), then awaits the metadata patch (`PATCH /v2/update-live-call/{id}` with
  `fields_to_override.metadata` = the existing metadata plus `lead`) before answering, because
  update-live-call only works on ongoing calls and the agent may say goodbye and `end_call` right
  after. The response tells the agent the position (only when the sheet gave one) or that no number
  may be said.
- **Post-end poll**: `call-status` reads `GET /v2/get-call/{id}` and reports the highest-ranked
  progress found in the tool results or `metadata.lead`. The end screen shows that position; the
  pills fill from a slow mid-call poll (8 s, backing off to 32 s while not visible).
- **Webhooks** (`call_ended`, `call_analyzed`): the durable backstop. The handler dedupes per
  `event:call_id`, derives the outcome from the recorded progress (re-grounding the last tool call
  only when nothing was recorded), writes the row (`signed_up`, `callback`, `declined` from the
  analysis, else `abandoned`; no row when they never spoke), and returns 502 when the sheet write
  fails so Retell retries. On `call_analyzed` it adds `summary` and `objections` from the analysis
  and runs `reflectAndStore` (the debrief) through `waitUntil`, or a 2.5 s race without it.

Leads are durable only with the sheet (D2). Without `SHEETS_WEBAPP_URL`, `save_lead` answers
`configured:false`, MARY gives no number, and the row exists only in Retell's call history.

## 5. Configuration and the decision rule

Server code reads `process.env["…"]` inside the handler on every request (the Lovable rule).

| Variable                                                                     | Kind                  | Meaning                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VOICE_PROVIDER`                                                             | var                   | `mary` (default, also for unset or unknown), `retell-optin` (MARY by default; `?voice=retell` uses Retell) or `retell` (Retell by default; `?voice=mary` forces MARY). Case-insensitive |
| `RETELL_API_KEY`                                                             | secret                | create-web-call, get-call, update-live-call; also the signing key when `RETELL_WEBHOOK_KEY` is unset                                                                                    |
| `RETELL_WEBHOOK_KEY`                                                         | secret, optional      | the workspace key that carries the webhook badge, if it is not `RETELL_API_KEY`. Signing key = `RETELL_WEBHOOK_KEY \|\| RETELL_API_KEY`                                                 |
| `RETELL_AGENT_ID`                                                            | var                   | the agent to call; traffic from any other agent is ignored                                                                                                                              |
| `RETELL_AGENT_VERSION`                                                       | var, optional         | digits become a number; `latest`, `latest_published` or a tag stay a string; anything else or unset becomes `latest_published`. Always sent                                             |
| `RETELL_PUBLIC_KEY`                                                          | var, optional, public | turns on live captions (`transcript: true`). Experimental (section 9)                                                                                                                   |
| `SHEETS_WEBAPP_URL`, `SHEETS_WEBAPP_SECRET`, `LOVABLE_API_KEY`               | existing              | durable leads (D2) and the debrief                                                                                                                                                      |
| `RETELL_API_KEY`, `RETELL_LLM_ID`, `RETELL_AGENT_ID` in the operator's shell | setup only            | `retell/setup.ts --apply` creates, or updates when the ids are set                                                                                                                      |

Definitions (`retell-env.server.ts`): `browserRoutesEnabled` = setting is not `mary` and the API
key and agent id are set; `serverRoutesEnabled` = signing key and agent id are set, whatever the
setting; `voiceStatus` = `{ provider: setting === "retell" && browser ? "retell" : "mary",
retell: browser, transcriptKey: browser ? publicKey : null }`.

| Setting      | Keys    | `GET /api/voice`                                          | web-call / call-status / inject | save-lead / webhook                                  |
| ------------ | ------- | --------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| mary / unset | any     | `{"provider":"mary","retell":false,"transcriptKey":null}` | 404                             | processed if signing key and agent are set, else 404 |
| retell-optin | missing | as above                                                  | 404                             | 404                                                  |
| retell-optin | present | `{"provider":"mary","retell":true,"transcriptKey":…}`     | enabled                         | enabled                                              |
| retell       | present | `{"provider":"retell","retell":true,"transcriptKey":…}`   | enabled                         | enabled                                              |

Browser routes return 404 unless opted in, so paid calls cannot be minted while the setting is
`mary`. Server routes stay live whenever the keys are set, so in-flight calls still drain after a
rollback. Client choice: `?voice=mary` always gives MARY; `?voice=retell` gives Retell only when
`retell` is true; otherwise the client follows `provider`. "Type instead" always uses MARY's text
pipeline.

## 6. Endpoints, guard and billing

| Route                             | Method | Disabled | Success                                       | Errors                                            |
| --------------------------------- | ------ | -------- | --------------------------------------------- | ------------------------------------------------- |
| `/api/voice`                      | GET    | 200 MARY | 200 `VoiceStatus`, `cache-control: no-store`  | -                                                 |
| `/api/retell/web-call`            | POST   | 404      | Retell's 201 and body, unchanged              | 400; 429 `busy`; 502                              |
| `/api/retell/functions/save-lead` | POST   | 404      | 200 `FunctionResult` (under 4,000 characters) | 413; 401 (bad signature); 400                     |
| `/api/retell/webhook`             | POST   | 404      | 204                                           | 413; 401; 400; 502 (sheet write failed, so retry) |
| `/api/retell/call-status`         | POST   | 404      | 200 `CallStatusResponse`, `no-store`          | 400; 502                                          |
| `/api/retell/inject`              | POST   | 404      | 204                                           | 400; 404 (not this session's call); 502           |

Hard errors are plain text. Upstream detail is logged, never echoed. Logs never contain
`access_token`, keys or the signature header. Signatures follow `retell-sdk` 6.0.1
`webhook_auth.ts`: `v=<ms>,d=<hex HMAC-SHA256(key, rawBody + ms)>`, checked on the raw text with a
5-minute tolerance; the `v` digits are parsed with `Number()` before they are appended, as the SDK
does.

Guard budgets (`api-guard.ts`): web-call 20/min and 8 KB; call-status 60/min and 2 KB; inject
30/min and 4 KB; save-lead 600/min and 1 MB; webhook 600/min and 2 MB. All Retell traffic comes
from one IP, so the signature is the real gate on the last two; handlers re-check the caps on the
raw text because a chunked body has no `content-length`.

Billing: the ported prompt is about 8k tokens (`bun retell/setup.ts` prints the estimate). Retell
scales billed minutes by tokens / 4,000 above 4,000 tokens, so about 2x per minute, plus the LLM.
A condensed Retell-only playbook would bring that down (section 10).

## 7. What changed against the 2026-09-23 design

- The SDK entry point is `new RetellClient({ key, fetch }).createWebCall({ agent_id, audio, transcript, hooks })`,
  not `startCall({ accessToken })`. The server-minted token still works because the SDK's control
  API goes through the custom `fetch`, which we answer with our proxy.
- Web-call returns all five fields, not only the token.
- There are no agent-talking, `update` or `metadata` events on the gateway; the orb is driven by
  `onAudio`.
- `voice-logic.ts` stays (section 2).
- Leads: `note_details` and `save_lead` with the metadata patch replace the single `save_lead`;
  the webhook is the backstop, not the only writer.
- `components/mary-experience.tsx` no longer exists; the client lives in `src/features/mary/`.

## 8. Option A (MARY's own brain) as a later step

The client, the functions and the webhook do not depend on which LLM answers, so Option A is an
agent swap, not a rebuild:

1. Prove the WebSocket upgrade on Lovable's hosting with a probe route (`WebSocketPair`, 101).
2. Add `/api/retell/llm/{call_id}` reusing `buildPrompt`, `finishTurn` and `TurnSchema`, streaming
   Retell `response` events with `content_complete`, and `end_call` at CLOSE.
3. Point a second agent at `response_engine: { type: "custom-llm", llm_websocket_url }`.
4. Swap `RETELL_AGENT_ID`. `save_lead` then becomes optional because the server writes on
   `complete`; keep the webhook.

Move to A if the ported prompt loses MARY's grounding discipline on `gpt-5.6-terra`.

## 9. UNVERIFIED without credentials or a device

1. **Lovable and Workers:** whether new secrets reach `process.env` and whether a secret change
   needs a Publish; whether `request.waitUntil` reaches TanStack handlers (without it the debrief
   is raced for 2.5 s; check the Experience tab after the first call); whether Retell sends an
   `Origin` header (the guard would 403 it); real function and webhook body sizes against the
   1 MB and 2 MB budgets.
2. **Payload shapes:** whether function payloads and `call_ended` carry
   `transcript_with_tool_calls` and echo `metadata`; whether injected typed text appears there with
   role `injected` (typed emails ground only if it does); how update-live-call behaves on gateway
   web calls; whether Get Call returns `metadata.lead` and the tool results mid-call and right after
   the end (the pills and the end-screen position depend on it; if not, the end screen shows
   "declined" copy for someone who signed up while the webhook still writes the right row).
3. **iPhone and Safari:** whether the SDK's detached `<audio>` element autoplays after the round
   trips with the mic live; whether stopping the primed track after the SDK's own `getUserMedia`
   leaves Retell's capture intact; whether the meter's AudioContext stays suspended (a flat orb;
   the "Can't hear her?" tap resumes it); earpiece versus speaker and static on the first
   utterance, neither handled by the SDK.
4. **Captions:** whether a public key can open the monitor socket (the SDK README and the docs
   contradict each other).
5. **Retell behaviour and limits:** how `gpt-5.6-terra` follows the ported prompt (grounding
   rejections, note_details discipline, phase order), which is prompt-only in Option B;
   `agent_version` `latest_published` versus drafts after `update-agent`; whether a dynamic
   `begin_message` triggers the 10 s minimum charge; Get Call rate limits under the 8 s poll; the
   default concurrency of 20 (a 429 falls back to typing).
6. **Duplication and data:** deduplication is per isolate, so duplicate lessons are possible on
   retries across isolates; the deployed "hardened" Apps Script is not the repo copy and its
   contract is assumed identical; without D2, Retell leads exist only in Retell's call history.
7. **What the tests prove:** the unit tests prove the signing, mapping, grounding, handler and
   adapter logic against docs-shaped fixtures and fakes only.

## 10. Open questions for the operator

1. **Cost.** The ported prompt is about 8k tokens, billed at about 2x per minute. Accept that, or
   commission a condensed Retell-only playbook?
2. **Privacy and disclosure.** Grounding needs unscrubbed transcripts, so the agent ships with
   `data_storage_setting: "everything"`: Retell keeps recordings and transcripts. Is that
   acceptable, and does the landing page need a recording and transcript disclosure?
3. **Voice.** Which Retell `voice_id` should MARY use?
4. **Loud rooms.** Retell is hands-free only, with no hold-to-talk. At the event stand, should
   Retell become the default (`retell`) or stay opt-in (`retell-optin`) with MARY's hold-to-talk
   as the default there?
5. **Captions.** Unless `RETELL_PUBLIC_KEY` opens the monitor socket, the Retell call screen shows
   no text of what MARY says (orb and pills only; screen readers get nothing). Accept that for v1,
   or schedule the public-key test and relay work?
6. **Call limits.** Are 15 minutes maximum per call and a hang-up after 45 s of silence right?

## 11. Going live and rolling back

The full checklist is in `retell/README.md`. In short:

1. Merge with CI green, then Lovable Publish → Update.
2. In Retell: find the key with the webhook badge, pick a voice.
3. `bun retell/setup.ts --site https://<published-host> --voice <id>` (dry run), review
   `retell/out/`, the token estimate and the billing multiplier; then `--apply --publish`.
4. Check the dashboard: webhook URL, function URLs, analysis fields, data storage.
5. In Lovable set `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_AGENT_VERSION` (and
   `RETELL_WEBHOOK_KEY` if needed) and `VOICE_PROVIDER=retell-optin`; confirm `SHEETS_WEBAPP_URL`,
   `SHEETS_WEBAPP_SECRET` and `LOVABLE_API_KEY`. Publish.
6. `GET /api/voice` shows `"retell":true,"provider":"mary"`.
7. Desktop Chrome with `?voice=retell`, then the callback, decline, closed-tab, mic-denied and
   `?voice=mary` paths, then iPhone Safari, Mac Safari, Android Chrome, a loud room, five scripted
   calls, and real payloads captured into the fixtures.
8. Set `VOICE_PROVIDER=retell` and Publish.

**Rollback:** set `VOICE_PROVIDER=mary` and Publish. Webhooks keep draining because the server
routes stay live while the keys are set.

## Sources

- Create web call (v3): https://docs.retellai.com/api-references/create-web-call
- Web call SDK: https://docs.retellai.com/deploy/web-call
- Webhooks and signature verification: https://docs.retellai.com/features/webhook-overview
- Custom functions: https://docs.retellai.com/build/conversation-flow/custom-function
- Post-call analysis: https://docs.retellai.com/features/post-call-analysis-overview
- Custom LLM WebSocket (Option A): https://docs.retellai.com/integrate-llm/overview
- SDK sources checked: `retell-client-js-sdk` 3.0.1 (`control/api.ts`, `gateway-transport.ts`,
  `base-session.ts`), `retell-sdk` 6.0.1 (`lib/webhook_auth.ts`, `resources/{agent,llm,call}.ts`)
