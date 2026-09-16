import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { execSync } from "node:child_process";

function releaseFromGit(): string | undefined {
  const fromEnv = process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE;
  if (
    fromEnv &&
    fromEnv.trim() &&
    fromEnv !== "sentry-poc@1.0.0" &&
    !/^sentry-poc@?$/.test(fromEnv.trim())
  ) {
    return fromEnv.trim();
  }
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8", cwd: process.cwd() }).trim();
    return sha ? `sentry-poc@${sha}` : undefined;
  } catch {
    try {
      const sha = execSync("git -C /workspace rev-parse HEAD", { encoding: "utf8" }).trim();
      return sha ? `sentry-poc@${sha}` : undefined;
    } catch {
      return undefined;
    }
  }
}

const releaseName = releaseFromGit();

const nextConfig: NextConfig = {
  // Keep server-side outbound fetches out of the Next.js fetch cache so Sentry
  // can instrument the real HTTP request at the Next.js → backend boundary.
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: releaseName || "",
    SENTRY_RELEASE: releaseName || "",
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || "sentry-poc-next-2",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: {
    name: releaseName,
    create: true,
    finalize: true,
  },

  // Source maps are uploaded only when SENTRY_AUTH_TOKEN is present.
  // Missing token must not fail a local production build. Present token
  // must not hide auth/upload failures.
  silent: !process.env.SENTRY_AUTH_TOKEN && !process.env.SENTRY_DEBUG,
  errorHandler: (err) => {
    if (process.env.SENTRY_AUTH_TOKEN) {
      throw err;
    }
    console.warn(err);
  },
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  // Do not enable tunnelRoute in this PoC. Next.js was returning HTTP 403 for
  // /sentry-tunnel POSTs, which would silently drop browser envelopes.
  // Browser SDK talks to ingest.us.sentry.io directly.
});
