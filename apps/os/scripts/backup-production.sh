#!/usr/bin/env bash
#
# backup-production.sh — the canonical PostgreSQL recovery point for Ascend OS (Dependency R1).
#
# ONE READ OF PRODUCTION, SEALED BEFORE IT IS KEPT. The Free plan has no PITR and no managed backups,
# so this artifact IS the database's recovery path.
#
# WHAT THE ARTIFACT CONTAINS — stated, because the previous version of this script said otherwise.
#   · the `public` schema and every row in it, sequence state, RLS, policies, grants, functions,
#     triggers, and the migration ledger (custom-format and portable `--inserts` dumps)
#   · the Ascend roles and their memberships, WITHOUT passwords (`--no-role-passwords`)
#   · a fidelity manifest taken from production before AND after the dump — and (RT-3) the EXACT
#     manifest SQL that produced it (`recovery-manifest.sql`), the commit it came from, and the ledger,
#     sealed as the artifact's own recovery contract (format ascend-backup/3, core/recovery/artifact.ts)
#   · CREDENTIAL-DERIVED MATERIAL: `users.password_hash` (scrypt KDF output) and
#     `invitations.token_hash`. A backup that preserves logins cannot exclude them.
#   · PII: prospect businesses, the owner's email, event payloads, operator notes.
# Therefore it is ENCRYPTED AT REST (AES-256-GCM, core/recovery/artifact.ts) and no plaintext copy is
# kept: the working directory is removed on every exit, success or failure.
#
# WHAT IT DOES NOT CONTAIN: the vault (Dependency R2), environment secrets, Supabase platform schemas
# and extensions (none of Ascend's objects depend on one — manifest key F16), role passwords.
#
# CONNECTION CONFIGURATION NEVER LEAVES THE READ. Production's host, user and password are exported
# only inside the `production` subshell below, for the duration of each psql/pg_dump call. The sealing
# step, and anything else this script runs, cannot see them — and the restore refuses to run in any
# process that can (core/recovery/restore.ts).
#
# READ-ONLY. Every session is opened with `default_transaction_read_only=on`; pg_dump takes only
# ACCESS SHARE locks. Nothing here writes to production.
#
# USAGE (from apps/os):
#   ./scripts/backup-production.sh --read-production --key-file ~/.config/ascend/backup-keys/<id>.key [label]
#
# `--read-production` is required on purpose: this script reads the production database, and it will
# not do so because somebody ran it without reading this header.

set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
APP_DIR="$(pwd -P)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$APP_DIR")"

die() { echo "backup: $*" >&2; exit 1; }

