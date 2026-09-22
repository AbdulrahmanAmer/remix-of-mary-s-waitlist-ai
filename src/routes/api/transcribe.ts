import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 12 * 1024 * 1024;

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) {
          return new Response("Missing audio file", { status: 400 });
        }
        if (file.size < 2048) {
          return Response.json({ text: "" });
        }
        if (file.size > MAX_BYTES) {
          return new Response("Recording too long", { status: 413 });
        }

        const upstream = new FormData();
        upstream.append("model", "google/gemini-3.5-transcribe");
        upstream.append("file", file, "recording.wav");

        const response = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.error(`Transcription failed [${response.status}]: ${detail}`);
          return new Response(detail || "Transcription failed", {
            status: response.status,
          });
        }

        const result = (await response.json()) as { text?: string };
        return Response.json({ text: result.text ?? "" });
      },
    },
  },
});
