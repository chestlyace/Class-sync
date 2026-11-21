#!/usr/bin/env bash
# Copies Clasync's production settings from Vercel to the Heroku app, without printing any value.
# Run it yourself (it reads your secrets), from the repo folder, signed in to both CLIs:
#
#   bash scripts/heroku/copy-env-from-vercel.sh            # production -> app "clasync"
#
# Vercel hides "Sensitive" variables from `vercel env pull` (they come back empty): the script lists
# those at the end so you can set them by hand with `heroku config:set NAME=value -a clasync`.
# Left out on purpose: the database and Blob settings (Heroku has its own), CRON_SECRET (no Vercel Cron),
# AI_AWS_ROLE_ARN (Vercel-only sign-in; on Heroku it would stop Bedrock from using the access key).
set -euo pipefail

APP="${1:-clasync}"
NAMES=(ADMIN_EMAILS AI_AWS_REGION AI_MONTHLY_CAP AI_MARKING_MODEL AUTH_REQUIRE_EMAIL_VERIFICATION
  BETTER_AUTH_SECRET EMAIL_FROM SUPPORT_EMAIL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT RESEND_API_KEY
  SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT AI_GATEWAY_API_KEY)

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
vercel env pull --environment=production --yes "$TMP" >/dev/null

ARGS=()
EMPTY=()
for name in "${NAMES[@]}"; do
  line=$(grep -E "^${name}=" "$TMP" || true)
  [ -z "$line" ] && continue
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  if [ -z "$value" ]; then EMPTY+=("$name"); else ARGS+=("${name}=${value}"); fi
done

if [ "${#ARGS[@]}" -gt 0 ]; then
  heroku config:set -a "$APP" "${ARGS[@]}" >/dev/null
  printf 'Copied to %s: ' "$APP"; for a in "${ARGS[@]}"; do printf '%s ' "${a%%=*}"; done; echo
fi
if [ "${#EMPTY[@]}" -gt 0 ]; then
  echo "Hidden by Vercel (Sensitive), set these by hand: ${EMPTY[*]}"
fi
