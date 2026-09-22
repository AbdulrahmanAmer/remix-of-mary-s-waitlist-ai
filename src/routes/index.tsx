import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { MaryExperience } from "@/components/mary-experience";
import { AuroraBackground } from "@/components/aurora-background";

const title = "Join the OmniSuite Waitlist — Talk to MARY";
const description =
  "MARY, the AI Revenue Concierge behind OmniSuite, will sign you up for early access in a live voice conversation. Speak or type — she takes it from there.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly
      fallback={
        <div className="relative min-h-screen">
          <AuroraBackground />
          <div className="relative z-10 grid min-h-screen place-items-center">
            <p className="text-sm tracking-[0.3em] text-white/40 uppercase">Waking MARY</p>
          </div>
        </div>
      }
    >
      <MaryExperience />
    </ClientOnly>
  );
}
