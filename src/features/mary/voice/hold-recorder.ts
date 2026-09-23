/**
 * Hold-to-talk capture. In a loud room no automatic detector can reliably tell the
 * person at the device from the people around them; holding the button makes that
 * explicit. Only audio captured while the button is held is ever sent, so nothing
 * the room says can start a turn.
 *
 * The microphone opens once (with the browser's echo cancellation, noise
 * suppression and auto gain) and its track is disabled between holds, so there is
 * no permission prompt or start-up delay on each press.
 */

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
  private ctx: AudioContext | null = null;
  private teardown: (() => void) | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private startedAt = 0;
  private skipUntil = 0;
  private peak = 0;

  get isOpen(): boolean {
    return this.stream !== null;
  }

  async open(): Promise<void> {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    for (const track of stream.getAudioTracks()) track.enabled = false;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("Web Audio unavailable");
    }
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
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

    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, "hold-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data);
      source.connect(node);
      node.connect(silent);
      this.teardown = () => {
        node.port.onmessage = null;
        node.disconnect();
      };
    } else {
      // Older browsers without AudioWorklet.
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (event) => onChunk(event.inputBuffer.getChannelData(0).slice(0));
      source.connect(node);
      node.connect(silent);
      this.teardown = () => {
        node.onaudioprocess = null;
        node.disconnect();
      };
    }
    this.stream = stream;
    this.ctx = ctx;
  }

  /** The button went down: start keeping audio. */
  start(): void {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = true;
    if (this.ctx?.state === "suspended") void this.ctx.resume();
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
    if (this.stream) for (const track of this.stream.getAudioTracks()) track.enabled = false;
    this.onLevel(0);
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    if (!total || !this.ctx) return { blob: null, durationMs, peak: this.peak };
    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    const samples = downsample(joined, this.ctx.sampleRate, TARGET_RATE);
    return { blob: wav(samples, TARGET_RATE), durationMs, peak: this.peak };
  }

  close(): void {
    this.recording = false;
    this.teardown?.();
    this.teardown = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.chunks = [];
  }
}
