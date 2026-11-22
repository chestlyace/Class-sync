import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Pages where a click grants or reveals access: never rendered inside another site's frame.
const NO_FRAMING = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

// Production answers on one host only: BETTER_AUTH_URL's. Every other host (www, the *.vercel.app
// aliases, the *.herokuapp.com name) gets a permanent redirect there, so sessions, OAuth issuer and email
// links all agree. Cron calls and queue deliveries are left alone: neither Vercel Cron nor Vercel Queues
// follows redirects. While BETTER_AUTH_URL is still a platform host (before the domain moves), nothing
// redirects.
const IS_PRODUCTION = process.env.APP_ENV?.trim() === "production" || process.env.VERCEL_ENV === "production";
const CANONICAL_HOST =
  IS_PRODUCTION && process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).host : null;
const PLATFORM_HOSTS = [".vercel.app", ".herokuapp.com"];

const nextConfig: NextConfig = {
  // APP_ENV (Heroku) for the browser bundle, which only sees NEXT_PUBLIC_ variables (Sentry's environment tag).
  env: { NEXT_PUBLIC_APP_ENV: process.env.APP_ENV?.trim() ?? "" },
  // Loaded from node_modules at run time, like `pg`, rather than bundled (Heroku's background jobs).
  serverExternalPackages: ["pg-boss"],
  async redirects() {
    if (!CANONICAL_HOST || PLATFORM_HOSTS.some((h) => CANONICAL_HOST.endsWith(h))) return [];
    return [
      {
        source: "/:path((?!api/(?:cron|queues)/).*)",
        missing: [{ type: "host", value: CANONICAL_HOST }],
        destination: `https://${CANONICAL_HOST}/:path`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      ...["/oauth/:path*", "/sign-in", "/sign-up"].map((source) => ({ source, headers: NO_FRAMING })),
      // The service worker: always checked for a new version, never served from a cache.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  // cacheComponents / partialPrefetching are deliberately off: every page is per-user
  // and reads the session cookie.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set.
// Browser events go through /monitoring on our own host, so ad blockers don't drop them.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  telemetry: false,
});
