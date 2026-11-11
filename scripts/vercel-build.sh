#!/usr/bin/env bash
# Vercel build command (vercel.json). Production and staging (the preview of branch Development)
# migrate their own database before building, so its schema always matches the code going live.
# Other previews share the staging database and never migrate (README, "Deploying").
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Migrating the production database"
  npm run db:migrate
elif [ "${VERCEL_ENV:-}" = "preview" ] && [ "${VERCEL_GIT_COMMIT_REF:-}" = "Development" ]; then
  echo "Migrating the staging database"
  npm run db:migrate
fi

npm run build
