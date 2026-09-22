import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { MaryExperience } from "@/components/mary-experience";
import { MaryBoot } from "@/components/mary-boot";

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
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly
      fallback={<MaryBoot />}
    >
      <MaryExperience />
    </ClientOnly>
  );
}
