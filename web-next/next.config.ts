import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const releaseName = process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined;

const nextConfig: NextConfig = {
  // Keep server-side outbound fetches out of the Next.js fetch cache so Sentry
  // can instrument the real HTTP request at the Next.js → backend boundary.
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.SENTRY_RELEASE || "",
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || "sentry-poc-next",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: {
    name: releaseName,
    create: true,
    finalize: true,
  },

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
