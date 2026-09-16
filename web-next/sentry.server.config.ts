import * as Sentry from "@sentry/nextjs";
import { TRACE_PROPAGATION_TARGETS } from "./lib/trace-propagation-targets";
import { pocEnvironment, pocRelease } from "./lib/release";

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");

/**
 * Next.js Node.js server SDK.
 *
 * Core outbound hops must use native instrumented fetch (see lib/outbound-fetch.ts).
 * Session Replay / Profiling are not enabled.
 *
 * tracesSampleRate defaults to 1.0 in this PoC (code fallback AND .env.example).
 * Production must use a much lower rate or tracesSampler.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: pocEnvironment(),
  release: pocRelease(),
  tracesSampleRate,
  sendDefaultPii: false,
  enableLogs: true,
  enableMetrics: true,
  propagateTraceparent: true,
  tracePropagationTargets: TRACE_PROPAGATION_TARGETS,
  initialScope: {
    tags: {
      service: "sentry-poc-next",
    },
  },
});

Sentry.setAttribute("service", "sentry-poc-next");
Sentry.setAttribute("environment", pocEnvironment());
