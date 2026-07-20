#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="pvvxzpwxjvzkzrzrkbaj"

if [[ "${ALLOW_REMOTE_SUPABASE:-}" != "1" ]]; then
  echo "Set ALLOW_REMOTE_SUPABASE=1 before publishing to hosted Supabase."
  exit 1
fi

npm test -- --run
npm run build

if ! npx supabase projects list >/dev/null 2>&1; then
  echo "Supabase CLI login required. Run: npx supabase login"
  exit 1
fi

npx supabase link --project-ref "$PROJECT_REF"
npx supabase db push --yes

git add \
  package.json \
  scripts/publish.sh \
  src/components/Tree/DagLayout.ts \
  src/services/data/familyGraphAdapter.ts \
  supabase/migrations/202607200002_media_storage.sql \
  supabase/migrations/202607200003_explicit_spouse_field.sql \
  supabase/migrations/202607200004_drop_primary_person_id.sql \
  tools/verify-remote.ts
git commit -m "fix: derive spouses from family lineage" || true
git push -u pages HEAD
