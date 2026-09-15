#!/bin/bash
set -u

root=$(cd -- "$(dirname -- "$0")/.." && pwd)
script="$root/pilely_token_store"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/pilely-token-store-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "expected [$2], got [$1]"; }
assert_contains() { case "$1" in *"$2"*) ;; *) fail "expected [$1] to contain [$2]" ;; esac; }
assert_not_contains() { case "$1" in *"$2"*) fail "expected [$1] to NOT contain [$2]" ;; esac; }

mkdir "$tmp/bin"

# Fake `curl`: answers by matching the request URL (the one argument
# starting with "http") against the three routes this script knows, each
# controlled by its own TEST_*_HTTP / TEST_*_BODY pair so one run can
# script a whole send → verify → /~/me sequence.
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
  */~/login) http=${TEST_LOGIN_HTTP:-200}; body=${TEST_LOGIN_BODY:-'{"ok":true}'} ;;
  */~/login/verify_auth_code) http=${TEST_VERIFY_HTTP:-200}; body=${TEST_VERIFY_BODY:-} ;;
  */~/me) http=${TEST_ME_HTTP:-200}; body=${TEST_ME_BODY:-'{"ok":true,"user_handle":"alice"}'} ;;
  *) exit 92 ;;
esac
printf '%s' "$body" > "$out"
printf '%s' "$http"
CURL
chmod +x "$tmp/bin/curl"

# Fake `security`: a flat-file keychain under TEST_KEYCHAIN_DIR, keyed by
# service+account. `add-generic-password -w <value> -U` writes; a bare
# `find-generic-password -w` (no argument — that form means "print the
# password") reads, failing when the entry does not exist, like the real
# thing.
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

run() {
  account_file="$tmp/account_$RANDOM"
  keychain_dir="$tmp/keychain_$RANDOM"
  mkdir -p "$keychain_dir"
  set +e
  PATH="$tmp/bin:$PATH" \
    PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" \
    TEST_KEYCHAIN_DIR="$keychain_dir" \
    TEST_CURL_LOG="$tmp/curl.log" \
    "$@" "$script" "${args[@]}" >"$tmp/stdout" 2>"$tmp/stderr"
  status=$?
  set -e
  stdout=$(cat "$tmp/stdout")
  stderr=$(cat "$tmp/stderr")
}

# send-email-code: ok
: > "$tmp/curl.log"
args=(send-email-code alice@example.com)
run env TEST_LOGIN_HTTP=200
assert_eq "$status" 0
assert_eq "$stdout" ok

# send-email-code: rate limited
args=(send-email-code alice@example.com)
run env TEST_LOGIN_HTTP=429 TEST_LOGIN_BODY='{"code":"rate_limit_email"}'
assert_eq "$status" 1
assert_eq "$stdout" rate_limit_email

# send-email-code: rejects a non-email argument without calling curl
: > "$tmp/curl.log"
args=(send-email-code not-an-email)
run env
assert_eq "$status" 1
[ ! -s "$tmp/curl.log" ] || fail 'invalid email reached curl'

# verify-email-code: success extracts the token from the markdown fence,
# writes it to the keychain, writes the account file, and prints the
# handle from /~/me — never the token itself.
verify_body=$'# Authenticated\n\nWelcome, @alice.\n\nYour auth JWT token (sensitive):\n```\nFAKE.JWT.VALUE\n```\n\nExpire at:\n```\n1999999999999 (in 7 days)\n```\n'
account_file="$tmp/account_verify"
keychain_dir="$tmp/keychain_verify"
mkdir -p "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" \
  PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" \
  TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_VERIFY_HTTP=200 TEST_VERIFY_BODY="$verify_body" \
  TEST_ME_HTTP=200 TEST_ME_BODY='{"ok":true,"user_handle":"alice42"}' \
  "$script" verify-email-code alice@example.com 123456 >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
stdout=$(cat "$tmp/stdout")
assert_eq "$status" 0
assert_eq "$stdout" alice42
assert_not_contains "$stdout" FAKE.JWT.VALUE
[ "$(cat "$account_file")" = alice@example.com ] || fail 'account id file was not written'
stored=$(TEST_KEYCHAIN_DIR="$keychain_dir" "$tmp/bin/security" find-generic-password -s pile.ly -a alice@example.com -w)
assert_eq "$stored" FAKE.JWT.VALUE

# verify-email-code: a bad code neither prints nor stores a token
account_file="$tmp/account_verify_bad"
keychain_dir="$tmp/keychain_verify_bad"
mkdir -p "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" \
  PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" \
  TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_VERIFY_HTTP=401 TEST_VERIFY_BODY='Authentication failed' \
  "$script" verify-email-code alice@example.com 000000 >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
stdout=$(cat "$tmp/stdout")
assert_eq "$status" 1
assert_eq "$stdout" unauthorized
[ ! -f "$account_file" ] || fail 'account id file was written on a failed verify'

# status: nothing stored yet
account_file="$tmp/account_status_empty"
keychain_dir="$tmp/keychain_status_empty"
mkdir -p "$keychain_dir"
set +e
PATH="$tmp/bin:$PATH" \
  PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" \
  TEST_KEYCHAIN_DIR="$keychain_dir" \
  "$script" status >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
assert_eq "$(cat "$tmp/stdout")" 'no account stored'

# status: stored and valid
account_file="$tmp/account_status_ok"
keychain_dir="$tmp/keychain_status_ok"
mkdir -p "$keychain_dir"
printf 'alice@example.com' > "$account_file"
TEST_KEYCHAIN_DIR="$keychain_dir" PATH="$tmp/bin:$PATH" \
  "$tmp/bin/security" add-generic-password -s pile.ly -a alice@example.com -w FAKE.JWT.VALUE -U
set +e
PATH="$tmp/bin:$PATH" \
  PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" \
  TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_ME_HTTP=200 \
  "$script" status >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 0
assert_eq "$(cat "$tmp/stdout")" 'alice@example.com: valid'

# status: stored but /~/me rejects it
account_file="$tmp/account_status_bad"
keychain_dir="$tmp/keychain_status_bad"
mkdir -p "$keychain_dir"
printf 'alice@example.com' > "$account_file"
TEST_KEYCHAIN_DIR="$keychain_dir" PATH="$tmp/bin:$PATH" \
  "$tmp/bin/security" add-generic-password -s pile.ly -a alice@example.com -w FAKE.JWT.VALUE -U
set +e
PATH="$tmp/bin:$PATH" \
  PILELY_ACCOUNT_KEYCHAIN_ID_FILE="$account_file" \
  TEST_KEYCHAIN_DIR="$keychain_dir" \
  TEST_ME_HTTP=401 \
  "$script" status >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
assert_eq "$(cat "$tmp/stdout")" 'alice@example.com: invalid (http 401)'

# Every subcommand rejects the wrong arity before doing any work.
: > "$tmp/curl.log"
set +e
PATH="$tmp/bin:$PATH" TEST_KEYCHAIN_DIR="$tmp/keychain_arity" \
  "$script" send-email-code >"$tmp/stdout" 2>"$tmp/stderr"
status=$?
set -e
assert_eq "$status" 1
[ ! -s "$tmp/curl.log" ] || fail 'bad arity reached curl'

printf 'test_pilely_token_store.sh: PASS\n'
