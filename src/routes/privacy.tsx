import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Logo, SiteFooter, SiteHeader } from "@/features/mary/ui/site-frame";

/*
 * DRAFT for the operator to review before launch. Every sentence below describes
 * what the code does today (lead-sync.ts, lead-lifecycle.ts, the /api routes and
 * docs/google-sheets). Three things only the operator can settle:
 *   1. CONTACT: where a person writes to see, correct or delete their details.
 *   2. Retention: how long rows stay in the sheet (the code never deletes).
 *   3. Retell: update "Where it goes" when the voice moves there, and choose its
 *      data_storage_setting / retention deliberately.
 */
const CONTACT = "the Omnikom team, through the details on omnikom's site";
const UPDATED = "September 2026";

const title = "Privacy — Talking to MARY";
const description =
  "What MARY collects when you talk to her, where it goes, how long it stays and how to have it removed.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Privacy,
});

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink sm:text-2xl">
        {heading}
      </h2>
      <div className="mt-3 space-y-3 text-[0.98rem] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <main className="screen-gutter mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <SiteHeader
        start={<Logo className="h-6 sm:h-7" />}
        end={
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to MARY
          </Link>
        }
      />
      <article className="flex-1 py-8 sm:py-12">
        <p className="eyebrow">Privacy</p>
        <h1 className="mt-3 text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-5xl">
          What happens to what you tell MARY
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          MARY is an AI assistant run by Omnikom. She takes sign-ups for the OmniSuite launch
          waitlist by voice or text. This page says, in plain words, what she keeps and who handles
          it. Last updated {UPDATED}.
        </p>

        <Section heading="What we collect">
          <p>
            <strong className="font-medium text-ink">What you tell her.</strong> Your name, your
            email, a phone number if you choose to give one, your business, your industry and a few
            words on how you work today.
          </p>
          <p>
            <strong className="font-medium text-ink">The conversation.</strong> A written transcript
            of what you and MARY said. When you talk, your voice is turned into text as you go; we
            do not keep the audio. If you leave before the end, the part of the transcript so far is
            saved as an unfinished conversation.
          </p>
          <p>
            <strong className="font-medium text-ink">About your visit.</strong> The page address,
            the site you came from, your browser and device type, your language and time zone, and
            when the conversation happened. No advertising cookies, no tracking across other sites.
          </p>
          <p>
            Your browser also keeps a local copy of your answers, so MARY doesn't ask twice if you
            come back. Clearing this site's data in your browser removes it.
          </p>
        </Section>

        <Section heading="Where it goes">
          <p>
            <strong className="font-medium text-ink">A Google Sheet owned by Omnikom.</strong> Your
            details and the transcript are written to a spreadsheet the Omnikom team uses to send
            invitations and follow up. Google stores that sheet for us.
          </p>
          <p>
            <strong className="font-medium text-ink">AI providers.</strong> To understand you and
            reply, your words are sent to AI models: one turns speech into text, one writes MARY's
            replies, one reads them aloud. These requests go through the AI gateway of Lovable, the
            platform this site runs on, to model providers including Google and OpenAI. They process
            the text to answer and are not given your name or email as a separate record.
          </p>
          <p>
            <strong className="font-medium text-ink">Learning notes.</strong> After a conversation,
            MARY writes herself short notes on what worked, without your name or contact details, so
            she explains things better next time.
          </p>
          <p>
            <strong className="font-medium text-ink">Coming next: Retell.</strong> We plan to move
            MARY's voice to Retell AI, a voice-call service. When that happens, Retell will carry
            the call audio and its transcript, and this page will be updated before it goes live.
          </p>
        </Section>

        <Section heading="How long we keep it">
          <p>
            We keep your details for as long as the OmniSuite waitlist runs, so the team can send
            your invitation. Ask us and we delete them.
          </p>
        </Section>

        <Section heading="Your choices">
          <p>
            You can type instead of talking: MARY works without the microphone, and you can turn her
            voice off at any time. Nothing is recorded until you press Start.
          </p>
          <p>
            To see, correct or delete what we hold about you, contact {CONTACT}. Tell us the email
            you gave MARY so we can find your entry.
          </p>
        </Section>
      </article>
      <SiteFooter />
    </main>
  );
}
