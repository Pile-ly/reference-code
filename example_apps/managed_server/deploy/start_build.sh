#!/usr/bin/env bash
# start_build.sh — run this project's source through the simple_server
# build job and wait for the result.
#
# Manual proof tooling only, the way the whole deploy/ folder is: the
# future managed-server platform service starts builds through its own
# AWS API calls. This script needs a monorepo checkout (it reads the
# simple_server_build CloudFormation family's stack exports by name),
# an authenticated `aws` CLI under AWS_PROFILE=AdministratorAccess-...,
# region us-east-1, and R2 write credentials the operator's AWS identity
# can read from SSM — a copy of just this file cannot run on its own.
#
#   Usage: ./start_build.sh <app_uuid> <storage_key> <bundle_nanoid> <version>
#
# `bundle_nanoid` is not derivable from the other arguments: the R2
# source key is <bundle_nanoid>/server_source/<version>.zip, and it comes
# back from POST /~/apps/register, not from anything build-shaped. Reads
# managed_server.zip from the project root (run zip_source.sh first).
#
# Never prints SOURCE_GET_URL, ARTIFACT_PUT_URL or MANIFEST_PUT_URL —
# the three presigned URLs — to the terminal or a log, same rule the
# buildspec itself follows.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -ne 4 ]; then
    echo "Usage: $0 <app_uuid> <storage_key> <bundle_nanoid> <version>" >&2
    exit 1
fi
APP_UUID="$1"
STORAGE_KEY="$2"
BUNDLE_NANOID="$3"
BUILD_VERSION_NUMBER="$4"

ZIP_PATH="$PROJECT_DIR/managed_server.zip"
if [ ! -f "$ZIP_PATH" ]; then
    echo "error: $ZIP_PATH not found — run zip_source.sh first" >&2
    exit 1
fi

PROJECT_NAME="lmcd-prod-simple-server-build"
STACK_NAME="LmcdProdPilelySimpleServerBuildStack"
BUCKETS_STACK_NAME="LmcdProdPilelySimpleServerBuildBucketsStack"

# Per-build cap: the project's own default (README "Project defaults") is
# 15, with a floor of 5 the service enforces. Override with
# TIMEOUT_MINUTES if a slower/faster build is expected.
TIMEOUT_MINUTES="${TIMEOUT_MINUTES:-15}"
case "$TIMEOUT_MINUTES" in
    ''|*[!0-9]*)
        echo "error: TIMEOUT_MINUTES must be a positive integer, got '${TIMEOUT_MINUTES}'" >&2
        exit 1
        ;;
esac
if [ "$TIMEOUT_MINUTES" -lt 5 ]; then
    TIMEOUT_MINUTES=5
fi
MARGIN_MINUTES=10

echo "==> AWS identity:"
aws sts get-caller-identity --query Arn --output text

# Read live, not hard-coded: the project's own queued-timeout setting, so
# a later change to it on the stack is picked up here instead of silently
# shrinking this margin.
QUEUED_TIMEOUT_MINUTES="$(aws codebuild batch-get-projects --names "$PROJECT_NAME" \
    --query 'projects[0].queuedTimeoutInMinutes' --output text)"
if [ -z "$QUEUED_TIMEOUT_MINUTES" ] || [ "$QUEUED_TIMEOUT_MINUTES" = "None" ]; then
    echo "error: could not read queuedTimeoutInMinutes for project ${PROJECT_NAME}" >&2
    exit 1
fi
echo "QUEUED_TIMEOUT_MINUTES (live): ${QUEUED_TIMEOUT_MINUTES}"
EXPIRES_IN_SECONDS=$(( (TIMEOUT_MINUTES + QUEUED_TIMEOUT_MINUTES + MARGIN_MINUTES) * 60 ))

################################################################################
# Stack exports this project needs — never hard-coded (README: "the
# service reads the cache-prefix tag from the export and never from a
# separately set value").

