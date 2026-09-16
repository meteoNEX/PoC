import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Keep server-side outbound fetches out of the Next.js fetch cache so Sentry
  // can instrument the real HTTP request at the Next.js → backend boundary.
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || "sentry-poc-next",
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Source maps are uploaded only when SENTRY_AUTH_TOKEN is present.
  // Missing token must not fail a local production build.
  silent: !process.env.SENTRY_DEBUG,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  tunnelRoute: "/sentry-tunnel",
});
