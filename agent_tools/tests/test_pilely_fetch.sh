#!/bin/bash
set -u

root=$(cd -- "$(dirname -- "$0")/.." && pwd)
script="$root/pilely_fetch"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/pilely-fetch-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "expected [$2], got [$1]"; }
assert_contains() { case "$1" in *"$2"*) ;; *) fail "expected [$1] to contain [$2]" ;; esac; }
assert_not_contains() { case "$1" in *"$2"*) fail "expected [$1] to NOT contain [$2]" ;; esac; }

mkdir "$tmp/bin"

# Fake `curl`: matches the request URL (the argument starting with
# "http") against the one route pilely_fetch knows (the mint) plus a
# catch-all "target" response for every other URL, each controlled by
# its own TEST_*_HTTP / TEST_*_BODY pair. The full argv is logged so
# tests can assert on which headers were sent.
cat > "$tmp/bin/curl" <<'CURL'
#!/bin/bash
out=""
url=""
prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && out="$a"
  case "$a" in http*) url="$a" ;; esac
  prev="$a"
done
printf '%s\n' "$*" >> "${TEST_CURL_LOG:-/dev/null}"
case "$url" in
  */~/mint/app_id_token) http=${TEST_MINT_HTTP:-200}; body=${TEST_MINT_BODY:-'{"ok":true,"token":"MINTED.TOKEN","expires_at_millis":9999999999999}'} ;;
  *) http=${TEST_TARGET_HTTP:-200}; body=${TEST_TARGET_BODY:-'{"ok":true}'} ;;
esac
printf '%s' "$body" > "$out"
printf '%s' "$http"
CURL
chmod +x "$tmp/bin/curl"

# Fake `security`: a flat-file keychain under TEST_KEYCHAIN_DIR, keyed by
# service+account, mirroring the real `security find/add-generic-password
# -w` contract this script relies on.
cat > "$tmp/bin/security" <<'SEC'
#!/bin/bash
dir="${TEST_KEYCHAIN_DIR:?TEST_KEYCHAIN_DIR not set}"
mkdir -p "$dir"
mode=$1; shift
service=""; account=""; value=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s) service=$2; shift 2 ;;
    -a) account=$2; shift 2 ;;
    -w)
      if [ "$mode" = add-generic-password ]; then value=$2; shift 2; else shift 1; fi
      ;;
    -U) shift 1 ;;
    *) shift 1 ;;
  esac
done
key=$(printf '%s|%s' "$service" "$account" | shasum | cut -d' ' -f1)
file="$dir/$key"
case "$mode" in
  add-generic-password) printf '%s' "$value" > "$file"; exit 0 ;;
  find-generic-password) [ -f "$file" ] || exit 44; cat "$file"; exit 0 ;;
  *) exit 91 ;;
esac
SEC
chmod +x "$tmp/bin/security"

seed_login_token() {
  local email=$1 keychain_dir=$2
  TEST_KEYCHAIN_DIR="$keychain_dir" PATH="$tmp/bin:$PATH" \
    "$tmp/bin/security" add-generic-password -s pile.ly -a "$email" -w LOGIN.TOKEN -U
}

seed_app_token() {
  local email=$1 host=$2 keychain_dir=$3 expiry=$4 token=$5
  TEST_KEYCHAIN_DIR="$keychain_dir" PATH="$tmp/bin:$PATH" \
    "$tmp/bin/security" add-generic-password -s pile.ly.app_token -a "$email:$host" -w "$expiry:$token" -U
}

new_case() {
  account_file="$tmp/account_$RANDOM$RANDOM"
  keychain_dir="$tmp/keychain_$RANDOM$RANDOM"
  mkdir -p "$keychain_dir"
  printf 'alice@example.com' > "$account_file"
  log="$tmp/curl_$RANDOM$RANDOM.log"
  : > "$log"
}

# --- apex GET: appends .md, sends the login token, no mint call ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" TEST_TARGET_HTTP=200 TEST_TARGET_BODY='manual body' \
  "$script" GET https://pilely.app/skill/foo >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
assert_eq "$(cat "$tmp/stdout")" 'manual body'
assert_contains "$(cat "$log")" 'https://pilely.app/skill/foo.md'
assert_contains "$(cat "$log")" 'Authorization: Bearer LOGIN.TOKEN'
assert_not_contains "$(cat "$log")" '/~/mint/app_id_token'

# --- apex GET: a path already ending in .md is not doubled ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET https://pilely.app/skill/foo.md >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
assert_contains "$(cat "$log")" 'https://pilely.app/skill/foo.md'
assert_not_contains "$(cat "$log")" 'foo.md.md'