export_value() { # <stack name> <export-key substring in output name>
    aws cloudformation describe-stacks --stack-name "$1" \
        --query "Stacks[0].Outputs[?contains(OutputKey, '$2')].OutputValue | [0]" \
        --output text
}

ARTIFACTS_BUCKET="$(export_value "$BUCKETS_STACK_NAME" "ArtifactsBucketName")"
CACHE_BUCKET="$(export_value "$BUCKETS_STACK_NAME" "CacheBucketName")"
BUILDER_IMAGE_TAG="$(export_value "$STACK_NAME" "BuilderImageTag")"
echo "ARTIFACTS_BUCKET: ${ARTIFACTS_BUCKET}"
echo "CACHE_BUCKET: ${CACHE_BUCKET}"
echo "BUILDER_IMAGE_TAG: ${BUILDER_IMAGE_TAG}"
for v in ARTIFACTS_BUCKET CACHE_BUCKET BUILDER_IMAGE_TAG; do
    if [ -z "${!v}" ] || [ "${!v}" = "None" ]; then
        echo "error: could not resolve $v from stack exports" >&2
        exit 1
    fi
done

################################################################################
# R2 credentials from SSM (runtime-only, never on disk, never exported
# globally — every R2 call below scopes them to its own subshell so the
# AdministratorAccess identity above is never overwritten).

SSM_DEPLOY_PREFIX="/pilely/internal/deploy"
echo "==> Fetching R2 deploy credentials from SSM..."
R2_PARAMS_JSON="$(aws ssm get-parameters \
    --names \
        "$SSM_DEPLOY_PREFIX/r2_account_id" \
        "$SSM_DEPLOY_PREFIX/r2_access_key_id" \
        "$SSM_DEPLOY_PREFIX/r2_secret_access_key" \
        "$SSM_DEPLOY_PREFIX/r2_bucket" \
    --with-decryption --output json)"

r2_param() { # <full parameter name>
    R2_PARAMS_JSON="$R2_PARAMS_JSON" python3 -c '
import json, os, sys
doc = json.loads(os.environ["R2_PARAMS_JSON"])
name = sys.argv[1]
for p in doc.get("Parameters", []):
    if p["Name"] == name:
        sys.stdout.write(p["Value"])
        sys.exit(0)
sys.stderr.write(f"missing SSM parameter {name}\n")
sys.exit(1)
' "$1"
}
R2_ACCOUNT_ID="$(r2_param "$SSM_DEPLOY_PREFIX/r2_account_id")"
R2_ACCESS_KEY_ID="$(r2_param "$SSM_DEPLOY_PREFIX/r2_access_key_id")"
R2_SECRET_ACCESS_KEY="$(r2_param "$SSM_DEPLOY_PREFIX/r2_secret_access_key")"
R2_BUCKET="$(r2_param "$SSM_DEPLOY_PREFIX/r2_bucket")"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
R2_KEY="${BUNDLE_NANOID}/server_source/${BUILD_VERSION_NUMBER}.zip"

echo "==> Uploading source zip to R2: ${R2_KEY}"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_SESSION_TOKEN='' \
AWS_DEFAULT_REGION="auto" \
    aws s3 cp "$ZIP_PATH" "s3://${R2_BUCKET}/${R2_KEY}" --endpoint-url "$R2_ENDPOINT" --only-show-errors

echo "==> Presigning R2 source GET (expires in ${EXPIRES_IN_SECONDS}s)"
SOURCE_GET_URL="$(
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_SESSION_TOKEN='' \
    AWS_DEFAULT_REGION="auto" \
        aws s3 presign "s3://${R2_BUCKET}/${R2_KEY}" \
            --endpoint-url "$R2_ENDPOINT" --expires-in "$EXPIRES_IN_SECONDS"
)"

################################################################################
# Presigned PUTs on the real artifacts bucket. `aws s3 presign` only ever
# signs GET, so this is a small, dependency-free SigV4 query-string signer
# (stdlib only — no boto3) against whatever credentials the AWS CLI's own
# resolution chain hands back for AWS_PROFILE, session token included.

