import * as Sentry from "@sentry/nextjs";

const tracesSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ??
    process.env.SENTRY_TRACES_SAMPLE_RATE ??
    "1",
);

/**
 * Browser SDK.
 *
 * Session Replay is intentionally not enabled.
 * Profiling is intentionally not enabled.
 *
 * tracesSampleRate=1.0 is a PoC setting so every dashboard click produces a
 * trace. Production must use a lower rate or tracesSampler.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "poc",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "sentry-poc@1.0.0",
  tracesSampleRate,
  sendDefaultPii: false,
  enableLogs: true,
  enableMetrics: true,
  // Official W3C Trace Context header in addition to sentry-trace / baggage.
  propagateTraceparent: true,
  // Port numbers matter. Include localhost so browser → Next.js API calls
  // receive trace headers (same-origin `/api` is also matched by /^\//).
  tracePropagationTargets: ["localhost", /^https?:\/\/127\.0\.0\.1:\d+/, /^\//],
  integrations: [Sentry.browserTracingIntegration()],
  initialScope: {
    tags: {
      service: "sentry-poc-next",
    },
  },
});

Sentry.setAttribute("service", "sentry-poc-next");
Sentry.setAttribute("environment", process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "poc");

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
