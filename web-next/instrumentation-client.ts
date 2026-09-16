import * as Sentry from "@sentry/nextjs";
import { TRACE_PROPAGATION_TARGETS } from "./lib/trace-propagation-targets";
import { pocEnvironment, pocRelease } from "./lib/release";

const tracesSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1",
);

/**
 * Browser SDK.
 *
 * Session Replay is intentionally not enabled.
 * Profiling is intentionally not enabled.
 *
 * tracesSampleRate=1.0 is a PoC setting (code fallback AND env). Production must
 * use a lower rate or tracesSampler.
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
  integrations: [Sentry.browserTracingIntegration()],
  initialScope: {
    tags: {
      service: "sentry-poc-next",
    },
  },
});

Sentry.setAttribute("service", "sentry-poc-next");
Sentry.setAttribute("environment", pocEnvironment());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
