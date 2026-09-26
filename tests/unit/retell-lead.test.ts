import { describe, expect, it } from "vitest";

import { LeadPayloadSchema } from "@/lib/lead-sync";
import {
  RetellCallSchema,
  conversationOf,
  functionMessage,
  groundSaveLead,
  knownSummary,
  lastFunctionArgs,
  leadRowFromCall,
  planWebhook,
  progressFromCall,
  sessionIdOf,
  transcriptText,
  type Decision,
} from "@/lib/retell-lead.server";
import { NOTHING_KNOWN, SaveLeadArgsSchema } from "@/lib/retell-shared";

import {
  CONTEXT,
  NOW,
  SESSION,
  agent,
  fixture,
  invoke,
  metadata,
  parsedCall,
  result,
  typed,
  user,
} from "./helpers/retell-server";

const LEO = [
  agent("Hey — good to meet you. I'm MARY. So what should I call you?"),
  user("I'm Leo, Leo Marsh."),
  agent("Good to meet you, Leo. What's the business?"),
  user("We're Marsh Plumbing — we do plumbing, mostly emergency call-outs."),
  agent("When a call comes in today, what happens to it?"),
  user("Calls come in and whoever's free grabs them, honestly."),
];
const CONTACT = [
  agent("Where should I send your early access?"),
  user("It's leo at marshplumbing dot com."),
  agent("Want to add a phone number, or is email enough?"),
  user("Email's fine, skip the phone."),
];
const FULL = {
  stage: "final",
  name: "Leo Marsh",
  name_evidence: "I'm Leo, Leo Marsh",
  email: "leo@marshplumbing.com",
  phone: "skipped",
  business: "Marsh Plumbing",
  business_evidence: "we're Marsh Plumbing",
  industry: "plumbing",
  industry_evidence: "we do plumbing, mostly emergency call-outs",
  operations: "calls come in, whoever's free grabs them",
  operations_evidence: "whoever's free grabs them",
};
const LEO_SIX = {
  name: "Leo Marsh",
  email: "leo@marshplumbing.com",
  phone: "skipped",
  business: "Marsh Plumbing",
  industry: "plumbing",
  operations: "calls come in, whoever's free grabs them",
};
const ONLY_DISCOVERY = { email: null, phone: null };
const NOTHING_ELSE = {
  name: null,
  email: null,
  phone: null,
  business: null,
  industry: null,
  operations: null,
};

const args = (over: Record<string, unknown> = {}) => SaveLeadArgsSchema.parse({ ...FULL, ...over });
const withItems = (items: Record<string, unknown>[], over: Record<string, unknown> = {}) =>
  parsedCall({ transcript_with_tool_calls: items, ...over });
const fixtureCall = (name: string) =>
  RetellCallSchema.parse((JSON.parse(fixture(name)) as { call: unknown }).call);
const progress = (outcome: "in_progress" | "signed_up" | "callback", position: number | null) => ({
  saved: outcome !== "in_progress",
  configured: true,
  outcome,
  position,
  collected: { name: "Leo Marsh" },
});
const functionResult = (p: ReturnType<typeof progress>) => ({
  ...p,
  recorded: true,
  missing: [],
  rejected: [],
  message: "…",
});

