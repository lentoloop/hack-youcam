#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
failed=0
checks=(
  'contracts|.|./node_modules/.bin/tsc -p tsconfig.contracts.json'
  'service-tsc|service|./node_modules/.bin/tsc -p tsconfig.json'
  'web-tsc|web|./node_modules/.bin/tsc -p tsconfig.json'
  'service-tests|service|npm test'
  'e2e|service|npm run test:e2e'
  'web-tests|web|npm test'
  'web-build|web|npm run build'
  'migrations|.|node scripts/verify-migrations.mjs'
)
for check in "${checks[@]}"; do
  IFS='|' read -r label directory command <<< "$check"
  if (cd "$directory" && bash -c "$command"); then
    echo "$label: PASS"
  else
    echo "$label: FAIL"
    failed=1
  fi
done
exit "$failed"