# --- apex POST: sets Accept: application/json, no .md appending ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" POST https://pilely.app/~/me >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
assert_contains "$(cat "$log")" 'https://pilely.app/~/me'
assert_contains "$(cat "$log")" 'Accept: application/json'
assert_not_contains "$(cat "$log")" '~/me.md'

# --- non-apex GET with no cached token: mints, caches, sends app token ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" TEST_TARGET_HTTP=200 TEST_TARGET_BODY='service manual' \
  "$script" GET https://simple-db.pilely.app/skill.md >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
stderr=$(cat "$tmp/stderr")
set -e
assert_eq "$status" 0
assert_eq "$(cat "$tmp/stdout")" 'service manual'
assert_contains "$(cat "$log")" '/~/mint/app_id_token'
assert_contains "$(cat "$log")" 'Authorization: Bearer MINTED.TOKEN'
assert_contains "$stderr" 'sending app token'
assert_not_contains "$stderr" 'sending login token'
cached=$(TEST_KEYCHAIN_DIR="$keychain_dir" PATH="$tmp/bin:$PATH" "$tmp/bin/security" find-generic-password -s pile.ly.app_token -a alice@example.com:simple-db.pilely.app -w)
assert_eq "$cached" '9999999999999:MINTED.TOKEN'

# --- non-apex GET with a live cached token: no mint call ---
new_case
seed_login_token alice@example.com "$keychain_dir"
seed_app_token alice@example.com simple-db.pilely.app "$keychain_dir" 99999999999999 CACHED.TOKEN
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET https://simple-db.pilely.app/skill.md >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
assert_not_contains "$(cat "$log")" '/~/mint/app_id_token'
assert_contains "$(cat "$log")" 'Authorization: Bearer CACHED.TOKEN'

# --- non-apex GET with an expired cached token: re-mints ---
new_case
seed_login_token alice@example.com "$keychain_dir"
seed_app_token alice@example.com simple-db.pilely.app "$keychain_dir" 1 STALE.TOKEN
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET https://simple-db.pilely.app/skill.md >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
assert_contains "$(cat "$log")" '/~/mint/app_id_token'
assert_contains "$(cat "$log")" 'Authorization: Bearer MINTED.TOKEN'

# --- --as mints for the named app and sends that token to the target host ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" POST https://simple-blob.pilely.app/upload '{"x":1}' --as myapp.pilely.app >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
mint_call=$(grep '/~/mint/app_id_token' "$log")
assert_contains "$mint_call" '--data'
assert_contains "$(cat "$log")" 'https://simple-blob.pilely.app/upload'
cached_for_app=$(TEST_KEYCHAIN_DIR="$keychain_dir" PATH="$tmp/bin:$PATH" "$tmp/bin/security" find-generic-password -s pile.ly.app_token -a alice@example.com:myapp.pilely.app -w)
assert_eq "$cached_for_app" '9999999999999:MINTED.TOKEN'

# --- no login token: one message, no mint, no request ---
new_case
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET https://simple-db.pilely.app/skill.md >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
stderr=$(cat "$tmp/stderr")
assert_contains "$stderr" 'no login token stored for alice@example.com'
assert_not_contains "$stderr" 'mint request'
assert_eq "$(cat "$log")" ''
assert_eq "$(cat "$tmp/stdout")" ''

new_case
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET https://pilely.app/skill >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
assert_contains "$(cat "$tmp/stderr")" 'no login token stored for alice@example.com'
assert_eq "$(cat "$log")" ''

# --- --as is refused on the apex host ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" POST https://pilely.app/~/me '{}' --as myapp.pilely.app >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
[ ! -s "$log" ] || fail '--as on the apex reached curl'

# --- exit code follows the HTTP class ---
new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" TEST_TARGET_HTTP=404 TEST_TARGET_BODY='not found' \
  "$script" GET https://pilely.app/skill/missing >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 4
assert_eq "$(cat "$tmp/stdout")" 'not found'

new_case
seed_login_token alice@example.com "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" TEST_TARGET_HTTP=503 \
  "$script" GET https://pilely.app/skill/down >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 5

# --- no account file on record: refuses before touching curl ---
new_case
rm -f "$account_file"
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET https://pilely.app/skill >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
[ ! -s "$log" ] || fail 'missing account file still reached curl'

# --- wrong arity is rejected before touching curl ---
new_case
set +e
PATH="$tmp/bin:$PATH" PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_CURL_LOG="$log" \
  "$script" GET >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
[ ! -s "$log" ] || fail 'bad arity reached curl'

printf 'test_pilely_fetch.sh: PASS\n'
