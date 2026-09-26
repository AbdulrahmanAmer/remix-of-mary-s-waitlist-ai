import { describe, expect, it } from "vitest";

import { buildPrompt, readState } from "@/lib/mary-prompt.server";
import { NO_BUSINESS, OPENERS, welcomeTurn, type TurnFlags } from "@/lib/mary.functions";
import { CUT_OFF_MARK } from "@/lib/voice-logic";

const a = (content: string) => ({ role: "assistant" as const, content });
const u = (content: string) => ({ role: "user" as const, content });
const base: TurnFlags = { revealed: false, lanesDone: false, introDone: true };
const phaseOf = (prompt: string) => prompt.split("\n")[0]!.replace("Current phase: ", "");

const intro = [a("Hi — I'm MARY."), a("What should I call you?")];
const known = {
  name: "Sarah",
  email: "sarah@brightpath.com",
  business: "Brightpath Realty",
  industry: "real estate",
  operations: "Zillow leads sit overnight",
};
/** The email was read back and confirmed, so it never blocks a later phase. */
const emailChecked = [
  u("sarah at brightpath dot com"),
  a("s-a-r-a-h, at brightpath dot com."),
  a("Did I get that right?"),
  u("yes"),
];

describe("WELCOME", () => {
  it("is a fixed opener that says what they get and how long it takes, ending on the name", () => {
    const prompt = buildPrompt([], {}, { revealed: false, lanesDone: false }, "", 2);
    expect(phaseOf(prompt)).toMatch(/^WELCOME/);
    expect(prompt).toContain(JSON.stringify(OPENERS[2]!.say));
    expect(prompt).toContain(JSON.stringify(OPENERS[2]!.followUp));
    for (const opener of OPENERS) {
      expect(opener.say).toContain("OmniSuite");
      expect(opener.say + " " + opener.followUp).toMatch(/two minutes/i);
      expect(opener.followUp).toMatch(/\?$/);
      expect((opener.say + " " + opener.followUp).split(/\s+/).length).toBeLessThanOrEqual(30);
      expect(opener.say + opener.followUp).not.toMatch(/convert|concierge|orchestrat/i);
    }
  });

  it("welcomeTurn is a finished turn with the intro marked heard", () => {
    const turn = welcomeTurn(1);
    expect(turn.say).toBe(OPENERS[1]!.say);
    expect(turn.followUp).toBe(OPENERS[1]!.followUp);
    expect(turn.introDone).toBe(true);
    expect(turn.complete).toBe(false);
    expect(welcomeTurn(OPENERS.length + 1).say).toBe(OPENERS[1]!.say);
  });

  it("resumes a cut-off intro instead of restarting it", () => {
    const prompt = buildPrompt(
      [a(`Hi — I'm ${CUT_OFF_MARK}`), u("what is this?")],
      {},
      { revealed: false, lanesDone: false, introDone: false },
    );
    expect(phaseOf(prompt)).toMatch(/^WELCOME, RESUMED/);
    expect(prompt).toMatch(/cut off/);
  });
});

describe("the spot", () => {
  it("needs only a name and an email, and says so instead of gating on the business", () => {
    const prompt = buildPrompt([...intro, u("Sarah")], { name: "Sarah" }, base);
    expect(prompt).toContain("The spot needs a name and an email; you have the name.");
    expect(prompt).not.toMatch(/Still missing: /);
    expect(prompt).toContain("never a condition for the spot");
  });

  it("once secured, tells her to close rather than send anyone away", () => {
    const prompt = buildPrompt(
      [...intro, u("Sarah"), ...emailChecked],
      { name: "Sarah", email: "sarah@brightpath.com" },
      base,
    );
    expect(prompt).toContain("their spot stands whatever else happens");
    expect(prompt).toContain("never send someone away without their spot");
  });
});

describe("the fast lane", () => {
  it("goes straight for the email when they are rushed", () => {
    const prompt = buildPrompt(
      [...intro, u("Mark. I've got two minutes.")],
      { name: "Mark" },
      { ...base, mode: "rushed" },
    );
    expect(phaseOf(prompt)).toMatch(/^SPOT — they are in a hurry/);
    expect(prompt).toContain("Quickest way to hold your spot, Mark, is your email");
    expect(prompt).not.toMatch(/^Current phase: (DISCOVER|LANES)/);
  });

  it("welcomes someone with no business the same way", () => {
    const prompt = buildPrompt(
      [...intro, u("Sam, I'm a student, just curious")],
      { name: "Sam", business: NO_BUSINESS },
      base,
    );
    expect(phaseOf(prompt)).toMatch(/^SPOT — they have no business of their own, which is fine/);
    expect(prompt).not.toMatch(/set declined true and phase EXIT/);
  });

  it("closes as soon as the read-back is confirmed, with no lanes and no wrap", () => {
    const prompt = buildPrompt(
      [
        ...intro,
        u("I'm Dana, only got a minute, dana k at gmail dot com."),
        a("Got you, Dana — d-a-n-a-k, at gmail dot com."),
        a("Did I get that right?"),
        u("Yep"),
      ],
      { name: "Dana", email: "danak@gmail.com" },
      { ...base, mode: "rushed" },
    );
    expect(phaseOf(prompt)).toMatch(/^CLOSE — the last turn/);
    expect(prompt).toContain(
      '"You\'re on the list, Dana — your invite goes to that email the moment early access opens."',
    );
  });

  it("still gets a name to put the email under", () => {
    const prompt = buildPrompt(
      [
        ...intro,
        u("just put me down, jo at acme dot com"),
        a("j-o, at acme dot com."),
        a("Did I get that right?"),
        u("yes"),
      ],
      { email: "jo@acme.com" },
      { ...base, mode: "rushed" },
    );
    expect(phaseOf(prompt)).toMatch(/^SPOT — the email is in; you only need a name/);
  });

  it("tells a rushed person's turn to keep the lane unless they settle in", () => {
    const prompt = buildPrompt(
      [...intro, u("Mark, quick")],
      { name: "Mark" },
      { ...base, mode: "rushed" },
    );
    expect(prompt).toContain("keep mode rushed unless they clearly settle in");
  });
});