presign_put() { # <bucket> <key>
    eval "$(aws configure export-credentials --profile "${AWS_PROFILE:-default}" --format env)"
    AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    AWS_SESSION_TOKEN="${AWS_SESSION_TOKEN:-}" \
    AWS_REGION="us-east-1" \
    PRESIGN_BUCKET="$1" \
    PRESIGN_KEY="$2" \
    PRESIGN_EXPIRES="$EXPIRES_IN_SECONDS" \
        python3 <<'PYEOF'
import datetime, hashlib, hmac, os, urllib.parse

access_key = os.environ["AWS_ACCESS_KEY_ID"]
secret_key = os.environ["AWS_SECRET_ACCESS_KEY"]
session_token = os.environ.get("AWS_SESSION_TOKEN", "")
region = os.environ["AWS_REGION"]
bucket = os.environ["PRESIGN_BUCKET"]
key = os.environ["PRESIGN_KEY"]
expires = os.environ["PRESIGN_EXPIRES"]

# safe="" forces every reserved character (including "/" inside the
# Credential value) to be percent-encoded, leaving only the unreserved
# set (letters, digits, "-", "_", ".", "~") — exactly SigV4's rule for a
# canonical query string, and stricter than quote()'s own "/"-is-safe
# default.
def sigv4_quote(value):
    return urllib.parse.quote(str(value), safe="")

host = f"{bucket}.s3.{region}.amazonaws.com"
canonical_uri = "/" + urllib.parse.quote(key, safe="/")
now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime("%Y%m%dT%H%M%SZ")
datestamp = now.strftime("%Y%m%d")
credential_scope = f"{datestamp}/{region}/s3/aws4_request"

query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": f"{access_key}/{credential_scope}",
    "X-Amz-Date": amz_date,
    "X-Amz-Expires": expires,
    "X-Amz-SignedHeaders": "host",
}
if session_token:
    query["X-Amz-Security-Token"] = session_token
canonical_querystring = "&".join(
    f"{sigv4_quote(k)}={sigv4_quote(v)}" for k, v in sorted(query.items())
)

canonical_headers = f"host:{host}\n"
signed_headers = "host"
payload_hash = "UNSIGNED-PAYLOAD"
canonical_request = "\n".join(
    ["PUT", canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash]
)
string_to_sign = "\n".join(
    [
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ]
)

def hmac_sha256(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()

k_date = hmac_sha256(("AWS4" + secret_key).encode(), datestamp)
k_region = hmac_sha256(k_date, region)
k_service = hmac_sha256(k_region, "s3")
k_signing = hmac_sha256(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

print(f"https://{host}{canonical_uri}?{canonical_querystring}&X-Amz-Signature={signature}")
PYEOF
}

echo "==> Presigning the two artifact PUTs (expires in ${EXPIRES_IN_SECONDS}s)"
ARTIFACT_PUT_URL="$(presign_put "$ARTIFACTS_BUCKET" "${STORAGE_KEY}/${BUILD_VERSION_NUMBER}/app")"
MANIFEST_PUT_URL="$(presign_put "$ARTIFACTS_BUCKET" "${STORAGE_KEY}/${BUILD_VERSION_NUMBER}/manifest.json")"

################################################################################
# StartBuild, per the override contract.

CACHE_LOCATION="${CACHE_BUCKET}/${STORAGE_KEY}/${BUILDER_IMAGE_TAG}"
echo "==> Starting build against ${PROJECT_NAME} (cache: ${CACHE_LOCATION}, timeout: ${TIMEOUT_MINUTES}m)"

ENV_OVERRIDE_JSON="$(python3 -c '
import json, sys
app_uuid, storage_key, build_version_number, source_get_url, artifact_put_url, manifest_put_url = sys.argv[1:7]
print(json.dumps([
    {"name": "APP_UUID", "value": app_uuid, "type": "PLAINTEXT"},
    {"name": "STORAGE_KEY", "value": storage_key, "type": "PLAINTEXT"},
    {"name": "BUILD_VERSION_NUMBER", "value": build_version_number, "type": "PLAINTEXT"},
    {"name": "SOURCE_GET_URL", "value": source_get_url, "type": "PLAINTEXT"},
    {"name": "ARTIFACT_PUT_URL", "value": artifact_put_url, "type": "PLAINTEXT"},
    {"name": "MANIFEST_PUT_URL", "value": manifest_put_url, "type": "PLAINTEXT"},
]))
' "$APP_UUID" "$STORAGE_KEY" "$BUILD_VERSION_NUMBER" "$SOURCE_GET_URL" "$ARTIFACT_PUT_URL" "$MANIFEST_PUT_URL")"

START_OUTPUT="$(aws codebuild start-build \
    --project-name "$PROJECT_NAME" \
    --environment-variables-override "$ENV_OVERRIDE_JSON" \
    --cache-override "type=S3,location=${CACHE_LOCATION}" \
    --timeout-in-minutes-override "$TIMEOUT_MINUTES")"
unset ENV_OVERRIDE_JSON SOURCE_GET_URL ARTIFACT_PUT_URL MANIFEST_PUT_URL

BUILD_ID="$(echo "$START_OUTPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['build']['id'])")"
echo "BUILD_ID: ${BUILD_ID}"