# ── arguments: explicit, or nothing happens ────────────────────────────────────────────────────
[ "${1:-}" = "--read-production" ] || die "refusing: pass --read-production to confirm this reads the production database"
shift
[ "${1:-}" = "--key-file" ] && [ -n "${2:-}" ] || die "refusing: pass --key-file <path to a 0600 backup key>"
KEY_FILE="$2"; shift 2
LABEL="${1:-}"
[ -z "$LABEL" ] || [[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || die "label may contain only letters, digits, . _ -"

# ── preconditions, all checked before any connection is opened ─────────────────────────────────
ENV_FILE=".env.production.local"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
for t in pg_dump pg_dumpall psql node shasum; do command -v "$t" >/dev/null || die "$t not found"; done

BK="$HOME/AscendBackups"
CA="$BK/ca/supabase-root-2021.crt"
[ -f "$CA" ] || die "missing pinned CA at $CA"
case "$BK/" in "$REPO_ROOT/"*|"$HOME/Library/Mobile Documents/"*|"$HOME/Desktop/"*|"$HOME/Documents/"*)
  die "backup directory $BK is inside the repository or a cloud-synced folder" ;; esac
mkdir -p "$BK"; chmod 700 "$BK"

ARTIFACT() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$APP_DIR/core/recovery/artifact.ts" "$@"; }

# RT-3 · the artifact seals the manifest it RAN and names the commit it came from. Both are claims
# about the repository, so the repository must be in a state that makes them true: a real commit, and
# no uncommitted change to the manifest or the schema (A5 below compares the schema with production).
SOURCE_COMMIT="$(git rev-parse --verify HEAD)" || die "not a git checkout; the artifact must name its source commit"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "HEAD is not a full commit id"
[ -z "$(git status --porcelain -- core/recovery/manifest.sql core/db/schema)" ] \
  || die "uncommitted changes to core/recovery/manifest.sql or core/db/schema; commit them so the artifact's provenance is true"
KEY_ID="$(ARTIFACT check-key --key-file "$KEY_FILE" --forbid "$REPO_ROOT" --forbid "$BK")" \
  || die "the key file was refused (see above); nothing was read"

TS="$(date -u +%Y%m%dT%H%M%SZ)${LABEL:+-$LABEL}"
OUT="$BK/ascend-backup-$TS.ascbk"
[ -e "$OUT" ] && die "$OUT already exists"
WORK="$(mktemp -d "$BK/.work-$TS-XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# The manifest is taken from the COMMIT, not the working file, and it is this copy that runs against
# production and this copy that is sealed: the bytes executed and the bytes recorded cannot differ.
git show "HEAD:./core/recovery/manifest.sql" > "$WORK/recovery-manifest.sql"
cmp -s "$WORK/recovery-manifest.sql" core/recovery/manifest.sql || die "core/recovery/manifest.sql differs from HEAD"

# ── the only place production connection details exist ────────────────────────────────────────
# A subshell: the exports end when each call does. Credentials are parsed from the env file into
# PG* variables; the password is never an argument, so it never appears in `ps`, and never printed.
production() (
  eval "$(python3 - "$ENV_FILE" <<'PY'
import sys, shlex, urllib.parse
line = [l for l in open(sys.argv[1]) if l.startswith("ASCEND_DATABASE_URL_DIRECT=")][0]
u = urllib.parse.urlparse(line.split("=", 1)[1].strip().strip('"').strip("'"))
if not (u.hostname or "").endswith(".supabase.co"):
    sys.exit("ASCEND_DATABASE_URL_DIRECT is not the Supabase direct endpoint")
print(f"export PGHOST={shlex.quote(u.hostname)}")
print(f"export PGPORT={u.port or 5432}")
print(f"export PGUSER={shlex.quote(urllib.parse.unquote(u.username))}")
print(f"export PGDATABASE={shlex.quote(u.path.lstrip('/'))}")
print(f"export PGPASSWORD={shlex.quote(urllib.parse.unquote(u.password))}")
PY
  )"
  export PGSSLMODE=verify-full PGSSLROOTCERT="$CA" PGAPPNAME="ascend-backup"
  export PGOPTIONS="-c default_transaction_read_only=on"
  "$@"
)

manifest() { production psql -X -q -At -v ON_ERROR_STOP=1 -F $'\t' -f "$WORK/recovery-manifest.sql"; }

echo "=== manifest (before) ==="
manifest > "$WORK/source-manifest.tsv"
get() { awk -F'\t' -v k="$1" '$1 == k { print $2 }' "$WORK/source-manifest.tsv"; }
[ "$(get meta.format)" = "ascend-recovery-manifest/1" ] || die "the manifest did not run"

# A5 — the ledger production reports must be the ledger this repository describes, checksum for
# checksum. A schema git does not know how to rebuild is not something to seal and call recoverable.
EXPECTED="$(for f in "$APP_DIR"/core/db/schema/*.sql; do printf '%s:%s\n' "$(basename "$f")" "$(shasum -a 256 "$f" | cut -d' ' -f1)"; done | paste -sd, -)"
ACTUAL="$(get F17.ledger | tr ',' '\n' | cut -d: -f1,2 | paste -sd, -)"
[ "$EXPECTED" = "$ACTUAL" ] || die "production's migration ledger does not match core/db/schema — re-plan before backing up"
echo "ledger           : $(get F17.ledger | tr ',' '\n' | wc -l | tr -d ' ') migrations, checksums match the repository"

# RT-3B · the application verification profile this artifact will be proven with: the ONE registered
# for exactly this ledger (core/recovery/profile-registry.ts). No profile for the ledger → no backup.
APPLICATION_PROFILE="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$APP_DIR/core/recovery/profile-registry.ts" for-ledger "$ACTUAL")" \
  || die "no application verification profile is registered for this ledger; add one with the migration"
