#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export HOME="/tmp/soyagaci-supabase-cli"
mkdir -p "$HOME"

tmp="$(mktemp -d)"
generated="$tmp/database.ts"
vite_log="$tmp/vite.log"
vite_pid=""
vite_pgid=""
supabase_initialized=0
vite_metadata="node_modules/.vite/deps/_metadata.json"
restore_vite_cache() {
  git restore --source=HEAD -- "$vite_metadata"
}
port_in_use() {
  lsof -nP -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1
}
stop_vite() {
  local failed=0
  if [[ -n "$vite_pgid" ]]; then
    kill -TERM -- "-$vite_pgid" 2>/dev/null || true
    for _ in {1..20}; do
      ! kill -0 "$vite_pid" 2>/dev/null && break
      sleep 0.25
    done
    if kill -0 "$vite_pid" 2>/dev/null; then
      kill -KILL -- "-$vite_pgid" 2>/dev/null || true
    fi
    wait "$vite_pid" 2>/dev/null || true
  fi
  vite_pid=""
  vite_pgid=""
  for _ in {1..20}; do
    ! port_in_use && return "$failed"
    sleep 0.25
  done
  return 1
}
verify_seed_only() {
  local residue
  residue="$(docker exec -i "supabase_db_$(basename "$root")" psql -U postgres -d postgres -At -c \
    "select count(*) from auth.users; select count(*) from public.admins; select count(*) from public.admin_invitations; select count(*) from public.admin_bootstrap_state; select count(*) from public.admin_bootstrap_state where completed_at is not null or admin_user_id is not null; select count(*) from public.families; select count(*) from public.people; select count(*) from public.submissions; select count(*) from public.families where slug = 'step10-primary';")" || return 1
  [[ "$residue" == $'0\n0\n0\n1\n0\n2\n5\n0\n0' ]]
}
cleanup() {
  original_status=$?
  cleanup_status=0
  trap - EXIT INT TERM
  set +e
  stop_vite || cleanup_status=1
  restore_vite_cache
  if (( supabase_initialized )); then
    npx supabase db reset >/dev/null || cleanup_status=1
    verify_seed_only || cleanup_status=1
  fi
  git diff --exit-code -- .vite "$vite_metadata" >/dev/null || cleanup_status=1
  rm -rf "$tmp"
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT INT TERM

npx supabase start >/dev/null
supabase_initialized=1
npx supabase db reset

eval "$(npx supabase status -o env | sed -n -E 's/^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET)=(.*)$/\1=\2/p')"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_JWT_SECRET="$JWT_SECRET"

auth_ready() {
  curl -fs "$SUPABASE_URL/auth/v1/health" >/dev/null 2>&1
}

ensure_auth() {
  for _ in {1..10}; do
    auth_ready && break
    sleep 1
  done
  if ! auth_ready; then
    docker restart "supabase_kong_$(basename "$root")" >/dev/null
    for _ in {1..10}; do
      auth_ready && break
      sleep 1
    done
  fi
  auth_ready
}

ensure_auth

npx supabase test db supabase/tests
npx vitest run tests/adminBootstrapCli.integration.test.ts
npx supabase db reset
ensure_auth
npx vitest run tests/adminInvitations.integration.test.ts
npx supabase db reset
ensure_auth
npx vitest run tests/publicEditModeration.integration.test.ts
npx vitest run tests/familyCreation.integration.test.ts
npx vitest run tests/importSheet.integration.test.ts

if [[ "${VERIFY_LOCAL_FAIL_AT:-}" == "after-http" ]]; then
  echo 'Injected verification failure after HTTP integrations' >&2
  exit 97
fi

npx supabase gen types typescript --local > "$generated"
cmp src/types/database.ts "$generated"

npx vitest run tests/familyRepository.test.ts tests/familyGraphAdapter.test.ts
env -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_JWT_SECRET npm test -- --run
npm run build

if rg -n 'script\.google|docs\.google|sheets\.google|apps-script|SERVICE_ROLE_KEY|GOOGLE_SECRET|signInWithPassword|signInWithOtp|magic.?link' dist; then
  echo 'Production bundle contains a forbidden secret, auth, or Google write path' >&2
  exit 1
fi
if rg -n '(getSupabaseClient\(\)|supabase|client)\.from\(' src/main.ts src/ui/admin.ts src/ui/editor/index.ts src/ui/editor/submission.ts src/services/data/familyRepository.ts src/services/supabase/client.ts; then
  echo 'Production runtime contains direct table access' >&2
  exit 1
fi
npx vitest run tests/noGoogleRuntime.test.ts

npx supabase db reset
ensure_auth

dad_csv="${PRIMARY_CSV:-}"
if [[ -z "$dad_csv" ]]; then
  dad_csv="$tmp/selcuk.csv"
  if ! curl -fsSL --retry 2 --connect-timeout 10 \
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vTzo66Bb8-z3QdqtNGZ9uhQJZJxePifl6nJwvtlot-3JtKp4YKYQdqJNFDY89lqHoMRdlKZmjWzh2OA/pub?output=csv' \
    -o "$dad_csv"; then
    dad_csv=""
  fi
fi
if [[ -n "$dad_csv" ]]; then
  PRIMARY_CSV="$dad_csv" npx vitest run tests/importSheet.parity.test.ts
  npm run import:sheet -- --file "$dad_csv" --family-slug step10-primary --family-name 'Step 10 Primary' --privacy family
  second_import="$(npm run import:sheet -- --file "$dad_csv" --family-slug step10-primary --family-name 'Step 10 Primary' --privacy family)"
  printf '%s\n' "$second_import"
  grep -q '"no_op": true' <<<"$second_import"
else
  if [[ "${ALLOW_PARITY_SKIP:-}" == "1" ]]; then
    echo 'WARNING: Primary parity skipped by explicit non-release override.' >&2
  else
    echo 'Primary parity is required; set PRIMARY_CSV or provide a reachable published source.' >&2
    exit 1
  fi
fi

ensure_auth
if port_in_use; then
  echo 'Port 4173 is already in use; refusing to target an unowned server.' >&2
  exit 1
fi
setsid env VITE_SUPABASE_URL="$SUPABASE_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_ANON_KEY" \
  VITE_FAMILY_SLUGS='demo-alpha,demo-beta' ./node_modules/.bin/vite \
  --host 127.0.0.1 --port 4173 --strictPort >"$vite_log" 2>&1 &
vite_pid=$!
vite_pgid=$vite_pid
for _ in {1..30}; do
  curl -fs http://127.0.0.1:4173/aile/ >/dev/null 2>&1 && break
  kill -0 "$vite_pid" 2>/dev/null || { cat "$vite_log" >&2; exit 1; }
  sleep 1
done
curl -fsS http://127.0.0.1:4173/aile/ >/dev/null
node scripts/browser-step10.mjs
stop_vite
restore_vite_cache

git diff --check
git diff --exit-code -- .vite "$vite_metadata"
