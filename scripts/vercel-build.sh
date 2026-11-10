#!/usr/bin/env bash
# Vercel build command (vercel.json). Staging, the preview of branch Development, migrates its own
# database before building, so its schema always matches the code going live. Other previews share
# that database and never migrate; production migrations stay a manual step (README, "Deploying").
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${VERCEL_GIT_COMMIT_REF:-}" = "Development" ]; then
  echo "Migrating the staging database"
  npm run db:migrate
fi

npm run build
