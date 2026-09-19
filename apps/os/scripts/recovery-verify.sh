#!/usr/bin/env bash
#
# recovery-verify.sh — run the PostgreSQL recovery proofs in an EMPTY environment (Dependency R1).
#
# WHY AN EMPTY ENVIRONMENT. The 2D runbook's restore commands took their target from ambient PG*
# variables, so a shell that had just taken a backup would have restored onto the production cluster.
# The restore now refuses to run while ANY PG* or *DATABASE_URL* variable is visible; this runner
# makes that easy to satisfy by starting from `env -i` and passing exactly the variables it names
# below — none of which can reach a database.
#
# USAGE (from apps/os)
#   ./scripts/recovery-verify.sh
#       the mechanism proof (fixture leg) and the artifact format proof; touches nothing outside the process
#
#   ./scripts/recovery-verify.sh --artifact ~/AscendBackups/ascend-backup-<TS>.ascbk --owner-email <email>
#       additionally restores THAT artifact into in-process PGlite and verifies it F1–F18 (R1b)
#       [--keyring DIR]   where the artifact's key is found by id (default ~/.config/ascend/backup-keys)
#
# THE OWNER PASSWORD (for the F9 login proof) is taken from ASCEND_RECOVERY_OWNER_PASSWORD if the
# caller set it, otherwise read from ASCEND_OWNER_PASSWORD in .env.production.local — that ONE key,
# parsed without printing, and nothing else from that file. It is passed to the test process under a
# name the isolation guard does not treat as connection configuration, and is never echoed or placed
# in any process's argv (where `ps` would show it) — it travels only in the environment.

set -euo pipefail
cd "$(dirname "$0")/.."

ARTIFACT="" OWNER_EMAIL="" KEYRING="$HOME/.config/ascend/backup-keys" ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --owner-email) OWNER_EMAIL="$2"; shift 2 ;;
    --keyring) KEYRING="$2"; shift 2 ;;
    --only-artifact) ONLY="artifact"; shift ;;
    *) echo "recovery-verify: unknown argument $1" >&2; exit 2 ;;
  esac
done

SUITES=(tests/recovery/artifact.test.ts tests/db/restore-fidelity.test.ts)
PASS=()
if [ -n "$ARTIFACT" ]; then
  [ -f "$ARTIFACT" ] || { echo "recovery-verify: no artifact at $ARTIFACT" >&2; exit 2; }
  [ -n "$OWNER_EMAIL" ] || { echo "recovery-verify: --owner-email is required with --artifact" >&2; exit 2; }
  PASSWORD="${ASCEND_RECOVERY_OWNER_PASSWORD:-}"
  if [ -z "$PASSWORD" ]; then
    PASSWORD="$(python3 - <<'PY'
import sys
try:
    lines = open(".env.production.local").read().splitlines()
except FileNotFoundError:
    sys.exit(0)
for l in lines:
    if l.startswith("ASCEND_OWNER_PASSWORD="):
        print(l.split("=", 1)[1].strip().strip('"').strip("'"), end="")
PY
    )"
  fi
  [ -n "$PASSWORD" ] || { echo "recovery-verify: no owner password available for the F9 login proof" >&2; exit 2; }
  PASS=(ASCEND_BACKUP_ARTIFACT ASCEND_BACKUP_KEYRING ASCEND_RECOVERY_OWNER_EMAIL ASCEND_RECOVERY_OWNER_PASSWORD)
  export ASCEND_BACKUP_ARTIFACT="$ARTIFACT" ASCEND_BACKUP_KEYRING="$KEYRING"
  export ASCEND_RECOVERY_OWNER_EMAIL="$OWNER_EMAIL" ASCEND_RECOVERY_OWNER_PASSWORD="$PASSWORD"
  unset PASSWORD
  SUITES+=(tests/db/restore-independence.test.ts)
  [ "$ONLY" = "artifact" ] && SUITES=(tests/db/restore-independence.test.ts)
fi

# EMPTY THE ENVIRONMENT: every inherited variable is unset except PATH and HOME (which only locate
# node and the keyring) and the names above. Unsetting, rather than `env -i NAME=value`, keeps every
# value out of argv.
KEEP=" PATH HOME ${PASS[*]+${PASS[*]}} "
while IFS= read -r name; do
  case "$KEEP" in *" $name "*) ;; *) unset "$name" 2>/dev/null || true ;; esac
done < <(compgen -e)
exec npx vitest run "${SUITES[@]}"
