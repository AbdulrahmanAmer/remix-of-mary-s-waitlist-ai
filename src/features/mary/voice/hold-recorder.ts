/**
 * Hold-to-talk capture. In a loud room no automatic detector can reliably tell the
 * person at the device from the people around them; holding the button makes that
 * explicit. Only audio captured while the button is held is ever sent, so nothing
 * the room says can start a turn.
 *
 * The microphone opens once for the call (with the browser's echo cancellation,
 * noise suppression and auto gain), reusing the one opened in the tap, so a press
 * starts instantly. Elsewhere its track is disabled between holds. On iPhone and
 * iPad it stays live, as it does in ElevenLabs' and every other voice SDK: while
 * the page is capturing, iOS keeps it in "play and record" (loudspeaker, not
 * muted by the ring switch) and lets its audio start without a tap. Frames that
 * arrive outside a hold are dropped here.
 */
import { noteMicTrack, takePrimedMic } from "@/lib/audio-engine";

const TARGET_RATE = 16000;
/** The press itself (a thumb on glass, a click) lands in the first ~100 ms. */
const PRESS_THUMP_MS = 100;

const WORKLET = `
class HoldCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("hold-capture", HoldCapture);
`;

export type HoldClip = { blob: Blob | null; durationMs: number; peak: number };

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the samples that fold into this one: a cheap low-pass against aliasing.
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function wav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class HoldRecorder {
  /** Loudness while recording, 0..1, for the orb. */
  onLevel: (level: number) => void = () => {};

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private ctx: AudioContext | null = null;
  private input: AudioNode | null = null;
  private teardown: (() => void) | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private startedAt = 0;
  private skipUntil = 0;
  private peak = 0;
  /** Bumped by close(), so an open() still in flight knows it was abandoned. */
  private generation = 0;
  private opening: Promise<void> | null = null;
  private openingFor = -1;

  /** `keepTrackLive`: never disable the track between holds (iPhone, iPad). */
  constructor(private readonly keepTrackLive = false) {}

  /** Open and still live: a backgrounded tab or a phone call can end the track. */
  get isOpen(): boolean {
    return this.stream?.getAudioTracks()[0]?.readyState === "live";
  }

  open(): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    // Two presses racing the first open share it: a second microphone would leak.
    if (this.opening && this.openingFor === this.generation) return this.opening;
    this.openingFor = this.generation;
    const opening = this.openLine().finally(() => {
      if (this.opening === opening) this.opening = null;
    });
    this.opening = opening;
    return opening;
  }

  private async openLine(): Promise<void> {
    this.releaseMic();
    const generation = this.generation;
    let stream = takePrimedMic();
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    }
    const line = stream;
    // The call ended (or the mode changed) while the microphone was opening: let it go.
    const abandoned = () => {
      if (generation === this.generation) return false;
      for (const track of line.getTracks()) track.stop();
      return true;
    };
    if (abandoned()) return;
    if (!this.keepTrackLive) for (const track of line.getAudioTracks()) track.enabled = false;
    let graph: { ctx: AudioContext; input: AudioNode };
    try {
      graph = await this.ensureGraph();
    } catch (error) {
      for (const track of line.getTracks()) track.stop();
      throw error;
    }
    if (abandoned()) {
      // The graph finished after close() ran. Close it too, unless a newer open is using it.
      if (this.openingFor === generation) this.close();
      return;
    }
    this.stream = line;
    noteMicTrack(line.getAudioTracks()[0] ?? null);
    this.source = graph.ctx.createMediaStreamSource(line);
    this.source.connect(graph.input);
  }

  /** The button went down: start keeping audio. */
  start(): void {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = true;
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    this.chunks = [];
    this.peak = 0;
    this.startedAt = performance.now();
    this.skipUntil = this.startedAt + PRESS_THUMP_MS;
    this.recording = true;
  }

  /** The button came up: return what was said while it was held. */
  stop(): HoldClip {
    const durationMs = this.recording ? performance.now() - this.startedAt : 0;
    this.recording = false;
    if (this.stream && !this.keepTrackLive)
      for (const track of this.stream.getAudioTracks()) track.enabled = false;
    this.onLevel(0);
    const rate = this.ctx?.sampleRate ?? 0;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    if (!total || !rate) return { blob: null, durationMs, peak: this.peak };
    const samples = downsample(joined, rate, TARGET_RATE);
    return { blob: wav(samples, TARGET_RATE), durationMs, peak: this.peak };
  }

  /** The hold ended while the microphone was opening. The line stays open for the call. */
  release(): void {}

  close(): void {
    this.generation += 1;
    this.recording = false;
    this.releaseMic();
    this.teardown?.();
    this.teardown = null;
    this.input = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.chunks = [];
  }

  private releaseMic(): void {
    if (this.stream) noteMicTrack(null);
    this.source?.disconnect();
    this.source = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  /** The capture graph, built once and kept across holds. */
  private async ensureGraph(): Promise<{ ctx: AudioContext; input: AudioNode }> {
    if (this.ctx && this.input) {
      if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
      return { ctx: this.ctx, input: this.input };
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("Web Audio unavailable");
    const ctx = new Ctor();
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    const silent = ctx.createGain();
    silent.gain.value = 0;
    silent.connect(ctx.destination);

    const onChunk = (chunk: Float32Array) => {
      if (!this.recording || performance.now() < this.skipUntil) return;
      this.chunks.push(chunk);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i]!;
        sum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      if (peak > this.peak) this.peak = peak;
      this.onLevel(Math.min(1, Math.sqrt(sum / chunk.length) * 7));
    };

    let input: AudioNode;
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, "hold-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data);
      node.connect(silent);
      input = node;
      this.teardown = () => {
        node.port.onmessage = null;
        node.disconnect();
      };
    } else {
      // Older browsers without AudioWorklet.
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (event) => onChunk(event.inputBuffer.getChannelData(0).slice(0));
      node.connect(silent);
      input = node;
      this.teardown = () => {
        node.onaudioprocess = null;
        node.disconnect();
      };
    }
    this.ctx = ctx;
    this.input = input;
    return { ctx, input };
  }
}