echo "profile          : $APPLICATION_PROFILE"

echo "=== dumping (read-only) ==="
production pg_dump --schema=public --format=custom --compress=9 --file="$WORK/ascend-public.dump"
production pg_dump --schema=public --format=plain --inserts --file="$WORK/ascend-public-portable.sql"
# --no-role-passwords: pg_dumpall otherwise emits SCRAM verifiers. `ascend_app` is re-keyed from
# ASCEND_APP_DB_PASSWORD by core/db/provision.ts after a restore; the other roles are NOLOGIN.
production pg_dumpall --globals-only --no-role-passwords --file="$WORK/globals-nopw.sql"

echo "=== manifest (after) ==="
manifest > "$WORK/.manifest-after.tsv"
cmp -s "$WORK/source-manifest.tsv" "$WORK/.manifest-after.tsv" \
  || die "production changed while the dump ran; the dump and the manifest may disagree — run again"
rm -f "$WORK/.manifest-after.tsv"

# Role verifiers must never be sealed, encrypted or not. (Row-level credential hashes are declared below.)
if grep -rqE "SCRAM-SHA-256|PASSWORD '" "$WORK"; then die "role credential material found in the dump set"; fi

cat > "$WORK/CONTENTS.md" <<EOF
# Ascend OS recovery artifact $TS

Format ascend-backup/3 · sealed under key $KEY_ID · manifest ascend-recovery-manifest/1
Recovery contract (RT-3): recovery-manifest.sql sha256 $(shasum -a 256 "$WORK/recovery-manifest.sql" | cut -d' ' -f1) · source commit $SOURCE_COMMIT · application profile $APPLICATION_PROFILE · see PROVENANCE.json

## This artifact CONTAINS
- the public schema and every row: $(awk -F'\t' '$1 ~ /^F3\.rows\./ { sub(/^F3\.rows\./, "", $1); printf "%s=%s ", $1, $2 }' "$WORK/source-manifest.tsv")
- the recovery contract it is verified against: the exact manifest SQL that ran (recovery-manifest.sql) and PROVENANCE.json
- event sequence: $(get F6.sequences); seq $(get F6.events.seq.min)..$(get F6.events.seq.max)
- CREDENTIAL-DERIVED MATERIAL: $(get F9.credentials.count) users.password_hash (scrypt), $(get F3.rows.invitations) invitations.token_hash
- PII: prospect businesses and contacts, user emails, event payloads, operator notes
- Ascend roles and memberships WITHOUT passwords

## It does NOT contain
- the vault (Dependency R2), environment secrets, Supabase platform schemas/extensions, role passwords

Handle as sensitive. Restore only per RESTORE.md, into an isolated target.
EOF
sed -e "s/<TS>/$TS/g" -e "s/<KEY_ID>/$KEY_ID/g" scripts/RESTORE.template.md > "$WORK/RESTORE.md"

echo "=== sealing ==="
# Runs OUTSIDE `production`: this process never sees a connection detail.
ARTIFACT seal --work "$WORK" --out "$OUT" --key-file "$KEY_FILE" --source-commit "$SOURCE_COMMIT" --application-profile "$APPLICATION_PROFILE" --forbid "$REPO_ROOT"
( cd "$BK" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
ARTIFACT verify "$OUT" --keyring "$(dirname "$KEY_FILE")" --forbid "$REPO_ROOT" --forbid "$BK"

echo
echo "artifact         : $OUT"
echo "sha256           : $(cut -d' ' -f1 "$OUT.sha256")"
echo "key id           : $KEY_ID"
echo "source commit    : $SOURCE_COMMIT (manifest and schema clean at this commit)"
echo "contains         : credential-derived material and PII — encrypted; no plaintext copy was kept"
echo
echo "NEXT: prove it (docs/RECOVERY-RUNBOOK.md §4). An unrestored backup is not a recovery point."
echo "OFF-MACHINE COPY: required, destination not yet chosen — copy the .ascbk (never a key) when it is."
