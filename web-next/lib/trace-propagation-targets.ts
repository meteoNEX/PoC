/**
 * Shared Sentry tracePropagationTargets for this PoC.
 *
 * String entries are substring matches against the request URL (Sentry JS SDK).
 * Cover both native local hosts and Docker Compose service DNS names.
 */
export const TRACE_PROPAGATION_TARGETS: Array<string | RegExp> = [
  "localhost",
  "127.0.0.1",
  "python-direct",
  "python-downstream",
  "spring",
  /^\//,
];
