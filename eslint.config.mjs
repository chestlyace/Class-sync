import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local-only folders (gitignored, so CI never sees them): agent worktrees and scratch files.
    // Each worktree is a full checkout with its own .next build, which local lint would scan.
    ".worktrees/**",
    ".claude/**",
    ".superpowers/**",
  ]),
  // UI code never talks to the database directly: go through services / auth helpers.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/db", "@/server/db/*", "**/server/db", "**/server/db/*"],
              message:
                "UI code must not import the database layer; use a service or auth helper from src/server instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
