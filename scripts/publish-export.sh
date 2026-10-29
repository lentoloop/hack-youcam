#!/usr/bin/env bash
set -euo pipefail
source_root=$(cd "$(dirname "$0")/.." && pwd -P)
shortsha=$(git -C "$source_root" rev-parse --short HEAD)
default_root="/work"'space/eng/export'
out=$(realpath -m "${1:-$default_root/breakout-log-$shortsha}")
[[ $# -le 1 ]] || { echo 'Usage: publish-export.sh [empty-target-directory]'; exit 2; }
[[ "$out" != "$source_root" && "$out" != "$source_root/"* ]] || { echo 'Target must be outside the source tree'; exit 2; }
mkdir -p "$out"
[[ -z "$(ls -A "$out")" ]] || { echo 'Target must be empty'; exit 2; }
python3 - "$source_root" "$out" <<'PY'
import json, pathlib, re, shutil, sys
source, target = map(pathlib.Path, sys.argv[1:])
for name in (source / 'scripts/publish-allowlist.txt').read_text().splitlines():
    if not name or name.startswith('#'):
        continue
    rel = pathlib.PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts:
        raise SystemExit('Invalid manifest path')
    original = source / rel
    if any(p.is_symlink() for p in [original, *original.parents]) or not original.is_file():
        raise SystemExit(f'Manifest entry is missing or unsafe: {name}')
    destination = target / rel
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(original, destination)
    if rel.parts[0] == 'contracts' and destination.suffix == '.ts':
        text = destination.read_text()
        text = re.sub(r'\A/\*\*.*?\*/', '/** Shared public contract. */', text, count=1, flags=re.S)
        destination.write_text(text)
p = target / 'service/fixtures/run2-masks.ts'
p.write_text(p.read_text().replace('// synthetic AI face, Kai spike run2.', '// Synthetic AI face, run2.'))
p = target / 'service/package.json'
package = json.loads(p.read_text())
for name in ['smoke:live', 'smoke:breakout']:
    package['scripts'].pop(name, None)
p.write_text(json.dumps(package, indent=2) + '\n')
PY
failed=0
scanner=${GITLEAKS_BIN:-$(command -v gitleaks || true)}
if [[ -z "$scanner" ]]; then scanner="/home/"'box/.local/bin/gitleaks'; fi
scan_secrets() {
if [[ -x "$scanner" ]] && "$scanner" detect --source "$out" --no-git --redact --no-banner >/dev/null 2>&1; then
  echo 'gitleaks: PASS'
else
  echo 'gitleaks: FAIL (missing tool or findings; content suppressed)'
  return 1
fi
}
scan_private() {
python3 - "$out" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
patterns = [r'/work' + 'space', r'/home/' + 'box', r'\b(?:Kai|Julius|Opus|Clawd|Codex)\b']
bad = []
for p in root.rglob('*'):
    rel = p.relative_to(root)
    if any(part in {'.git', '.worktrees', '.agents', '.codex', '.aws'} for part in rel.parts) or p.name.startswith(('.env', '.dev.vars')) or re.fullmatch(r'y.*-notes\.md', p.name) or p.name in {'RESULT.txt', 'S4-SUMMARY.txt'}:
        bad.append(str(rel))
    if any(re.search(pattern, str(rel), re.I) for pattern in patterns):
        bad.append(str(rel))
    if p.is_symlink():
        bad.append(str(rel))
    elif p.is_file() and any(re.search(pattern, p.read_bytes().decode('utf8', errors='replace'), re.I) for pattern in patterns):
        bad.append(str(rel))
print(f'Private path/name scan: {"FAIL" if bad else "PASS"} ({len(bad)} files; content suppressed)')
if bad:
    print('\n'.join(sorted(set(bad))))
sys.exit(bool(bad))
PY
}
scan_secrets || failed=1
scan_private || failed=1
# Inspect source before executing any build tools in the export.
[[ "$failed" == 0 ]] || { echo "Export rejected: $out"; exit 1; }
cd "$out"
for directory in . service web; do
  if (cd "$directory" && npm ci --no-audit --no-fund); then
    echo "Dependencies ($directory): PASS"
  else
    echo "Dependencies ($directory): FAIL"
    failed=1
  fi
done
if bash scripts/verify-release.sh; then echo 'Export gate: PASS'; else failed=1; echo 'Export gate: FAIL'; fi
# Dependencies are verification tools, not release contents.
rm -rf -- node_modules service/node_modules web/node_modules service/.wrangler
scan_secrets || failed=1
scan_private || failed=1
if [[ "$failed" == 0 ]]; then
  echo "Export self-checks: PASS ($out)"
else
  echo "Export self-checks: FAIL ($out)"
fi
exit "$failed"