describe("conversationOf / transcriptText", () => {
  it("keeps MARY and the guest in order, with typed text as theirs", () => {
    const c = withItems([
      agent("Hi, I'm MARY."),
      user("Hey."),
      invoke("t1", "note_details", {}),
      result("t1", "{}"),
      typed("leo@marshplumbing.com"),
      { role: "injected", content: "Customer opened a support ticket.", time_sec: 3 },
      agent("   "),
      user(""),
      { role: "node_transition", former_node_id: "a", former_node_name: "a" },
      { role: "transfer_target", content: "Hello?" },
      agent("Got it."),
    ]);
    expect(conversationOf(c)).toEqual([
      { who: "mary", text: "Hi, I'm MARY.", typed: false },
      { who: "guest", text: "Hey.", typed: false },
      { who: "guest", text: "leo@marshplumbing.com", typed: true },
      { who: "mary", text: "Got it.", typed: false },
    ]);
  });

  it("falls back to transcript_object, then to the transcript string", () => {
    const fromObject = parsedCall({
      transcript_with_tool_calls: [],
      transcript_object: [agent("Hello."), user("Hi.")],
    });
    expect(conversationOf(fromObject).map((u) => u.who)).toEqual(["mary", "guest"]);

    const fromString = parsedCall({
      transcript_with_tool_calls: undefined,
      transcript:
        "Agent: Hello there.\nUser: Hi, I'm Sam.\n\nnoise\nUser:   \nAgent: Nice to meet you.\n",
    });
    expect(conversationOf(fromString)).toEqual([
      { who: "mary", text: "Hello there.", typed: false },
      { who: "guest", text: "Hi, I'm Sam.", typed: false },
      { who: "mary", text: "Nice to meet you.", typed: false },
    ]);
  });

  it("writes MARY/Guest lines, capped at 60,000 characters", () => {
    expect(transcriptText(withItems([agent("Hello."), user("Hi."), typed("a@b.co")]))).toBe(
      "MARY: Hello.\nGuest: Hi.\nGuest: a@b.co",
    );
    const long = withItems(Array.from({ length: 200 }, () => user("x".repeat(500))));
    expect(transcriptText(long)).toHaveLength(60_000);
  });

  it("summarises what is known for the agent", () => {
    expect(knownSummary({ industry: "plumbing", name: " Leo\nMarsh " })).toBe(
      "name: Leo Marsh; industry: plumbing",
    );
    expect(knownSummary({})).toBe(NOTHING_KNOWN);
  });
});

