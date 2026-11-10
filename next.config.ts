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
// aliases) gets a permanent redirect there, so sessions, OAuth issuer and email links all agree.
// Cron calls are left alone: Vercel Cron does not follow redirects.
const CANONICAL_HOST =
  process.env.VERCEL_ENV === "production" && process.env.BETTER_AUTH_URL
    ? new URL(process.env.BETTER_AUTH_URL).host
    : null;

const nextConfig: NextConfig = {
  async redirects() {
    if (!CANONICAL_HOST || CANONICAL_HOST.endsWith(".vercel.app")) return [];
    return [
      {
        source: "/:path((?!api/cron/).*)",
        missing: [{ type: "host", value: CANONICAL_HOST }],
        destination: `https://${CANONICAL_HOST}/:path`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return ["/oauth/:path*", "/sign-in", "/sign-up"].map((source) => ({ source, headers: NO_FRAMING }));
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
