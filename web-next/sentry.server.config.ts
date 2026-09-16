import * as Sentry from "@sentry/nextjs";

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");

/**
 * Next.js Node.js server SDK.
 *
 * This is the historically fragile hop: Browser → Next.js → outbound fetch.
 * See lib/outbound-fetch.ts for the inspectable fetch wrapper.
 *
 * Session Replay / Profiling are not enabled.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "poc",
  release: process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "sentry-poc@1.0.0",
  tracesSampleRate,
  sendDefaultPii: false,
  enableLogs: true,
  enableMetrics: true,
  propagateTraceparent: true,
  tracePropagationTargets: [
    "localhost",
    /^https?:\/\/127\.0\.0\.1:\d+/,
    /^https?:\/\/localhost:\d+/,
    /^\//,
  ],
  initialScope: {
    tags: {
      service: "sentry-poc-next",
    },
  },
});

Sentry.setAttribute("service", "sentry-poc-next");
Sentry.setAttribute("environment", process.env.SENTRY_ENVIRONMENT ?? "poc");
