#!/usr/bin/env bash
#
# backup-production.sh — take a verified, off-repo recovery point.
#
# WHY A SCRIPT. The Free plan has no PITR and no managed backups, so this artifact IS the recovery
# path. A procedure that only exists as a paragraph gets retyped slightly differently each time, and
# the one time it matters the difference will be the part that mattered.
#
# WHAT IT GUARANTEES
#   · TLS certificate verification (verify-full against the pinned Supabase root)
#   · the password never appears in argv, so it is never visible in `ps`
#   · artifacts land OUTSIDE the repository and OUTSIDE iCloud
#   · role password hashes never enter the transferable bundle
#   · every file is checksummed, and the bundle is checksummed as a whole
#
# USAGE   ./scripts/backup-production.sh [label]
# from apps/os. `label` is an optional suffix, e.g. `pre-2e`.

set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.production.local"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }

export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
command -v pg_dump >/dev/null || { echo "pg_dump not found (brew install libpq)" >&2; exit 1; }

BK="$HOME/AscendBackups"
CA="$BK/ca/supabase-root-2021.crt"
[ -f "$CA" ] || { echo "missing pinned CA at $CA" >&2; exit 1; }

# Discrete connection fields; the password goes to PGPASSWORD and is never echoed.
eval "$(python3 - "$ENV_FILE" <<'PY'
import sys, shlex, urllib.parse
line = [l for l in open(sys.argv[1]) if l.startswith("ASCEND_DATABASE_URL_DIRECT=")][0]
u = urllib.parse.urlparse(line.split("=", 1)[1].strip())
print(f"export PGHOST={shlex.quote(u.hostname)}")
print(f"export PGPORT={u.port or 5432}")
print(f"export PGUSER={shlex.quote(urllib.parse.unquote(u.username))}")
print(f"export PGDATABASE={shlex.quote(u.path.lstrip('/'))}")
print(f"export PGPASSWORD={shlex.quote(urllib.parse.unquote(u.password))}")
PY
)"
export PGSSLMODE=verify-full PGSSLROOTCERT="$CA"

LABEL="${1:-}"
TS="$(date -u +%Y%m%dT%H%M%SZ)${LABEL:+-$LABEL}"
D="$BK/$TS"
mkdir -p "$D"

echo "=== recording production state ==="
psql -Atc "SELECT 'migration_version : ' || max(version) FROM schema_migrations"
psql -Atc "SELECT 'rows              : organizations=' || (SELECT count(*) FROM organizations)
        || ' users='       || (SELECT count(*) FROM users)
        || ' memberships=' || (SELECT count(*) FROM memberships)
        || ' prospects='   || (SELECT count(*) FROM prospects)
        || ' events='      || (SELECT count(*) FROM events)"
psql -Atc "SELECT 'identity          : anchored=' || count(*) FILTER (WHERE identity_state='anchored')
        || ' held=' || count(*) FILTER (WHERE identity_state='held') FROM prospects"
psql -Atc "SELECT 'operator_events   : ' || count(*) FILTER (WHERE actor='operator') FROM events"
psql -Atc "SELECT 'events_seq_seq    : ' || last_value FROM events_seq_seq"

echo "=== dumping ==="
pg_dump --schema=public --format=custom --compress=9 --file="$D/ascend-public-$TS.dump"
pg_dump --schema=public --format=plain  --inserts     --file="$D/ascend-public-$TS-portable.sql"
# --no-role-passwords: pg_dumpall otherwise emits SCRAM verifiers, which are credentials. The app
# login is rebuilt from ASCEND_APP_DB_PASSWORD by core/db/provision.ts, so nothing is lost.
pg_dumpall --globals-only --no-role-passwords --file="$D/globals-$TS-nopw.sql"
cp "$CA" "$D/supabase-root-2021.crt"

sed -e "s/<TS>/$TS/g" scripts/RESTORE.template.md > "$D/RESTORE.md"

( cd "$D" && shasum -a 256 -- * > SHA256SUMS.txt )
tar -czf "$BK/ascend-backup-$TS.tar.gz" -C "$BK" "$TS"
( cd "$BK" && shasum -a 256 "ascend-backup-$TS.tar.gz" > "ascend-backup-$TS.tar.gz.sha256" )

echo "=== verifying what was just written ==="
( cd "$D" && shasum -a 256 -c SHA256SUMS.txt )
if grep -rqE "SCRAM-SHA-256|PASSWORD '" "$D"; then
  echo "REFUSING: credential material found in the backup set" >&2; exit 1
fi
echo "credential scan  : CLEAN"
echo
echo "backup dir       : $D"
echo "bundle           : $BK/ascend-backup-$TS.tar.gz"
echo "bundle sha256    : $(cut -d' ' -f1 "$BK/ascend-backup-$TS.tar.gz.sha256")"
echo
echo "COPY THE BUNDLE OFF THIS MACHINE and re-verify its checksum at the destination."
