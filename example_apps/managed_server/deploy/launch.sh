#!/usr/bin/env bash
# launch.sh — render launch.json for a built version of this app and boot
# it on a real simple_server box.
#
# Manual proof tooling only, the way the whole deploy/ folder is: the
# future managed-server platform service launches boxes through its own
# AWS API calls, from state it already tracks. This script does the same
# render-and-launch by hand, and needs the simple_server_box
# CloudFormation family's own launch_box.sh — monorepo-side tooling a
# plain copy of this directory does not have — plus an authenticated
# `aws` CLI under AWS_PROFILE=AdministratorAccess-..., region us-east-1.
#
#   Usage: LAUNCH_BOX_SCRIPT=<path to launch_box.sh> \
#          ./launch.sh <app_uuid> <storage_key> <version> <sha256> <server_id> <subnet_id>
#
# LAUNCH_BOX_SCRIPT is an environment variable rather than a hard-coded
# monorepo path so this file stays self-contained on its own; a public
# copier has no such script and cannot run this one regardless. Prints the
# instance id and private IP launch_box.sh reports.
set -euo pipefail

if [ -z "${LAUNCH_BOX_SCRIPT:-}" ]; then
    echo "error: set LAUNCH_BOX_SCRIPT to the simple_server_box family's launch_box.sh" >&2
    exit 1
fi
if [ ! -f "$LAUNCH_BOX_SCRIPT" ] || [ ! -r "$LAUNCH_BOX_SCRIPT" ]; then
    echo "error: LAUNCH_BOX_SCRIPT ($LAUNCH_BOX_SCRIPT) is not a readable file" >&2
    exit 1
fi

if [ $# -ne 6 ]; then
    echo "Usage: LAUNCH_BOX_SCRIPT=<path> $0 <app_uuid> <storage_key> <version> <sha256> <server_id> <subnet_id>" >&2
    exit 1
fi
APP_UUID="$1"
STORAGE_KEY="$2"
BUILD_VERSION_NUMBER="$3"
EXPECTED_SHA256="$4"
SIMPLE_SERVER_ID="$5"
SUBNET_ID="$6"

# This app's environment contract carries APP_VERSION (GET /which
# reports it back); a one-off manual build is always version 1, so this
# tool fixes it there rather than inventing a versioning scheme the
# future managed-server platform service will own.
APP_VERSION="1"

# An explicit template (not `-t prefix`, whose BSD and GNU mktemp
# implementations disagree on) replacing the XXXXXX run in place, so
# exactly one file is created atomically and the trap below removes the
# same path that was written.
LAUNCH_JSON_PATH="$(mktemp "${TMPDIR:-/tmp}/launch-json-XXXXXX.json")"
trap 'rm -f "$LAUNCH_JSON_PATH"' EXIT

APP_UUID="$APP_UUID" \
STORAGE_KEY="$STORAGE_KEY" \
BUILD_VERSION_NUMBER="$BUILD_VERSION_NUMBER" \
EXPECTED_SHA256="$EXPECTED_SHA256" \
SIMPLE_SERVER_ID="$SIMPLE_SERVER_ID" \
APP_VERSION="$APP_VERSION" \
OUT_PATH="$LAUNCH_JSON_PATH" \
    python3 <<'PYEOF'
import json, os

launch_json = {
    "app_uuid": os.environ["APP_UUID"],
    "artifact_key": f'{os.environ["STORAGE_KEY"]}/{os.environ["BUILD_VERSION_NUMBER"]}/app',
    "expected_sha256": os.environ["EXPECTED_SHA256"],
    "port": 8080,
    "memory_max_mib": 256,
    "log_group": f'/lmcd/simple-server/apps/{os.environ["APP_UUID"]}',
    "app_env": {
        "SIMPLE_SERVER_ID": os.environ["SIMPLE_SERVER_ID"],
        "APP_VERSION": os.environ["APP_VERSION"],
    },
}
# Deliberately no "tunnel" block and no "mount_prefix" — the tunnel-free
# schema simple-server-boot refuses anything else (LAUNCH_JSON_HAS_TUNNEL_BLOCK).
with open(os.environ["OUT_PATH"], "w") as f:
    json.dump(launch_json, f, indent=2)
PYEOF

echo "==> launch.json:"
cat "$LAUNCH_JSON_PATH"
echo
echo "==> Launching via ${LAUNCH_BOX_SCRIPT}..."
bash "$LAUNCH_BOX_SCRIPT" "$LAUNCH_JSON_PATH" "$SUBNET_ID"