describe("groundSaveLead", () => {
  it("signs up when every required field is in their words", () => {
    expect(groundSaveLead(args(), withItems([...LEO, ...CONTACT]), "final")).toEqual({
      outcome: "signed_up",
      missing: [],
      rejected: [],
      collected: LEO_SIX,
    });
  });

  it("rejects an industry they never described", () => {
    const d = groundSaveLead(
      args({ industry: "roofing", industry_evidence: "we do roofing" }),
      withItems([...LEO, ...CONTACT]),
      "final",
    );
    expect(d.rejected).toEqual(["industry"]);
    expect(d.missing).toEqual([]);
    expect(d.outcome).toBe("signed_up"); // name and email hold the spot; the industry is left out
    expect(d.collected.industry).toBeUndefined();
  });

  it("gives a spot on name and email alone: the fast lane and a visitor with no business", () => {
    const d = groundSaveLead(
      SaveLeadArgsSchema.parse({
        stage: "final",
        name: "Leo Marsh",
        name_evidence: "I'm Leo, Leo Marsh",
        email: "leo@marshplumbing.com",
      }),
      withItems([...LEO, ...CONTACT]),
      "final",
    );
    expect(d.missing).toEqual([]);
    expect(d.rejected).toEqual([]);
    expect(d.outcome).toBe("signed_up");
    expect(d.collected.business).toBeUndefined();
  });

  it("grounds a spelled-out email address", () => {
    const c = withItems([
      ...LEO,
      agent("What's the best email?"),
      user("sure, it's jo at acme dot com"),
    ]);
    const d = groundSaveLead(args({ email: "jo@acme.com", phone: null }), c, "final");
    expect(d.collected.email).toBe("jo@acme.com");
    expect(d.outcome).toBe("signed_up");
  });

  it("takes a skipped phone only after they waved it off", () => {
    expect(groundSaveLead(args(), withItems([...LEO, ...CONTACT]), "final").collected.phone).toBe(
      "skipped",
    );
    const c = withItems([...LEO, ...CONTACT.slice(0, 2)]);
    const d = groundSaveLead(args(), c, "final");
    expect(d.collected.phone).toBeUndefined();
    expect(d.rejected).toEqual(["phone"]);
    expect(d.outcome).toBe("signed_up"); // the phone is optional
  });

  it("books a callback with their name and a 7-digit number", () => {
    const c = withItems([
      ...LEO.slice(0, 2),
      agent("Would you rather the team called you?"),
      user("Yes please, call me back on 555 0123."),
    ]);
    const d = groundSaveLead(
      args({ ...NOTHING_ELSE, name: "Leo Marsh", stage: "callback", phone: "555 0123" }),
      c,
      "callback",
    );
    expect(d).toMatchObject({
      outcome: "callback",
      missing: [],
      collected: { name: "Leo Marsh", phone: "555 0123" },
    });
  });

  it("keeps a callback open without a real number", () => {
    const c = withItems([
      ...LEO.slice(0, 2),
      agent("Would you rather the team called you? What number?"),
      user("Actually skip the phone, just email me."),
    ]);
    const d = groundSaveLead(
      args({ ...NOTHING_ELSE, name: "Leo Marsh", phone: "skipped", callback_requested: true }),
      c,
      "final",
    );
    expect(d.collected.phone).toBe("skipped");
    expect(d.outcome).toBe("in_progress");
    expect(d.missing).toEqual(["phone"]);
  });

  it("does not re-propose a value it already holds, so it is neither re-checked nor rejected", () => {
    const c = withItems([agent("Welcome back. Where were we?"), user("We were on my business.")], {
      metadata: metadata({ known: { name: "Leo Marsh" } }),
    });
    const d = groundSaveLead(
      args({ ...NOTHING_ELSE, name: "leo marsh", name_evidence: "words they never said" }),
      c,
      "progress",
    );
    expect(d.collected.name).toBe("Leo Marsh");
    expect(d.rejected).toEqual([]);
  });

  it("changes a known value only from their last message", () => {
    const known = { metadata: metadata({ known: { business: "Marsh Plumbing" } }) };
    const renamed = [
      agent("Still Marsh Plumbing?"),
      user("We renamed it to Marsh and Sons Plumbing."),
    ];
    const proposal = args({
      ...NOTHING_ELSE,
      business: "Marsh and Sons Plumbing",
      business_evidence: "we renamed it to Marsh and Sons Plumbing",
    });
    expect(groundSaveLead(proposal, withItems(renamed, known), "progress").collected.business).toBe(
      "Marsh and Sons Plumbing",
    );
    const later = withItems(
      [...renamed, agent("And how do leads reach you?"), user("Mostly by phone.")],
      known,
    );
    const stale = groundSaveLead(proposal, later, "progress");
    expect(stale.collected.business).toBe("Marsh Plumbing");
    expect(stale.rejected).toEqual(["business"]);
  });

  it("does not take a bare 'yeah' as their words", () => {
    const c = withItems([
      agent("Do leads come in through the website?"),
      user("yeah"),
      agent("And then what happens to them?"),
      user("Honestly it depends on the week."),
    ]);
    const d = groundSaveLead(
      args({ ...NOTHING_ELSE, operations: "website leads", operations_evidence: "yeah" }),
      c,
      "progress",
    );
    expect(d.rejected).toEqual(["operations"]);
  });

  it("note_details needs the four discovery fields and nothing else", () => {
    expect(groundSaveLead(args(ONLY_DISCOVERY), withItems(LEO), "progress")).toMatchObject({
      outcome: "in_progress",
      missing: [],
      rejected: [],
    });
    const three = args({ ...ONLY_DISCOVERY, operations: null, operations_evidence: null });
    expect(groundSaveLead(three, withItems(LEO), "progress").missing).toEqual(["operations"]);
  });

  it("lists what a final save still needs, in order", () => {
    const onlyName = SaveLeadArgsSchema.parse({
      stage: "final",
      name: "Leo Marsh",
      name_evidence: "I'm Leo, Leo Marsh",
    });
    const d = groundSaveLead(onlyName, withItems(LEO), "final");
    expect(d.missing).toEqual(["email"]);
    expect(d.outcome).toBe("in_progress");
  });

  it("reads the last save_lead or note_details the agent called", () => {
    const c = withItems([
      invoke("t1", "note_details", { name: "Leo" }),
      invoke("t2", "save_lead", { stage: "callback", name: "Leo Marsh", phone: 5550123 }),
      { role: "tool_call_invocation", tool_call_id: "t3", name: "save_lead", arguments: "{oops" },
      invoke("t4", "end_call", {}),
    ]);
    expect(lastFunctionArgs(c)).toMatchObject({
      name: "save_lead",
      args: { stage: "callback", name: "Leo Marsh", phone: "5550123" },
    });
    expect(lastFunctionArgs(withItems(LEO))).toBeNull();
  });
});