describe("email at the peak", () => {
  it("the reveal's follow-up is the email ask when the email is missing", () => {
    const prompt = buildPrompt(
      [
        ...intro,
        u("Sarah"),
        a("What's the business?"),
        u("Brightpath Realty, real estate, Zillow leads sit overnight"),
      ],
      { ...known, email: "" },
      base,
    );
    expect(phaseOf(prompt)).toMatch(/^REVEAL/);
    expect(prompt).toContain("where should your invite go?");
  });

  it("the reveal offers the phone instead when the email is in, and lets it land when that is done too", () => {
    const withEmail = buildPrompt([...intro, u("Sarah"), ...emailChecked], known, base);
    expect(phaseOf(withEmail)).toMatch(/^REVEAL/);
    expect(withEmail).toContain("Number's optional");

    const withPhone = buildPrompt(
      [...intro, u("Sarah"), ...emailChecked, a("Want to add a number?"), u("no")],
      { ...known, phone: "skipped" },
      base,
    );
    expect(phaseOf(withPhone)).toContain(
      "let it land; this is the one turn allowed to end on a statement",
    );
  });

  it("reads a spoken address back before anything else, until it has been read back", () => {
    const unread = buildPrompt(
      [
        ...intro,
        u("Sarah"),
        a("That's Convert."),
        a("Where should your invite go?"),
        u("sarah at brightpath dot com"),
      ],
      known,
      { ...base, revealed: true },
    );
    expect(phaseOf(unread)).toMatch(/^EMAIL — they gave you an address by voice/);
    expect(unread).toContain('"Did I get that right?"');

    const read = buildPrompt(
      [
        ...intro,
        u("Sarah"),
        a("That's Convert."),
        a("Where should your invite go?"),
        ...emailChecked,
      ],
      known,
      { ...base, revealed: true },
    );
    expect(phaseOf(read)).toMatch(/^LANES/);
  });

  it("a corrected address is read back again", () => {
    const prompt = buildPrompt(
      [
        ...intro,
        u("Sarah"),
        ...emailChecked,
        a("Locked in."),
        u("no wait, it's sara without the h"),
      ],
      { ...known, email: "sara@brightpath.com" },
      { ...base, revealed: true },
    );
    expect(phaseOf(prompt)).toMatch(/^EMAIL/);
  });

  it("the instruction to read an email back rides on every turn", () => {
    const prompt = buildPrompt([...intro, u("Sarah")], { name: "Sarah" }, base);
    expect(prompt).toContain("The turn an email arrives in, whatever the phase says");
    expect(prompt).toContain("d-a-n-a-k, at gmail dot com");
  });
});

