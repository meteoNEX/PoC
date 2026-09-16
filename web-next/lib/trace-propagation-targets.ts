/**
 * Shared Sentry `tracePropagationTargets` for this PoC.
 *
 * Matching follows `@sentry/browser` `shouldAttachHeaders` / `@sentry/core`
 * `stringMatchesSomePattern` (SDK 10.75.0):
 * - string entries are substring matches
 * - regex entries use `RegExp.test`
 * - the browser SDK matches against the **full URL** and, for same-origin
 *   requests, also against the **pathname**
 *
 * `/^\//` is required so same-origin relative fetches such as
 * `/api/proxy/spring` and `/api/proxy/python-direct` propagate
 * `sentry-trace` / `baggage` / `traceparent`. Host strings cover native
 * localhost and Docker Compose DNS names for server-side outbound hops.
 *
 * Do not use a catch-all that would attach tracing headers to arbitrary
 * third-party origins.
 */
export const TRACE_PROPAGATION_TARGETS: Array<string | RegExp> = [
  "localhost",
  "127.0.0.1",
  "python-direct",
  "python-downstream",
  "spring",
  /^\//,
];