describe("sessionIdOf", () => {
  it("uses our sessionId, and the call id when there is none or only the shared fallback", () => {
    expect(sessionIdOf(parsedCall())).toBe(SESSION);
    expect(sessionIdOf(parsedCall({ call_id: "call_abc12345", metadata: undefined }))).toBe(
      "retell_call_abc12345",
    );
    const shared = parsedCall({
      call_id: "call_abc12345",
      metadata: metadata({ sessionId: "session" }),
    });
    expect(sessionIdOf(shared)).toBe("retell_call_abc12345");
    expect(sessionIdOf(parsedCall({ call_id: "c".repeat(128), metadata: {} }))).toHaveLength(80);
  });
});

describe("leadRowFromCall", () => {
  it("builds a row the sheet accepts, keeping summary and objections", () => {
    const c = parsedCall({
      start_timestamp: NOW - 95_400,
      transcript_with_tool_calls: [
        agent("Hi."),
        user("Hello."),
        typed("leo@x.co"),
        agent("Thanks."),
      ],
    });
    const row = leadRowFromCall(c, { name: "Leo", email: "leo@x.co" }, "in_progress", NOW, {
      summary: "A short chat.",
      objections: "price",
    });
    expect(row).toMatchObject({
      sessionId: SESSION,
      outcome: "in_progress",
      name: "Leo",
      email: "leo@x.co",
      phone: "",
      callbackRequested: false,
      transcript: "MARY: Hi.\nGuest: Hello.\nGuest: leo@x.co\nMARY: Thanks.",
      turns: 2,
      durationSec: 95,
      source: "mixed",
      mode: "",
      startedAt: new Date(NOW - 95_400).toISOString(),
      ...CONTEXT,
      localPosition: 0,
      reflect: false,
      summary: "A short chat.",
      objections: "price",
    });
    expect(LeadPayloadSchema.safeParse(row).success).toBe(true);
  });

  it("prefers Retell's duration, clamps it, and falls back to our startedAt", () => {
    const measured = parsedCall({ duration_ms: 192_400, start_timestamp: NOW - 1_000_000 });
    expect(leadRowFromCall(measured, {}, "abandoned", NOW).durationSec).toBe(192);
    const endless = parsedCall({ start_timestamp: NOW - 10 * 86_400_000 });
    expect(leadRowFromCall(endless, {}, "abandoned", NOW).durationSec).toBe(86_400);
    const unstarted = parsedCall({ start_timestamp: undefined, metadata: metadata() });
    expect(leadRowFromCall(unstarted, {}, "abandoned", NOW)).toMatchObject({
      durationSec: 0,
      startedAt: "2026-09-21T14:11:19.000Z",
      source: "voice",
      turns: 0,
    });
  });

  it("flags a callback row unless told otherwise", () => {
    expect(leadRowFromCall(parsedCall(), {}, "callback", NOW).callbackRequested).toBe(true);
    const extra = { callbackRequested: true };
    expect(leadRowFromCall(parsedCall(), {}, "declined", NOW, extra).callbackRequested).toBe(true);
  });
});

