/**
 * The only module that imports the Retell SDK's code (livekit comes with it). It is
 * reached only through a dynamic import, so the SDK lands in its own lazy chunk that
 * only Retell visitors download.
 */
import { RetellClient } from "retell-client-js-sdk";

import { RetellCall, type RetellCallDeps } from "./retell-call";

export function createRetellCall(
  deps: Omit<RetellCallDeps, "createClient" | "transcript">,
  opts: { transcriptKey: string | null },
): RetellCall {
  return new RetellCall({
    ...deps,
    transcript: Boolean(opts.transcriptKey),
    // No baseURL: it is also where WebRTC signalling goes. Control calls go through the
    // proxy fetch; the key only opens the live-caption socket, when there is one.
    createClient: (proxyFetch) =>
      new RetellClient({ key: opts.transcriptKey ?? "", fetch: proxyFetch }),
  });
}
