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
#   ./scripts/recovery-verify.sh --artifact ~/AscendBackups/ascend-backup-<TS>.ascbk --r1c-root <root>
#       R1c ONLY: restores THAT artifact into two disposable PostgreSQL servers built under <root>
#       (<root>/pg17/bin), over both restore paths, and runs the read-only application proof against
#       them. <root> must be a private directory (mode 0700) under ~/.ascend-r1c/.
#
#   --legacy-contract <id>   (RT-3) REQUIRED for a legacy `ascend-backup/2` artifact, REFUSED for an
#       `ascend-backup/3` one. Names the pinned recovery contract the artifact is verified against
#       (core/recovery/legacy-contracts.ts), e.g. post-009-20260920. A v3 artifact carries its own. There
#       is no default: the repository's current manifest.sql is never used to verify an existing artifact.
#
# THE OWNER EMAIL may be given as ASCEND_RECOVERY_OWNER_EMAIL in the caller's environment instead of
# --owner-email, which keeps it out of argv (where `ps` would show it), or typed at a silent prompt
# with --owner-email-prompt, which also keeps it out of shell history. R1c requires one of those.
#
# THE OWNER PASSWORD (for the F9 login proof) is taken from ASCEND_RECOVERY_OWNER_PASSWORD if the
# caller set it, otherwise read from ASCEND_OWNER_PASSWORD in .env.production.local — that ONE key,
# parsed without printing, and nothing else from that file. It is passed to the test process under a
# name the isolation guard does not treat as connection configuration, and is never echoed or placed
# in any process's argv (where `ps` would show it) — it travels only in the environment.

set -euo pipefail
cd "$(dirname "$0")/.."

ARTIFACT="" OWNER_EMAIL="${ASCEND_RECOVERY_OWNER_EMAIL:-}" KEYRING="$HOME/.config/ascend/backup-keys" ONLY="" R1C_ROOT="" LEGACY_CONTRACT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --owner-email) OWNER_EMAIL="$2"; EMAIL_IN_ARGV=1; shift 2 ;;
    --keyring) KEYRING="$2"; shift 2 ;;
    --only-artifact) ONLY="artifact"; shift ;;
    --r1c-root) R1C_ROOT="$2"; shift 2 ;;
    --legacy-contract) LEGACY_CONTRACT="$2"; shift 2 ;;
    --owner-email-prompt) read -r -s -p "Owner email (not echoed): " OWNER_EMAIL </dev/tty; echo >&2; shift ;;
    *) echo "recovery-verify: unknown argument $1" >&2; exit 2 ;;
  esac
done

SUITES=(tests/recovery/artifact.test.ts tests/db/restore-fidelity.test.ts tests/db/recovery-profiles.test.ts)
PASS=()
if [ -n "$ARTIFACT" ]; then
  [ -f "$ARTIFACT" ] || { echo "recovery-verify: no artifact at $ARTIFACT" >&2; exit 2; }
  [ -n "$OWNER_EMAIL" ] || { echo "recovery-verify: an owner email (ASCEND_RECOVERY_OWNER_EMAIL or --owner-email) is required with --artifact" >&2; exit 2; }
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
  if [ -n "$LEGACY_CONTRACT" ]; then
    [[ "$LEGACY_CONTRACT" =~ ^[a-z0-9-]+$ ]] || { echo "recovery-verify: --legacy-contract takes a contract id" >&2; exit 2; }
    export ASCEND_RECOVERY_LEGACY_CONTRACT="$LEGACY_CONTRACT"
    PASS+=(ASCEND_RECOVERY_LEGACY_CONTRACT)
  fi
  SUITES+=(tests/db/restore-independence.test.ts)
  [ "$ONLY" = "artifact" ] && SUITES=(tests/db/restore-independence.test.ts)
  if [ -n "$R1C_ROOT" ]; then
    case "$R1C_ROOT" in "$HOME/.ascend-r1c/"*) ;; *) echo "recovery-verify: --r1c-root must be under ~/.ascend-r1c/" >&2; exit 2 ;; esac
    [ -d "$R1C_ROOT" ] && [ -x "$R1C_ROOT/pg17/bin/postgres" ] || { echo "recovery-verify: no PostgreSQL build at $R1C_ROOT/pg17/bin" >&2; exit 2; }
    [ "$(stat -f %Lp "$R1C_ROOT")" = "700" ] || { echo "recovery-verify: $R1C_ROOT must be mode 0700" >&2; exit 2; }
    [ -z "${EMAIL_IN_ARGV:-}" ] || { echo "recovery-verify: R1c takes the owner email from ASCEND_RECOVERY_OWNER_EMAIL or --owner-email-prompt, not argv" >&2; exit 2; }
    export ASCEND_R1C_ROOT="$R1C_ROOT"
    PASS+=(ASCEND_R1C_ROOT)
    SUITES=(tests/db/restore-same-version.test.ts)
  fi
fi

# EMPTY THE ENVIRONMENT: every inherited variable is unset except PATH and HOME (which only locate
# node and the keyring) and the names above. Unsetting, rather than `env -i NAME=value`, keeps every
# value out of argv.
KEEP=" PATH HOME ${PASS[*]+${PASS[*]}} "
while IFS= read -r name; do
  case "$KEEP" in *" $name "*) ;; *) unset "$name" 2>/dev/null || true ;; esac
done < <(compgen -e)
exec npx vitest run "${SUITES[@]}"
