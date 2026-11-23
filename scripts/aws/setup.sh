#!/usr/bin/env bash
# One-time AWS set-up for Clasync on Heroku. Run it in AWS CloudShell (console, top bar, the >_ icon),
# signed in to account 3982-8037-9768 (the one with the Activate credit), region eu-west-3 (Paris):
#
#   bash setup.sh
#
# It creates, and leaves alone if they already exist:
#   - a private S3 bucket for uploaded files, with browser uploads allowed from the site (CORS);
#   - an IAM user "clasync-heroku" that may read/write that bucket and call Claude on Bedrock (the same
#     Bedrock permissions as the Vercel role "clasync-bedrock");
#   - one access key for that user, printed once at the end: put it in Heroku, never in git.
set -euo pipefail

REGION=eu-west-3
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="clasync-files-${ACCOUNT}"
USER_NAME=clasync-heroku
ORIGINS='["https://clasync.online","https://www.clasync.online","https://staging.clasync.online","https://clasync-b15cf4ab7af7.herokuapp.com","https://clasync-staging-c43087195bf3.herokuapp.com"]'

echo "Account ${ACCOUNT}, bucket ${BUCKET}"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  echo "Bucket created"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": ${ORIGINS},
    \"AllowedMethods\": [\"PUT\"],
    \"AllowedHeaders\": [\"content-type\", \"if-none-match\"],
    \"ExposeHeaders\": [\"ETag\"],
    \"MaxAgeSeconds\": 3600
  }]
}"
echo "Bucket private, CORS set"

if ! aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  aws iam create-user --user-name "$USER_NAME" >/dev/null
  echo "User ${USER_NAME} created"
fi

# Bedrock statements: copied from the Vercel role's inline policy when it exists, else Haiku 4.5 in the EU.
ROLE_POLICY=$(aws iam list-role-policies --role-name clasync-bedrock --query 'PolicyNames[0]' --output text 2>/dev/null || true)
if [ -n "$ROLE_POLICY" ] && [ "$ROLE_POLICY" != "None" ]; then
  BEDROCK=$(aws iam get-role-policy --role-name clasync-bedrock --policy-name "$ROLE_POLICY" \
    --query 'PolicyDocument.Statement' --output json)
  echo "Bedrock permissions copied from role clasync-bedrock (${ROLE_POLICY})"
else
  BEDROCK='[{"Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],"Resource":["arn:aws:bedrock:*:'"$ACCOUNT"':inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0","arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"]}]'
  echo "Role clasync-bedrock not found: Bedrock permissions for Haiku 4.5 (EU)"
fi

POLICY=$(python3 - "$BUCKET" "$BEDROCK" <<'PY'
import json, sys
bucket, bedrock = sys.argv[1], json.loads(sys.argv[2])
if isinstance(bedrock, dict):  # a policy with one statement comes back as an object
    bedrock = [bedrock]
objects = {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
           "Resource": f"arn:aws:s3:::{bucket}/*"}
# Without ListBucket, S3 answers 403 instead of 404 for a missing file, and the app can't tell them apart.
listing = {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": f"arn:aws:s3:::{bucket}"}
print(json.dumps({"Version": "2012-10-17", "Statement": [objects, listing] + bedrock}))
PY
)
aws iam put-user-policy --user-name "$USER_NAME" --policy-name clasync-app --policy-document "$POLICY"
echo "Policy clasync-app set on ${USER_NAME}"

KEYS=$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text)
if [ "$KEYS" = "0" ]; then
  echo
  echo "Access key (shown once; put it in Heroku, then clear this screen):"
  aws iam create-access-key --user-name "$USER_NAME" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text |
    awk '{print "  AWS_ACCESS_KEY_ID=" $1 "\n  AWS_SECRET_ACCESS_KEY=" $2}'
else
  echo "${USER_NAME} already has an access key: none created (delete it in IAM first to make a new one)."
fi
echo
echo "Heroku settings: S3_BUCKET=${BUCKET} S3_REGION=${REGION} STORAGE_DRIVER=s3"
