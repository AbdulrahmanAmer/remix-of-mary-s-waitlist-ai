# retell/ - MARY's Retell agent as code

The Retell agent that answers the dormant voice path (`docs/architecture/retell-migration.md`).
Everything Retell needs to know about MARY is generated from these files, so the agent can be
re-created or updated from the repo instead of the dashboard.

## Files

| File                    | What it is                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm.json`              | The Retell LLM (`POST /create-retell-llm` body): `gpt-5.6-terra`, `begin_message` = `{{opening_line}}`, the three dynamic variables, and the tools `end_call`, `note_details` and `save_lead`. `__GENERATED__` is the prompt |
| `agent.json`            | The agent (`POST /create-agent` body): voice, webhook URL and events, 15 min cap, 45 s silence hang-up, denoising, boosted keywords, `data_storage_setting: "everything"`, post-call analysis fields                         |
| `playbook-condensed.md` | The default prompt, used as written: MARY's playbook rewritten for a Retell call, about 3,200 tokens, ending with `{{field_notes}}`. `playbook-condensed.test-notes.md` has the 12 scripted test calls                       |
| `prompt-header.md`      | Used only with `--playbook full`: this call's rules, which outrank the playbook: phases, the tool discipline, `{{known_summary}}`                                                                                            |
| `config.ts`             | Pure builders: `PLAYBOOK_EDITS`, `buildGeneralPrompt`, `normalizeSite`, `estimateTokens`, `buildRetellConfig`. Imports the shared constants from `src/lib/retell-shared.ts`                                                  |
| `setup.ts`              | `bun retell/setup.ts --site https://<host> --voice <id> [--playbook condensed\|full] [--apply] [--publish]`: builds, writes `retell/out/` (gitignored), and with `--apply` creates or updates the LLM and agent              |
| `sign.ts`               | `RETELL_WEBHOOK_KEY=… bun retell/sign.ts <file>` prints an `x-retell-signature` for that file's exact bytes, for local curl checks                                                                                           |

By default the prompt is `playbook-condensed.md` as written (`buildCondensedPrompt`). With
`--playbook full` it is `prompt-header.md`, then `docs/mary-voice.md` with six edits (`PLAYBOOK_EDITS` in
`config.ts`: the hold button, the say/followUp JSON beats and `complete` become call wording), then
`{{field_notes}}`. `docs/mary-voice.md` itself is never edited; the test
(`tests/unit/retell-config.test.ts`) fails when one of the six targets stops occurring exactly once.
The three dynamic variables are set per call by `/api/retell/web-call`: `opening_line` (one of
`OPENING_LINES`, or the welcome-back line when the name is known), `known_summary`, `field_notes`.

## Running the setup

```sh
# dry run: prints the token estimate and warnings, writes retell/out/{llm,agent}.json
bun retell/setup.ts --site https://<published-host> --voice <voice_id>

# create the LLM and the agent, then publish the version it wrote
RETELL_API_KEY=… bun retell/setup.ts --site https://<published-host> --voice <voice_id> --apply --publish

# update the existing ones instead of creating new ones
RETELL_API_KEY=… RETELL_LLM_ID=llm_… RETELL_AGENT_ID=agent_… bun retell/setup.ts --site … --voice … --apply --publish
```

`--site` must be the published https origin, because Retell calls the function and webhook URLs on
it. The script prints `RETELL_LLM_ID`, `RETELL_AGENT_ID` and `RETELL_AGENT_VERSION` at the end;
keep the LLM id for later updates. It never prints a key. A non-2xx from Retell prints the status
and body and exits 1.

Retell bills prompts over 4,000 tokens at tokens / 4,000 times the call minutes, and counts the
tool descriptions (about 1,000 tokens) and the transcript so far toward that. The condensed prompt
is about 3,200 tokens, so a typical call bills at roughly 1.0x to 1.3x. The full playbook is about
8k tokens, about 2x; the script warns with the multiplier.

## Local checks (no Retell account needed)

The unit tests cover the config (`bun run test`). For the routes, run the production Worker with
the Retell env in `.dev.vars`:

```
VOICE_PROVIDER=retell-optin
RETELL_API_KEY=test
RETELL_AGENT_ID=agent_test
RETELL_WEBHOOK_KEY=test
```

```sh
bun run build && bun run preview --port 8788 --ip 127.0.0.1
curl -s http://127.0.0.1:8788/api/voice                       # {"provider":"mary","retell":true,...}

SIG=$(RETELL_WEBHOOK_KEY=test bun retell/sign.ts tests/fixtures/retell/call-ended.signed-up.json)
curl -i -X POST http://127.0.0.1:8788/api/retell/webhook \
  -H "content-type: application/json" -H "x-retell-signature: $SIG" \
  --data-binary @tests/fixtures/retell/call-ended.signed-up.json    # 204; a wrong key gives 401

SIG=$(RETELL_WEBHOOK_KEY=test bun retell/sign.ts tests/fixtures/retell/function.save-lead.final.json)
curl -s -X POST http://127.0.0.1:8788/api/retell/functions/save-lead \
  -H "content-type: application/json" -H "x-retell-signature: $SIG" \
  --data-binary @tests/fixtures/retell/function.save-lead.final.json  # the FunctionResult JSON
```

The fixture's `agent_id` must equal `RETELL_AGENT_ID`, or the handler answers "not connected".
Fixtures (`tests/fixtures/retell/`): `web-call.response.json`, `get-call.ongoing.json`,
`function.save-lead.final.json`, `function.save-lead.ungrounded.json`, `function.note-details.json`,
`call-ended.signed-up.json`, `call-ended.abandoned.json`, `call-analyzed.declined.json`. They are
shaped from Retell's docs; replace them with real captures at go-live (step 12). A Start tap with
`?voice=retell` against this local Worker gets a 401 from Retell (`test` is not a key), which the
server turns into a 502 and the client into the typing fallback with MARY greeting in text.

## Go-live checklist

1. Merge with CI green, then Lovable Publish → Update. The published URL changes only on Publish.
2. In Retell: find the API key with the webhook badge (use it as `RETELL_API_KEY`, or set
   `RETELL_WEBHOOK_KEY` separately), and pick a voice.
3. Run the dry run, review `retell/out/`, the token estimate and the billing multiplier. Then run
   `--apply --publish` and keep the printed ids.
4. In the dashboard, check the webhook URL, the two function URLs, the analysis fields (`outcome`,
   `callback_requested`, `objections`, `call_summary`) and data storage set to everything.
5. In Lovable, set `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_AGENT_VERSION` (and
   `RETELL_WEBHOOK_KEY` if needed) and `VOICE_PROVIDER=retell-optin`. Confirm that
   `SHEETS_WEBAPP_URL` and `SHEETS_WEBAPP_SECRET` (D2) and `LOVABLE_API_KEY` are set. Publish.
6. `GET https://<site>/api/voice` should show `"retell":true,"provider":"mary"`.
7. Desktop Chrome with `?voice=retell`, one full sign-up:
   - web-call returns 201 and WHIP goes to api.retellai.com;
   - the orb moves, mute works, a typed email reaches her, and the pills fill at note_details;
   - she gives the position and the end screen shows the same one;
   - the sheet row reads Signed up / voice;
   - the Retell call log shows the functions and webhooks returning 2xx;
   - Summary and Experience rows arrive.
8. The callback path, the decline path (then Resume), a tab closed mid-call, mic denied (falls
   back to typing), and `?voice=mary`.
9. iPhone Safari on the published URL (not the Lovable editor iframe), ring switch on and off, and
   AirPods. Then Mac Safari and Android Chrome.
10. A loud room.
11. Five scripted calls that reach CLOSE with only grounded fields.
12. Capture real payloads and replace the fixtures.
13. Set `VOICE_PROVIDER=retell` and Publish.

Optional captions: set `RETELL_PUBLIC_KEY` (domain-restricted in Retell) and test with
`?voice=retell`. If the console shows `retell: live transcript unavailable`, unset it.

**Rollback:** set `VOICE_PROVIDER=mary` and Publish. Browser routes go 404 at once; the webhook
and function routes keep draining in-flight calls while the keys are set.