describe("progressFromCall", () => {
  const saveResult = (id: string, p: ReturnType<typeof progress>, ok = true) => [
    invoke(id, "save_lead", {}),
    result(id, functionResult(p), ok),
  ];

  it("a recorded sign-up beats in-progress metadata", () => {
    const c = withItems(saveResult("t1", progress("signed_up", 412)), {
      metadata: metadata({ lead: { ...progress("in_progress", null), at: NOW } }),
    });
    expect(progressFromCall(c)).toEqual(progress("signed_up", 412));
  });

  it("a sign-up in the metadata beats an in-progress tool result", () => {
    const c = withItems(saveResult("t1", progress("in_progress", null)), {
      metadata: metadata({ lead: { ...progress("signed_up", 412), at: NOW } }),
    });
    expect(progressFromCall(c)).toEqual(progress("signed_up", 412));
  });

  it("a later note_details result does not hide an earlier save", () => {
    const c = withItems([
      ...saveResult("t1", progress("callback", 9)),
      invoke("t2", "note_details", {}),
      result("t2", functionResult(progress("in_progress", null))),
    ]);
    expect(progressFromCall(c)?.outcome).toBe("callback");
  });

  it("ignores failed results, unreadable content and other tools", () => {
    const c = withItems([
      ...saveResult("t1", progress("signed_up", 1), false),
      invoke("t2", "note_details", {}),
      result("t2", "not json"),
      invoke("t3", "check_calendar", {}),
      result("t3", functionResult(progress("signed_up", 3))),
      result("t4", functionResult(progress("signed_up", 4))),
    ]);
    expect(progressFromCall(c)).toBeNull();
  });

  it("is null when nothing was recorded", () => {
    expect(progressFromCall(parsedCall())).toBeNull();
    expect(progressFromCall(parsedCall({ metadata: "not an object" }))).toBeNull();
  });
});

describe("planWebhook", () => {
  const noteArgs = {
    name: "Leo Marsh",
    name_evidence: "I'm Leo, Leo Marsh",
    business: "Marsh Plumbing",
    business_evidence: "we're Marsh Plumbing",
    industry: "plumbing",
    industry_evidence: "we do plumbing, mostly emergency call-outs",
    operations: "calls come in, whoever's free grabs them",
    operations_evidence: "whoever's free grabs them",
  };

  it("writes nothing when they never spoke", () => {
    expect(planWebhook("call_ended", withItems([agent("Hello? Are you there?")]), NOW)).toEqual({
      row: null,
      reflect: null,
    });
  });

  it("marks a talk that never saved abandoned, with what note_details grounded", () => {
    const c = withItems([
      ...LEO,
      invoke("t1", "note_details", noteArgs),
      agent("Here's the thing…"),
    ]);
    const plan = planWebhook("call_ended", c, NOW);
    expect(plan.row).toMatchObject({
      outcome: "abandoned",
      name: "Leo Marsh",
      business: "Marsh Plumbing",
      industry: "plumbing",
      operations: "calls come in, whoever's free grabs them",
      email: "",
      turns: 3,
    });
    expect(plan.reflect).toBeNull();
  });

  it("keeps a recorded sign-up that a re-ground of the finished call would refuse", () => {
    // The email was confirmed with a plain "yes" to her read-back: grounded when saved,
    // but no longer once the last message is "bye".
    const email = "office@marshplumbing.com";
    const saved = { ...progress("signed_up", 412), collected: { ...LEO_SIX, email } };
    const c = withItems([
      ...LEO,
      agent(`Shall I send it to ${email}, and leave the phone out?`),
      user("Yes."),
      invoke("t1", "save_lead", { ...FULL, email }),
      result("t1", functionResult(saved)),
      agent("You're number 412, Leo."),
      user("Great, bye!"),
    ]);
    expect(groundSaveLead(args({ email }), c, "final").outcome).toBe("in_progress");
    const plan = planWebhook("call_ended", c, NOW);
    expect(plan.row).toMatchObject({
      outcome: "signed_up",
      ...LEO_SIX,
      email,
      callbackRequested: false,
    });
  });

  it("records an analysed decline with the analysis summary", () => {
    const plan = planWebhook("call_analyzed", fixtureCall("call-analyzed.declined.json"), NOW);
    expect(plan.row).toMatchObject({
      outcome: "declined",
      sessionId: "w_lxa0b_cc11dd",
      name: "",
      turns: 3,
      durationSec: 60,
      summary: "Sam was browsing without a business and politely declined; no details were taken.",
      objections: "no business right now; just browsing",
      callbackRequested: false,
    });
  });

  it("flags a callback the analysis heard, without trusting its outcome", () => {
    const c = withItems([agent("Hi."), user("Can someone call me next week?")], {
      call_analysis: {
        call_summary: "Wants a call.",
        custom_analysis_data: { outcome: "callback", callback_requested: true },
      },
    });
    expect(planWebhook("call_analyzed", c, NOW).row).toMatchObject({
      outcome: "abandoned",
      callbackRequested: true,
    });
    expect(planWebhook("call_ended", c, NOW).row).toMatchObject({ callbackRequested: false });
  });

  it("debriefs only an analysed call with two turns or more", () => {
    const two = withItems([
      agent("Hi."),
      user("Hello there."),
      agent("And you run?"),
      user("A bakery."),
    ]);
    expect(planWebhook("call_analyzed", two, NOW).reflect).toEqual({
      sessionId: SESSION,
      transcript: "MARY: Hi.\nGuest: Hello there.\nMARY: And you run?\nGuest: A bakery.",
      outcome: "abandoned",
      collected: {},
      turns: 2,
      durationSec: 120,
    });
    expect(planWebhook("call_ended", two, NOW).reflect).toBeNull();
    const one = withItems([agent("Hi."), user("Hello there, I'm busy.")]);
    expect(planWebhook("call_analyzed", one, NOW).reflect).toBeNull();
  });

  it("does no work for other events", () => {
    for (const event of ["transcript_updated", "call_started", "transfer_started"]) {
      expect(planWebhook(event, withItems(LEO), NOW)).toEqual({ row: null, reflect: null });
    }
  });
});

