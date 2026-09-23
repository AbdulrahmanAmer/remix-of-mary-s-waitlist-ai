import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useState } from "react";

import {
  audioDiagnostics,
  isAppleMobile,
  isInAppBrowser,
  primeMicPermission,
  releasePrimedMic,
  setAudioSessionType,
  setOutputRoute,
  speak,
  unlockAudio,
} from "@/lib/audio-engine";

/**
 * On-phone sound check: plays a sound through each output route MARY could use
 * and records what the device reports alongside what the person heard. One
 * screenshot of this page tells which layer is silent on a given phone.
 *
 * Every test starts its sound in the first, synchronous part of its tap: iOS
 * only lets a page start sound while the tap is being handled.
 */
export const Route = createFileRoute("/soundcheck")({
  head: () => ({ meta: [{ title: "MARY sound check" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <ClientOnly fallback={null}>
      <SoundCheck />
    </ClientOnly>
  ),
});

type Result = { test: string; heard: "yes" | "no" | "?"; state: string };
type SessionType = "playback" | "play-and-record" | "auto";

const RATE = 48000;

/** Two seconds of a clear two-tone chime, easy to tell from background noise. */
function chime(ctx: BaseAudioContext): AudioBuffer {
  const length = RATE * 2;
  const buffer = ctx.createBuffer(1, length, RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    const f = t < 1 ? 660 : 880;
    const env = Math.min(1, t * 20) * Math.min(1, (2 - t) * 20);
    data[i] = Math.sin(2 * Math.PI * f * t) * 0.5 * env;
  }
  return buffer;
}

function wavUrl(): string {
  const length = RATE * 2;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const text = (o: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * (t < 1 ? 523 : 784) * t) * 0.5 * 32767, true);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

let ctx: AudioContext | null = null;
function context(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx;
}

function sessionType(): string {
  return (navigator as unknown as { audioSession?: { type: string } }).audioSession?.type ?? "n/a";
}

function describe(extra = ""): string {
  const c = ctx;
  return [c ? `ctx ${c.state} ${c.sampleRate}Hz` : "ctx none", `session ${sessionType()}`, extra]
    .filter(Boolean)
    .join(" · ");
}

/** Which phone, system and browser this is: the same page behaves differently across them. */
function deviceLine(): string {
  const ua = navigator.userAgent;
  const os = /OS (\d+)_(\d+)(?:_(\d+))?/.exec(ua);
  const safari = /Version\/([\d.]+)/.exec(ua);
  const browser = /CriOS/.test(ua)
    ? "Chrome"
    : /FxiOS/.test(ua)
      ? "Firefox"
      : /EdgiOS/.test(ua)
        ? "Edge"
        : isInAppBrowser()
          ? "in-app browser"
          : safari
            ? `Safari ${safari[1]}`
            : "other";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches
    ? " · home screen"
    : "";
  // iOS 26 and later freeze the user agent at "OS 18_6"; Safari's own version matches iOS there.
  const frozen = os?.[1] === "18" && os[2] === "6";
  const safariMajor = Number(safari?.[1]?.split(".")[0] ?? 0);
  const system = !os
    ? "not iOS"
    : frozen && safariMajor >= 26
      ? `iOS ${safari?.[1]}`
      : frozen
        ? "iOS 18.6 or later"
        : `iOS ${os[1]}.${os[2]}${os[3] ? `.${os[3]}` : ""}`;
  return [
    system,
    browser,
    `audioSession ${"audioSession" in navigator ? "yes" : "no"}`,
    window.top === window ? "top frame" : "inside a frame",
  ]
    .join(" · ")
    .concat(standalone);
}

/** Every Web Audio test sets the session type itself, so earlier tests don't leak into it. */
function setSession(type: SessionType): string {
  setAudioSessionType(type);
  const now = sessionType();
  return now === type || now === "n/a" ? "" : `asked ${type}, got ${now}`;
}

function playChime(into?: AudioNode): Promise<void> {
  const c = context();
  const source = c.createBufferSource();
  source.buffer = chime(c);
  source.connect(into ?? c.destination);
  source.start();
  return new Promise((resolve) => (source.onended = () => resolve()));
}

/**
 * MARY's iPhone route (ElevenLabs' too): Web Audio into a MediaStream, played
 * by a hidden <audio> element. Built and told to play inside the tap.
 */
let routeNode: MediaStreamAudioDestinationNode | null = null;
let routeElement: HTMLAudioElement | null = null;
function startElementRoute(): {
  node: AudioNode;
  element: HTMLAudioElement;
  ready: Promise<string>;
} {
  const c = context();
  if (!routeNode || !routeElement) {
    routeNode = c.createMediaStreamDestination();
    routeElement = document.createElement("audio");
    routeElement.setAttribute("playsinline", "");
    routeElement.autoplay = true;
    routeElement.style.display = "none";
    document.body.appendChild(routeElement);
    routeElement.srcObject = routeNode.stream;
  }
  const element = routeElement;
  const ready = element.play().then(
    () => "",
    (e: unknown) => `play() ${(e as Error).name}`,
  );
  return { node: routeNode, element, ready };
}

function elementState(element: HTMLAudioElement, error: string): string {
  return `element ${element.paused ? "paused" : "playing"} t=${element.currentTime.toFixed(2)} ${error}`.trim();
}

function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

async function loopbackElement(): Promise<string> {
  const c = context();
  const node = c.createMediaStreamDestination();
  const source = c.createBufferSource();
  source.buffer = chime(c);
  source.connect(node);
  const from = new RTCPeerConnection();
  const to = new RTCPeerConnection();
  from.onicecandidate = (e) => e.candidate && void to.addIceCandidate(e.candidate);
  to.onicecandidate = (e) => e.candidate && void from.addIceCandidate(e.candidate);
  const got = new Promise<MediaStream>((resolve) => {
    to.ontrack = (e) => resolve(new MediaStream([e.track]));
  });
  for (const track of node.stream.getAudioTracks()) from.addTrack(track, node.stream);
  const offer = await from.createOffer();
  await from.setLocalDescription(offer);
  await to.setRemoteDescription(offer);
  const answer = await to.createAnswer();
  await to.setLocalDescription(answer);
  await from.setRemoteDescription(answer);
  const element = document.createElement("audio");
  element.setAttribute("playsinline", "");
  element.srcObject = await got;
  let error = "";
  await element.play().catch((e: unknown) => (error = `play() ${(e as Error).name}`));
  source.start();
  await new Promise((r) => setTimeout(r, 2200));
  const state = elementState(element, error);
  element.srcObject = null;
  from.close();
  to.close();
  return state;
}

const TESTS: { id: string; label: string; run: () => Promise<string> }[] = [
  {
    id: "file",
    label: "1 · Plain audio file",
    run: async () => {
      const element = new Audio(wavUrl());
      let error = "";
      await element.play().catch((e: unknown) => (error = `play() ${(e as Error).name}`));
      await new Promise((r) => setTimeout(r, 2200));
      return `element ${element.paused && !element.ended ? "paused" : "played"} ${error}`;
    },
  },
  {
    id: "element",
    label: "2 · New iPhone route: Web Audio → <audio> element",
    run: async () => {
      const note = setSession("auto");
      const route = startElementRoute();
      const error = await route.ready;
      await playChime(route.node);
      return [elementState(route.element, error), note].filter(Boolean).join(" · ");
    },
  },
  {
    id: "element-mic",
    label: "3 · New route with the mic open (as in a call)",
    run: async () => {
      const note = setSession("auto");
      const mic = openMic();
      const route = startElementRoute();
      const stream = await mic;
      const error = await route.ready;
      await playChime(route.node);
      const state = elementState(route.element, error);
      stream.getTracks().forEach((t) => t.stop());
      return [state, "mic was open", note].filter(Boolean).join(" · ");
    },
  },
  {
    id: "mary",
    label: "4 · MARY's real voice, started the way the app starts a call",
    run: async () => {
      setSession("auto");
      // Same tap order as the app: microphone request, route, unlock; then her line.
      const mic = primeMicPermission().then(
        () => "",
        (e: unknown) => `mic ${(e as Error).message}`,
      );
      setOutputRoute(isAppleMobile() ? "element" : "call");
      await unlockAudio();
      const micNote = await mic;
      const handle = speak("Hi, this is MARY. If you can hear me, the new sound path works.");
      await handle.done;
      releasePrimedMic();
      const d = audioDiagnostics();
      return [
        `engine ${d.context} ${d.sampleRate}Hz route=${d.route}`,
        `element=${d.elementPaused ? "paused" : "playing"} direct=${d.directOutput}`,
        micNote,
      ]
        .filter(Boolean)
        .join(" ");
    },
  },
  {
    id: "webaudio",
    label: "5 · Web Audio only (last week's route)",
    run: async () => {
      const note = setSession("auto");
      await playChime();
      return note;
    },
  },
  {
    id: "webaudio-playback",
    label: "6 · Web Audio only, audio session 'playback'",
    run: async () => {
      const note = setSession("playback");
      await playChime();
      setSession("auto");
      return note;
    },
  },
  {
    id: "loopback",
    label: "7 · Call route (the app before that)",
    run: async () => {
      setSession("auto");
      return loopbackElement();
    },
  },
];

function SoundCheck() {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState("");
  const [ring, setRing] = useState<"ring" | "silent" | "?">("?");
  const [copied, setCopied] = useState(false);

  const run = async (test: (typeof TESTS)[number]) => {
    setBusy(test.id);
    let detail = "";
    try {
      detail = await test.run();
    } catch (error) {
      detail = `error: ${(error as Error).name} ${(error as Error).message}`;
    }
    setResults((all) => [
      ...all.filter((r) => r.test !== test.label),
      { test: test.label, heard: "?", state: describe(detail) },
    ]);
    setBusy("");
  };

  const mark = (label: string, heard: "yes" | "no") =>
    setResults((all) => all.map((r) => (r.test === label ? { ...r, heard } : r)));

  const summary = [
    deviceLine(),
    `ring switch: ${ring}`,
    navigator.userAgent,
    ...results.map((r) => `${r.test}: heard=${r.heard} | ${r.state}`),
  ].join("\n");

  const copy = () => {
    void navigator.clipboard?.writeText(summary).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-ink">
      <h1 className="font-display text-2xl font-medium">MARY sound check</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Volume up. Tap each test, listen for a two-note chime (or MARY's voice), then mark what you
        heard. Run it once with the ring switch on silent and once with it on ring, then copy the
        results and send them over.
      </p>
      <p className="mt-2 font-mono text-[0.7rem] text-muted-foreground">{deviceLine()}</p>
      <div className="mt-4 flex items-center gap-2 text-sm">
        <span>Ring switch right now:</span>
        {(["ring", "silent"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRing(value)}
            className={`rounded-full px-3 py-1.5 ring-1 ring-border ${ring === value ? "bg-ink text-background" : ""}`}
          >
            {value === "ring" ? "Ring" : "Silent"}
          </button>
        ))}
      </div>
      <ol className="mt-6 space-y-3">
        {TESTS.map((test) => {
          const result = results.find((r) => r.test === test.label);
          return (
            <li key={test.id} className="rounded-2xl bg-card p-3 ring-1 ring-border">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void run(test)}
                className="w-full rounded-full bg-primary px-4 py-3 text-left font-medium text-ink disabled:opacity-50"
              >
                {busy === test.id ? "Playing…" : test.label}
              </button>
              {result && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => mark(test.label, "yes")}
                    className={`rounded-full px-3 py-1.5 ring-1 ring-border ${result.heard === "yes" ? "bg-ink text-background" : ""}`}
                  >
                    Heard it
                  </button>
                  <button
                    type="button"
                    onClick={() => mark(test.label, "no")}
                    className={`rounded-full px-3 py-1.5 ring-1 ring-border ${result.heard === "no" ? "bg-ink text-background" : ""}`}
                  >
                    Silent
                  </button>
                  <span className="text-muted-foreground">{result.state}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <textarea
        readOnly
        value={summary}
        rows={12}
        aria-label="Sound check results"
        className="mt-6 w-full rounded-2xl bg-card p-3 font-mono text-[0.7rem] ring-1 ring-border"
      />
      <button
        type="button"
        onClick={copy}
        className="mt-2 rounded-full px-4 py-2 text-sm ring-1 ring-border"
      >
        {copied ? "Copied" : "Copy results"}
      </button>
    </main>
  );
}