################################################################################
# Poll to completion.

echo "==> Polling build status..."
while true; do
    BUILD_JSON="$(aws codebuild batch-get-builds --ids "$BUILD_ID")"
    BUILD_COMPLETE="$(echo "$BUILD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['builds'][0]['buildComplete'])")"
    BUILD_STATUS="$(echo "$BUILD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['builds'][0]['buildStatus'])")"
    echo "  buildComplete=${BUILD_COMPLETE} buildStatus=${BUILD_STATUS}"
    if [ "$BUILD_COMPLETE" = "True" ]; then
        break
    fi
    sleep 5
done

# Classification, per the build family's README: an in-build timeout is
# reported as buildStatus FAILED with the BUILD phase's own phaseStatus
# TIMED_OUT and context BUILD_TIMED_OUT — CodeBuild reserves the literal
# TIMED_OUT enum for exceeding queuedTimeoutInMinutes while still QUEUED.
CLASSIFICATION="$(echo "$BUILD_JSON" | python3 -c '
import json, sys
build = json.load(sys.stdin)["builds"][0]
status = build["buildStatus"]
if status == "SUCCEEDED":
    print("succeeded")
    sys.exit(0)
for phase in build.get("phases", []):
    if phase.get("phaseType") == "BUILD" and phase.get("phaseStatus") == "TIMED_OUT":
        print("build_timed_out")
        sys.exit(0)
print(status.lower())
')"
echo "STATUS: ${BUILD_STATUS}"
echo "CLASSIFICATION: ${CLASSIFICATION}"

if [ "$BUILD_STATUS" = "SUCCEEDED" ]; then
    echo "==> Downloading manifest.json for sha256..."
    # `aws s3api get-object ... /dev/stdout` writes the object body AND the
    # CLI's own response-metadata JSON (AcceptRanges/ContentLength/etc) to
    # the same stream — `aws s3 cp ... -` streams only the body.
    MANIFEST_JSON="$(aws s3 cp "s3://${ARTIFACTS_BUCKET}/${STORAGE_KEY}/${BUILD_VERSION_NUMBER}/manifest.json" -)"
    SHA256="$(echo "$MANIFEST_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['sha256'])")"
    echo "SHA256: ${SHA256}"
    echo "Artifact: s3://${ARTIFACTS_BUCKET}/${STORAGE_KEY}/${BUILD_VERSION_NUMBER}/app"
else
    echo "Build did not succeed; see the log stream for build ${BUILD_ID}." >&2
    exit 1
fi
