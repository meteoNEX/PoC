import * as Sentry from "@sentry/nextjs";
import { TRACE_PROPAGATION_TARGETS } from "./lib/trace-propagation-targets";
import { pocEnvironment, pocRelease } from "./lib/release";

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");

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
