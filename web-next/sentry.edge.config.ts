import * as Sentry from "@sentry/nextjs";

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");

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
