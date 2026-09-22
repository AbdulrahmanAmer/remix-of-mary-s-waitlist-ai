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
          "Say the line below the way a real person talks in a live conversation. " +
          "Normal everyday speaking speed — the tempo of someone chatting, not reading. " +
          "Do not slow down, do not draw words out, do not leave long gaps; keep it light and moving. " +
          "Warm and casual, with natural emphasis on the words that matter, a brief beat at commas " +
          "and a soft falling tone at the end. Never announcer-like, never performed, no robotic evenness. " +
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
