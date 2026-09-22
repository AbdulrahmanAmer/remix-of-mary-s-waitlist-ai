import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SignupSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(3),
  phone: z.string().default(""),
  business: z.string().default(""),
  industry: z.string().default(""),
  operations: z.string().default(""),
  transcript: z.string().default(""),
});

export type SubmitResult = {
  saved: boolean;
  position: number;
  message: string;
};

function positionFor(email: string) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) % 100000;
  }
  return 128 + (hash % 640);
}

export const submitWaitlist = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SignupSchema.parse(input))
  .handler(async ({ data }): Promise<SubmitResult> => {
    const endpoint = process.env["SHEETS_WEBAPP_URL"];
    const secret = process.env["SHEETS_WEBAPP_SECRET"] ?? "";
    const position = positionFor(data.email.toLowerCase());

    const row = {
      secret,
      timestamp: new Date().toISOString(),
      name: data.name,
      email: data.email,
      phone: data.phone,
      business: data.business,
      industry: data.industry,
      operations: data.operations,
      transcript: data.transcript,
    };

    if (!endpoint) {
      console.warn("[waitlist] SHEETS_WEBAPP_URL not set — signup logged only", {
        ...row,
        secret: undefined,
      });
      return {
        saved: false,
        position,
        message: "Signup captured. Connect the Google Sheet endpoint to store it.",
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
        redirect: "follow",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(`[waitlist] sheet write failed [${response.status}]: ${detail}`);
        return {
          saved: false,
          position,
          message: `Could not reach the waitlist sheet (${response.status}).`,
        };
      }
      return { saved: true, position, message: "Saved to the waitlist sheet." };
    } catch (error) {
      console.error("[waitlist] sheet write threw", error);
      return {
        saved: false,
        position,
        message: "Could not reach the waitlist sheet.",
      };
    }
  });
