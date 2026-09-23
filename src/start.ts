import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { checkApiRequest } from "./lib/api-guard";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// The /api routes are file-route handlers, which the CSRF middleware below does
// not cover (its filter only matches server functions).
const apiGuardMiddleware = createMiddleware().server(async ({ next, request }) => {
  const verdict = checkApiRequest(request);
  if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status });
  return next();
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, apiGuardMiddleware, csrfMiddleware],
}));
