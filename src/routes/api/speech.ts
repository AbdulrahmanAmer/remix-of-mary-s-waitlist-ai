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

        const delivery =
          "Read the line below as a real person speaking on a friendly phone call. " +
          "Warm, relaxed and unhurried — a natural conversational pace, slightly slower than average. " +
          "Let sentences breathe: a short breath at commas, a fuller pause at full stops. " +
          "Gentle emphasis on the words that carry meaning, a light lift mid-sentence and a soft " +
          "falling tone at the end. Never announcer-like, never rushed, no robotic evenness. " +
          "Speak only the line itself, exactly as written:\n\n";

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
                    text: `${delivery}${text}`,
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
