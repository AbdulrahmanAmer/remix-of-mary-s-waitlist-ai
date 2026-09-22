/**
 * Pure decision logic for the live call. No DOM, no audio APIs — everything in
 * here is deterministic so it can be reasoned about and tested on its own.
 *
 * Three jobs:
 *   1. Tell MARY's own voice apart from the person's (transcript matching).
 *   2. Decide whether a sound over her speech is a real interruption
 *      (playback-aware echo model).
 *   3. Small conversational helpers: backchannels, cut-in commands,
 *      end-of-turn pacing and truncating an interrupted line.
 */

/** Appended to a MARY line she never got to finish, so the model knows. */
export const CUT_OFF_MARK = "[cut off here — they spoke over you and did not hear the rest]";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "on",
  "in",
  "and",
  "or",
  "so",
  "it",
  "is",
  "i",
  "im",
  "you",
  "we",
  "me",
  "my",
  "your",
  "that",
  "thats",
  "this",
  "for",
  "at",
  "with",
  "as",
  "be",
  "do",
  "are",
  "was",
  "up",
  "out",
  "if",
  "but",
  "by",
  "from",
  "they",
  "them",
  "what",
  "who",
  "how",
  "all",
  "not",
  "no",
  "yes",
  "oh",
  "um",
  "uh",
  "its",
  "just",
  "then",
  "than",
  "there",
  "here",
  "when",
  "one",
  "get",
  "got",
  "can",
  "will",
  "would",
  "ive",
  "youre",
  "were",
  "theyre",
  "dont",
  "cant",
  "wont",
  "isnt",
  "have",
  "has",
  "had",
  "been",
  "being",
  "did",
  "does",
  "any",
  "some",
  "very",
  "too",
  "also",
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s@.]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

export function contentTokens(list: string[]): string[] {
  return list.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function ngrams(list: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(" "));
  return out;
}

/**
 * True when a transcript is (mostly) MARY's own words coming back through the
 * microphone. Robust to speech recognition dropping small words or garbling a
 * syllable: both contiguous n-gram overlap and content-word overlap count.
 */
export function isEchoOfAssistant(transcript: string, assistantLines: string[]): boolean {
  const user = tokens(transcript);
  if (user.length === 0) return false;
  const assistant = tokens(assistantLines.join(" "));
  if (assistant.length === 0) return false;

  const userJoined = ` ${user.join(" ")} `;
  const assistantJoined = ` ${assistant.join(" ")} `;
  // A single word is only echo if it is a distinctive word she just used.
  if (user.length === 1) {
    const word = user[0]!;
    return word.length >= 5 && !STOPWORDS.has(word) && assistantJoined.includes(` ${word} `);
  }
  if (assistantJoined.includes(userJoined.trim())) return true;

  const overlapOf = (n: number) => {
    const userGrams = ngrams(user, n);
    const assistantGrams = ngrams(assistant, n);
    let hits = 0;
    for (const gram of userGrams) if (assistantGrams.has(gram)) hits += 1;
    return userGrams.size > 0 ? hits / userGrams.size : 0;
  };
  if (overlapOf(Math.min(3, user.length)) >= 0.6) return true;

  const userContent = contentTokens(user);
  const assistantContent = new Set(contentTokens(assistant));
  let contentHits = 0;
  for (const word of userContent) if (assistantContent.has(word)) contentHits += 1;
  const contentRatio = userContent.length ? contentHits / userContent.length : 0;
  if (userContent.length >= 2 && contentRatio >= 0.6) return true;

  // Short garbles ("come for running on you"): half the word pairs are hers
  // and at least half of the real words are hers.
  if (user.length <= 6 && overlapOf(2) >= 0.5 && contentRatio >= 0.5) return true;
  return false;
}

/**
 * Removes MARY's words from the edges of a transcript that caught both voices,
 * e.g. "that's convert running actually I run a bakery" → "actually I run a bakery".
 * Only contiguous runs of two or more of her words are stripped, so a person
 * who genuinely reuses one of her words keeps it.
 */
export function stripAssistantEcho(transcript: string, assistantLines: string[]): string {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length < 2) return transcript.trim();
  const assistant = tokens(assistantLines.join(" "));
  if (assistant.length === 0) return transcript.trim();
  const assistantJoined = ` ${assistant.join(" ")} `;
  const norm = words.map((w) => tokens(w)[0] ?? "");

  const runFromStart = () => {
    let best = 0;
    for (let end = 2; end <= norm.length; end++) {
      const gram = norm.slice(0, end).filter(Boolean).join(" ");
      if (gram && assistantJoined.includes(` ${gram} `)) best = end;
      else if (end > 2) break;
    }
    return best;
  };
  const runFromEnd = () => {
    let best = 0;
    for (let size = 2; size <= norm.length; size++) {
      const gram = norm
        .slice(norm.length - size)
        .filter(Boolean)
        .join(" ");
      if (gram && assistantJoined.includes(` ${gram} `)) best = size;
      else if (size > 2) break;
    }
    return best;
  };

  const head = runFromStart();
  const tail = head >= words.length ? 0 : runFromEnd();
  const kept = words.slice(head, words.length - tail);
  return kept.join(" ").trim();
}

