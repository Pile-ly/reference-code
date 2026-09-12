#!/usr/bin/env bash
# zip_source.sh — package this project for the simple_server build job.
#
# Manual proof tooling only: the future managed-server platform service
# uploads a build's source itself, the way it will actually work in
# production. This script (and the rest of deploy/) stands in for that
# until then, and needs nothing beyond `zip`/`unzip` and the project
# itself — no monorepo checkout, no AWS credentials.
#
# The build job unpacks the zip and runs `cargo build --release` at its
# root, so Cargo.toml MUST sit at the top level of the archive — never one
# directory down. `target/` and `.git` are excluded: the build starts
# clean, and `target/` alone could blow the 50 MiB ceiling this script
# itself enforces below, before start_build.sh ever uploads it. `.env` is
# excluded too: this project's own `.gitignore` expects one to exist
# locally, and unlike a git checkout this script walks the real working
# directory, so a real app's real secrets would otherwise ride into the
# zip `start_build.sh` uploads to R2 and unpacks inside the build job.
# `.env.example` is kept — it documents the variables, not a secret.
#
#   Usage: ./zip_source.sh
#
# Writes managed_server.zip next to this script's project root, overwriting
# any existing one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_ZIP="$PROJECT_DIR/managed_server.zip"

for tool in zip unzip; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "error: '$tool' is not installed" >&2
        exit 1
    fi
done

rm -f "$OUT_ZIP"

# cd into the project root so Cargo.toml lands at the zip's own root, not
# nested under a "managed_server/" prefix.
(
    cd "$PROJECT_DIR"
    zip -r -X -q "$OUT_ZIP" . \
        -x 'target/*' -x 'target' \
        -x '.git/*' -x '.git' \
        -x '.env' \
        -x 'managed_server.zip'
)

SIZE_BYTES=$(wc -c < "$OUT_ZIP" | tr -d ' ')
SIZE_MIB=$((SIZE_BYTES / 1024 / 1024))
echo "Wrote $OUT_ZIP (${SIZE_BYTES} bytes, ~${SIZE_MIB} MiB)"

if [ "$SIZE_BYTES" -gt $((50 * 1024 * 1024)) ]; then
    echo "error: $OUT_ZIP exceeds the 50 MiB start-build ceiling" >&2
    exit 1
fi

# Captured into a variable first, not piped straight into grep: under
# `pipefail`, `grep -q`'s early exit on the first match can SIGPIPE
# `unzip` before it finishes writing, and pipefail then reports that as a
# pipeline failure even though the match was found — a real, observed
# flake, not a hypothetical one.
LISTING="$(unzip -l "$OUT_ZIP")"
if grep -qE '^ *[0-9]+ .* Cargo\.toml$' <<<"$LISTING"; then
    echo "Cargo.toml is present at the archive root."
else
    echo "error: Cargo.toml is not at the archive root of $OUT_ZIP" >&2
    exit 1
fi