describe("functionMessage", () => {
  const decision = (over: Partial<Decision> = {}): Decision => ({
    collected: {},
    rejected: [],
    missing: [],
    outcome: "signed_up",
    ...over,
  });

  it("gives a position only when the sheet handed one out", () => {
    expect(functionMessage("save_lead", decision(), { saved: true, position: 412 })).toBe(
      "Saved. They are number 412 on the early-access list. Give a short send-off with their first name and the number, then say the close line and call end_call.",
    );
    const none = functionMessage("save_lead", decision(), { saved: true, position: null });
    expect(none).toContain("do not give one");
    expect(none).not.toMatch(/\d/);
  });

  it("forbids a number when nothing was saved", () => {
    for (const outcome of ["signed_up", "callback"] as const) {
      const message = functionMessage("save_lead", decision({ outcome }), {
        saved: false,
        position: null,
      });
      expect(message).toContain("Do not give a position number");
    }
  });

  it("confirms a callback without a day or time", () => {
    const message = functionMessage("save_lead", decision({ outcome: "callback" }), {
      saved: true,
      position: 7,
    });
    expect(message).toMatch(/^Callback request saved\./);
    expect(message).toContain("no day or time");
    expect(message).not.toContain("7");
  });

  it("asks for the next missing field and names the rejected ones", () => {
    const d = decision({
      outcome: "in_progress",
      missing: ["email"],
      rejected: ["industry"],
    });
    expect(functionMessage("save_lead", d, { saved: false, position: null })).toBe(
      "Not finished yet. Still needed: email. Ask for email — one ask — then call save_lead again. Not recorded because they have not said it in their own words: industry. Do not repeat those values; ask about them plainly, or call save_lead again without them.",
    );
    const heldOnly = decision({ outcome: "in_progress", missing: [], rejected: ["industry"] });
    expect(functionMessage("save_lead", heldOnly, { saved: false, position: null })).toMatch(
      /^Not saved yet\. Not recorded because they have not said it in their own words: industry\./,
    );
  });

  it("holds the reveal until note_details comes back complete", () => {
    const open = decision({
      outcome: "in_progress",
      missing: ["operations"],
      rejected: ["industry"],
    });
    expect(functionMessage("note_details", open, { saved: false, position: null })).toBe(
      "Not recorded yet: industry, operations. Ask about industry plainly — one ask — in their own words, then call note_details again. Do not reveal yet.",
    );
    const done = decision({ outcome: "in_progress" });
    expect(functionMessage("note_details", done, { saved: false, position: null })).toMatch(
      /^Noted\. Now the reveal/,
    );
  });
});