const BACKCHANNELS = new Set([
  "yeah",
  "yep",
  "yes",
  "ok",
  "okay",
  "mhm",
  "mm",
  "mmhmm",
  "mm-hmm",
  "uh-huh",
  "uhhuh",
  "right",
  "sure",
  "gotit",
  "got it",
  "i see",
  "cool",
  "nice",
  "true",
  "hm",
  "hmm",
  "aha",
  "alright",
  "great",
  "good",
  "oh",
  "wow",
]);

/** Short acknowledgements that should never cut MARY off. */
export function isBackchannel(text: string): boolean {
  const list = tokens(text);
  if (list.length === 0 || list.length > 3) return false;
  const joined = list.join(" ");
  if (BACKCHANNELS.has(joined)) return true;
  return list.every((t) => BACKCHANNELS.has(t));
}

const INTERRUPT_COMMANDS = [
  "stop",
  "wait",
  "hold on",
  "hang on",
  "pause",
  "no",
  "hey",
  "excuse me",
  "one sec",
  "one second",
  "actually",
  "sorry",
  "question",
  "hmm no",
  "not really",
  "no no",
];

/** Words that mean "let me in" and should interrupt immediately, however short. */
export function isInterruptCommand(text: string): boolean {
  const joined = tokens(text).join(" ");
  if (!joined) return false;
  return INTERRUPT_COMMANDS.some(
    (cmd) => joined === cmd || joined.startsWith(`${cmd} `) || joined.endsWith(` ${cmd}`),
  );
}

/**
 * Is this transcript, heard while MARY speaks, enough to call it a genuine
 * interruption? Her own echo and mere acknowledgements never are; a cut-in
 * command always is; otherwise two real words will do.
 */
export function transcriptConfirmsInterrupt(text: string, assistantLines: string[]): boolean {
  const clean = stripAssistantEcho(text, assistantLines);
  if (!clean) return false;
  if (isEchoOfAssistant(clean, assistantLines)) return false;
  if (isInterruptCommand(clean)) return true;
  if (isBackchannel(clean)) return false;
  return tokens(clean).length >= 2;
}

/**
 * Playback-aware echo model. Fed once per animation frame with the microphone
 * peak and the speaker peak, it estimates how loud MARY's own voice is in the
 * microphone right now and how much of it is still ringing after she stops.
 */
export class EchoTracker {
  private history: { t: number; playback: number }[] = [];
  private coupling = 0.35;
  private tail = 0;
  private lastPlaybackAt = 0;
  /** Highest coupling seen this session — the "are they on speakers?" signal. */
  peakCoupling = 0;

  update(mic: number, playback: number, now: number) {
    this.history.push({ t: now, playback });
    while (this.history.length && now - this.history[0]!.t > 600) this.history.shift();

    let lagged = 0;
    let recent = 0;
    for (const frame of this.history) {
      const age = now - frame.t;
      if (age >= 30 && age <= 260 && frame.playback > lagged) lagged = frame.playback;
      if (age <= 320 && frame.playback > recent) recent = frame.playback;
    }

    if (playback > 0.02) this.lastPlaybackAt = now;

    // Learn how much of her voice the mic hears, slowly upward, quickly downward.
    if (lagged > 0.06) {
      const instant = Math.min(2.5, mic / lagged);
      const alpha = instant > this.coupling ? 0.03 : 0.12;
      this.coupling += alpha * (instant - this.coupling);
      if (this.coupling > this.peakCoupling) this.peakCoupling = this.coupling;
    }

    let expected = this.coupling * recent;
    if (recent > 0.02) this.tail = expected;
    else {
      this.tail *= 0.9;
      expected = Math.max(expected, this.tail);
    }
    return {
      expectedEcho: expected,
      coupling: this.coupling,
      /** Milliseconds since she last made a sound (Infinity if never). */
      sincePlayback: this.lastPlaybackAt ? now - this.lastPlaybackAt : Infinity,
    };
  }

  /** A false interruption means the mic hears her louder than we thought. */
  learnFalseInterrupt() {
    this.coupling = Math.min(2.5, this.coupling * 1.35 + 0.05);
    if (this.coupling > this.peakCoupling) this.peakCoupling = this.coupling;
  }
}

/**
 * How long to wait after the person goes quiet before treating the turn as
 * done. People pause mid-thought after "and", and between the chunks of an
 * email or a phone number — waiting a beat longer there keeps MARY from
 * jumping in halfway through.
 */
export function endpointDelayMs(transcript: string, base = 800): number {
  const list = tokens(transcript);
  const last = list[list.length - 1] ?? "";
  if (!last) return base;
  if (/^(and|but|so|or|um|uh|because|like|with|the|a|to|my|is|its)$/.test(last)) return base + 700;
  if (/^(at|dot|com|gmail|yahoo|outlook|hotmail|underscore|dash)$/.test(last) || last.includes("@"))
    return base + 1200;
  if (/^\d+$/.test(last) || /^(zero|one|two|three|four|five|six|seven|eight|nine|oh)$/.test(last))
    return base + 1000;
  if (/[.!?]$/.test(transcript.trim())) return Math.max(350, base - 250);
  return base;
}

/**
 * The part of a line that was actually heard before the person cut in.
 * `fraction` is playback progress 0..1; a whole word is counted only once it
 * has been fully voiced.
 */
export function spokenPortion(text: string, fraction: number): { spoken: string; cut: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { spoken: "", cut: false };
  const count = Math.max(0, Math.min(words.length, Math.floor(fraction * words.length + 0.02)));
  if (count >= words.length) return { spoken: text.trim(), cut: false };
  return { spoken: words.slice(0, count).join(" "), cut: true };
}
