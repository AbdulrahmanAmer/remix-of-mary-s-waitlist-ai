import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useState } from "react";

import {
  audioDiagnostics,
  isAppleMobile,
  setAudioSessionType,
  setDirectOutput,
  speak,
  unlockAudio,
} from "@/lib/audio-engine";

/**
 * On-phone sound check: plays a sound through each output route MARY could use
 * and records what the device reports alongside what the person heard. One
 * screenshot of this page tells which layer is silent on a given phone.
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

function playChime(): Promise<void> {
  const c = context();
  const source = c.createBufferSource();
  source.buffer = chime(c);
  source.connect(c.destination);
  source.start();
  return new Promise((resolve) => (source.onended = () => resolve()));
}

async function openMic(): Promise<MediaStream> {
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
  const state = `element ${element.paused ? "paused" : "playing"} t=${element.currentTime.toFixed(2)} ${error}`;
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
    id: "webaudio",
    label: "2 · Web Audio (new iPhone path)",
    run: async () => {
      setAudioSessionType("playback");
      await playChime();
      return "";
    },
  },
  {
    id: "after-mic",
    label: "3 · Web Audio after mic on then off",
    run: async () => {
      setAudioSessionType("play-and-record");
      const stream = await openMic();
      await new Promise((r) => setTimeout(r, 600));
      stream.getTracks().forEach((t) => t.stop());
      setAudioSessionType("playback");
      await new Promise((r) => setTimeout(r, 300));
      await playChime();
      return "mic opened and released";
    },
  },
  {
    id: "mic-open",
    label: "4 · Web Audio while mic is open (old app)",
    run: async () => {
      const stream = await openMic();
      await playChime();
      stream.getTracks().forEach((t) => t.stop());
      setAudioSessionType("playback");
      return "mic was open during the chime";
    },
  },
  {
    id: "loopback",
    label: "5 · Call route (old app)",
    run: loopbackElement,
  },
  {
    id: "mary",
    label: "6 · MARY's real voice (new path)",
    run: async () => {
      setDirectOutput(isAppleMobile());
      await unlockAudio();
      setAudioSessionType("playback");
      const handle = speak("Hi, this is MARY. If you can hear me, the new sound path works.");
      await handle.done;
      const d = audioDiagnostics();
      return `engine ${d.context} ${d.sampleRate}Hz direct=${d.directOutput}`;
    },
  },
];

function SoundCheck() {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState("");

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
    `${navigator.userAgent}`,
    ...results.map((r) => `${r.test}: heard=${r.heard} | ${r.state}`),
  ].join("\n");

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-ink">
      <h1 className="font-display text-2xl font-medium">MARY sound check</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Volume up, ring switch on. Tap each test, listen for a two-note chime (or MARY's voice),
        then mark what you heard. Screenshot the box at the bottom and send it over.
      </p>
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
        rows={10}
        aria-label="Sound check results"
        className="mt-6 w-full rounded-2xl bg-card p-3 font-mono text-[0.7rem] ring-1 ring-border"
      />
    </main>
  );
}
