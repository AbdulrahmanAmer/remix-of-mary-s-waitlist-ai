import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { MaryApp } from "@/features/mary/mary-app";
import { BootScreen } from "@/features/mary/ui/boot-screen";

// Shared links and QR codes need an absolute address for the preview card.
// This is the live custom domain (omnikom.ai does not resolve).
const SITE_URL = "https://omnisuite.omnikom.io";

const title = "Join the OmniSuite Waitlist — Talk to MARY by Omnikom";
const description =
  "MARY, the AI Revenue Concierge behind OmniSuite, a product by Omnikom, will sign you up for early access by voice or text.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OmniSuite" },
      { property: "og:image", content: `${SITE_URL}/og-omnisuite.jpg` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:url", content: SITE_URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: `${SITE_URL}/og-omnisuite.jpg` },
    ],
    links: [{ rel: "canonical", href: SITE_URL }],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<BootScreen />}>
      <MaryApp />
    </ClientOnly>
  );
}