describe("after the reveal", () => {
  const revealed = { ...base, revealed: true };
  const afterEmail = [...intro, u("Sarah"), a("That's Convert."), ...emailChecked];

  it("LANES carries the phone offer, then the wrap question, as its follow-up", () => {
    const first = buildPrompt(afterEmail, known, revealed);
    expect(phaseOf(first)).toMatch(/^LANES/);
    expect(first).toContain("Number's optional");

    const second = buildPrompt(
      [...afterEmail, a("Number's optional — want to add one?"), u("no thanks")],
      { ...known, phone: "skipped" },
      revealed,
    );
    expect(phaseOf(second)).toMatch(/^LANES/);
    expect(second).toContain(
      '"Anything you want to ask before I lock it in?" — and set wrapAsked true',
    );
  });

  it("skips LANES when they are rushed, and never replays a lanes line they cut off", () => {
    const rushed = buildPrompt(afterEmail, known, { ...revealed, mode: "rushed" });
    expect(phaseOf(rushed)).toMatch(/^CLOSE/);

    const cutOff = buildPrompt(
      [
        ...afterEmail,
        a(`Cultivate does the same to your old list ${CUT_OFF_MARK}`),
        u("wait, what does it cost?"),
      ],
      known,
      revealed,
    );
    expect(phaseOf(cutOff)).toMatch(/^CONTACT — the spot is secured/);
    expect(cutOff).toContain("Number's optional");
  });

  it("WRAP is a recap that reads the email plainly, then CLOSE is the honest next step", () => {
    const wrap = buildPrompt(
      [...afterEmail, a("Cultivate and Recover."), a("Number's optional?"), u("no")],
      { ...known, phone: "skipped" },
      { ...revealed, lanesDone: true },
    );
    expect(phaseOf(wrap)).toMatch(/^WRAP/);
    expect(wrap).toContain(
      "the invite goes to sarah@brightpath.com (say the address once, plainly, no spelling)",
    );
    expect(wrap).toContain('"Anything you want to ask before I lock it in?"');

    const close = buildPrompt(
      [
        ...afterEmail,
        a("Number's optional?"),
        u("no"),
        a("Anything you want to ask before I lock it in?"),
        u("What does it cost?"),
      ],
      { ...known, phone: "skipped" },
      { ...revealed, lanesDone: true },
    );
    expect(phaseOf(close)).toMatch(/^CLOSE — they've answered your wrap question/);
    expect(close).toContain(
      "You're on the list, Sarah — your invite goes to that email the moment early access opens.",
    );
    expect(phaseOf(close)).not.toMatch(/product by Omnikom|be in touch|confirmation/);
  });

  it("asks for a missing email again after the lanes, tied to the spot", () => {
    const prompt = buildPrompt(
      [
        ...intro,
        u("Sarah"),
        a("That's Convert."),
        a("Where should your invite go?"),
        u("later maybe"),
        a("Cultivate and Recover..."),
        u("ok"),
      ],
      { ...known, email: "" },
      { ...revealed, lanesDone: true },
    );
    expect(phaseOf(prompt)).toMatch(/^CONTACT — everything else is known/);
    expect(prompt).toContain("Quickest way to hold your spot, Sarah, is your email");
  });
});

describe("honesty and callbacks", () => {
  it("never lets her promise what nothing delivers", () => {
    const prompt = buildPrompt([...intro, u("Sarah")], { name: "Sarah" }, base);
    expect(prompt).toContain("Nothing here sends a confirmation email");
    expect(prompt).toContain(
      "Never promise a confirmation email, a day, a time, or that anyone already has it",
    );
    expect(prompt).not.toMatch(/early-access confirmation|request is with the team/);
  });

  it("the final callback turn says the number is noted, not that the team has it", () => {
    const prompt = buildPrompt(
      [...intro, u("call me back"), a("What's the number?"), u("555 123 4567")],
      { name: "Sarah", phone: "555 123 4567" },
      { ...base, callback: true },
    );
    expect(phaseOf(prompt)).toMatch(/^CALLBACK, FINAL TURN/);
    expect(prompt).toContain("never that it has already reached anyone");
    expect(prompt).not.toContain("request is with the team");
  });
});

describe("the rules that settle the old contradictions", () => {
  const prompt = buildPrompt([...intro, u("Sarah")], { name: "Sarah" }, base);

  it("names the reveal as the drive rule's exception and allows the two check questions", () => {
    expect(prompt).toContain(
      "or a REVEAL with nothing left to ask, every turn must END on one concrete move",
    );
    expect(prompt).toContain(
      'Two questions are allowed as written: the wrap question, and "Did I get that right?"',
    );
    expect(prompt).not.toMatch(/never mention the waitlist offer again/);
  });

  it("makes the word cap hard and acts on the last missing detail at once", () => {
    expect(prompt).toContain(
      "Hard limit: 25 words for the whole turn, both beats together (LANES may use 35)",
    );
    expect(prompt).toContain(
      "If their last message supplies the last missing detail, do not ask for it again: reveal in this turn.",
    );
  });

  it("tells her what a rejected email means", () => {
    const rejected = buildPrompt(
      [...intro, u("Sarah")],
      { name: "Sarah" },
      { ...base, rejected: ["email"] },
    );
    expect(rejected).toContain("type it in the box on screen");
  });
});

describe("readState", () => {
  it("derives what the record supports rather than trusting flags alone", () => {
    const state = readState(
      [
        ...intro,
        u("Sarah"),
        ...emailChecked,
        a("Number's optional — want to add one?"),
        u("nah"),
        a("So: Sarah. Anything you want to ask before I lock it in?"),
      ],
      known,
      base,
    );
    expect(state.spot).toBe(true);
    expect(state.emailChecked).toBe(true);
    expect(state.phoneOffered).toBe(true);
    expect(state.wrapAsked).toBe(true);
    expect(state.discoveryDone).toBe(true);
    expect(state.noBusiness).toBe(false);
  });

  it("does not count 'who picks up the phone?' as a phone offer", () => {
    const state = readState(
      [...intro, u("Sarah"), a("Who picks up when the phone rings at seven?")],
      { name: "Sarah" },
      base,
    );
    expect(state.phoneOffered).toBe(false);
  });

  it("treats a no-business record as discovery that will never finish", () => {
    const state = readState(
      [...intro, u("Sam")],
      { name: "Sam", business: NO_BUSINESS, industry: "x", operations: "y" },
      base,
    );
    expect(state.noBusiness).toBe(true);
    expect(state.discoveryDone).toBe(false);
  });
});
