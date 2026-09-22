import { useEffect, useState } from "react";

import { audioDiagnostics, micPermissionState, replayLastLine } from "@/lib/audio-engine";

type Row = { label: string; value: string; good?: boolean | undefined };

/**
 * A live read of the audio path, for checking a real phone on the spot:
 * is the engine awake, is her voice actually leaving the device, did the
 * microphone open, and can this browser do live captions.
 */
export function AudioDiagnostics() {
  const [rows, setRows] = useState<Row[]>([]);
  const [permission, setPermission] = useState("unknown");

  useEffect(() => {
    let alive = true;
    const read = () => {
      const d = audioDiagnostics();
      if (!alive) return;
      setRows([
        { label: "Audio engine", value: d.context, good: d.context === "running" },
        { label: "Sample rate", value: `${d.sampleRate || "—"}` },
        { label: "Call route built", value: d.callRoute ? "yes" : "no", good: d.callRoute },
        {
          label: "Output playing",
          value: d.elementPaused ? "paused" : `running (${d.elementTime}s)`,
          good: !d.elementPaused,
        },
        {
          label: "Forced to speakers",
          value: d.directOutput ? "yes" : "no",
        },
        { label: "Speaking now", value: d.speaking ? "yes" : "no" },
        {
          label: "Output last moved",
          value: d.lastOutputMovedMsAgo < 0 ? "never" : `${d.lastOutputMovedMsAgo} ms ago`,
        },
        { label: "Microphone track", value: d.micTrack, good: d.micTrack.startsWith("live") },
        { label: "Microphone device", value: d.micLabel || "—" },
        {
          label: "Line cleaning",
          value: d.micProcessing || "—",
          good: d.micProcessing ? d.micProcessing.startsWith("echo cancel") : undefined,
        },
        {
          label: "Sounds like a voice",
          value: d.voiceScore < 0 ? "—" : `${d.voiceScore}%`,
          good: d.voiceScore < 0 ? undefined : d.voiceScore >= 50,
        },
        {
          label: "Voice above the room",
          value: d.voiceScore < 0 ? "—" : `${d.voiceSnrDb} dB`,
        },
        {
          label: "Room level",
          value: d.voiceScore < 0 ? "—" : `${d.roomFloorDb} dB`,
        },
        {
          label: "Hearing now",
          value:
            d.voiceScore < 0
              ? "—"
              : d.voiceScore >= 50
                ? "a person"
                : d.voiceScore >= 32
                  ? "maybe"
                  : "room only",
          good: d.voiceScore < 0 ? undefined : d.voiceScore >= 32,
        },
        {
          label: "Live captions",
          value: d.speechRecognition ? "supported" : "not supported",
          good: d.speechRecognition,
        },
        { label: "Secure page", value: d.secureContext ? "yes" : "no", good: d.secureContext },
        { label: "In-app browser", value: d.inAppBrowser ? "yes" : "no", good: !d.inAppBrowser },
      ]);
    };
    read();
    const timer = window.setInterval(read, 500);
    void micPermissionState().then((state) => {
      if (alive) setPermission(state);
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Microphone permission:</span>
        <span className="font-medium">{permission}</span>
        <button
          type="button"
          onClick={() => {
            void replayLastLine();
          }}
          className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted"
        >
          Play her last line
        </button>
      </div>
      <dl className="divide-y divide-border rounded-2xl border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-4 py-2 text-sm"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              className={
                row.good === undefined ? "" : row.good ? "text-accent-text" : "text-destructive"
              }
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
