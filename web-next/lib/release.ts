export function pocEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT ?? process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "poc";
}

/**
 * Stable release id. Prefer an explicit env value (usually `sentry-poc@<git SHA>`
 * from scripts/release-id.sh). Do not fall back to a hardcoded 1.0.0 string —
 * if unset, the Sentry SDK / build plugin may auto-detect git HEAD.
 */
export function pocRelease(): string | undefined {
  const value = process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE;
  return value && value.trim().length > 0 ? value : undefined;
}
