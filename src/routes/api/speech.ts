import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let text = "";
        try {
          const body = (await request.json()) as { text?: unknown };
          text = typeof body.text === "string" ? body.text.trim() : "";
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        if (!text) return new Response("Missing text", { status: 400 });
        if (text.length > 1200) text = text.slice(0, 1200);

        /**
         * Delivery direction derived from measurements of the real Mary's voice:
         * median pitch ~220 Hz, expressive but controlled (~3.2 semitone spread),
         * unhurried articulation (~4.1 syllables/s) and ~1.0 s pauses between thoughts.
         * Timbre is shaped further at playback time in src/lib/audio-engine.ts.
         */
        const DELIVERY =
          "Speak as Mary: a warm, grounded woman with a bright, natural everyday voice. " +
          "Friendly phone-call manner — unhurried and relaxed, never rushed, never announcer-like. " +
          "Gentle emphasis on the words that matter, light expressive lift mid-sentence, " +
          "a soft falling tone at the end, and a short natural breath between thoughts. " +
          "Read only the line below, exactly as written:";

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-tts-preview",
            stream_format: "sse",
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `${DELIVERY}\n\n${text}`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              },
            },
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          console.error(`TTS failed [${upstream.status}]: ${detail}`);
          return new Response(detail || "Speech unavailable", {
            status: upstream.status,
          });
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
