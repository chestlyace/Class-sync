import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Pages where a click grants or reveals access: never rendered inside another site's frame.
const NO_FRAMING = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
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

export default withNextIntl(nextConfig);
