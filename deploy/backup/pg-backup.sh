#!/usr/bin/env bash
# Daily PostgreSQL backup for Divvy: a custom-format pg_dump into /var/backups/divvy, 14-day local
# rotation, and an optional offsite copy with rclone. Restore: deploy/backup/pg-restore.md.
#
# Runs as the divvy-backup user from /etc/cron.d/divvy-backup, as an installed copy outside the releases
# (deploy/setup-vps.md §11), so the user that owns the releases can't change what runs with the database
# password. After changing this file, review it and install it again:
#   sudo install -o root -g root -m 755 deploy/backup/pg-backup.sh /usr/local/bin/divvy-pg-backup
#   40 3 * * * divvy-backup /usr/local/bin/divvy-pg-backup >> /var/log/divvy/backup/backup.log 2>&1
# It refuses to run as root: root-owned files in BACKUP_DIR would break every later run.
#
# Settings come from the environment first, then from the env file (read line by line, never sourced).
# The env file holds only what backups need, chmod 600 and owned by divvy-backup:
#   DIVVY_ENV_FILE   /etc/divvy/backup.env
#   DATABASE_URL     Prisma's URL, postgresql://user:pass@host:port/db?schema=public (the query is ignored)
#   BACKUP_DIR       /var/backups/divvy
#   RETENTION_DAYS   14
#   RCLONE_REMOTE    e.g. divvy-offsite:divvy/db (unset: no offsite copy)
#   TELEGRAM_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID   when both are set, failures are also sent to Telegram
#
# Exits non-zero on any failure and removes the partial file. Old backups are only rotated out after a
# new one has been written and checked, so a failing job never eats into the good ones.

set -Eeuo pipefail
umask 077
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

ENV_FILE="${DIVVY_ENV_FILE:-/etc/divvy/backup.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/divvy}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
LOG_FILE=/var/log/divvy/backup/backup.log

partial=""

log() { printf '%s pg-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# KEY=value from the env file, in the format Node's --env-file reads. The last assignment wins.
env_from_file() {
  local key="$1" line value
  [[ -r "$ENV_FILE" ]] || return 0
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1)" || return 0
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  printf '%s' "$value"
}

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(env_from_file TELEGRAM_BOT_TOKEN)}"
TELEGRAM_ALERT_CHAT_ID="${TELEGRAM_ALERT_CHAT_ID:-$(env_from_file TELEGRAM_ALERT_CHAT_ID)}"

notify_failure() {
  [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_ALERT_CHAT_ID" ]] || return 0
  # The token reaches curl through its config on stdin, so it never shows up in `ps`.
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
    curl -fsS --max-time 10 -K - -o /dev/null \
      --data-urlencode "chat_id=${TELEGRAM_ALERT_CHAT_ID}" --data-urlencode "text=$1" ||
    log "could not send the Telegram alert"
}

fail() {
  local status="${2:-1}"
  trap - ERR
  [[ -n "$partial" ]] && rm -f -- "$partial"
  log "failed: $1"
  notify_failure "Divvy database backup failed on $(hostname): $1. Check ${LOG_FILE}."
  exit "$status"
}
trap 'fail "command at line $LINENO exited with status $?" 1' ERR

[[ "$(id -u)" -ne 0 ]] || fail "refusing to run as root; run it as divvy-backup (sudo -u divvy-backup -H $0)"
[[ -r "$ENV_FILE" ]] || log "warning: $ENV_FILE is not readable by $(id -un); using the environment only"
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "RETENTION_DAYS must be a positive whole number of days"
for bin in pg_dump pg_restore node sha256sum flock; do
  command -v "$bin" > /dev/null || fail "$bin is not installed"
done

DATABASE_URL="${DATABASE_URL:-$(env_from_file DATABASE_URL)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-$(env_from_file RCLONE_REMOTE)}"
[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL is not set and not found in $ENV_FILE"

# Split the URL with Node's WHATWG parser, which also percent-decodes the user and password. The URL is
# passed through the environment and the parts come back on a pipe, so the password never reaches argv.
mapfile -d '' -t db < <(DIVVY_DB_URL="$DATABASE_URL" node -e '
  const u = new URL(process.env.DIVVY_DB_URL);
  if (!/^postgres(ql)?:$/.test(u.protocol)) process.exit(3);
  const d = decodeURIComponent;
  const parts = [u.hostname.replace(/^\[|\]$/g, "") || "localhost", u.port || "5432",
    d(u.username), d(u.password), d(u.pathname.replace(/^\//, ""))];
  process.stdout.write(parts.join("\0") + "\0");
' 2> /dev/null || true)
[[ "${#db[@]}" -eq 5 && -n "${db[2]}" && -n "${db[4]}" ]] || fail "DATABASE_URL is not a postgresql://user:pass@host:port/db URL"
export PGHOST="${db[0]}" PGPORT="${db[1]}" PGUSER="${db[2]}" PGPASSWORD="${db[3]}" PGDATABASE="${db[4]}"
export PGCONNECT_TIMEOUT=15 PGAPPNAME=divvy-backup

mkdir -p -- "$BACKUP_DIR"
exec 9> "$BACKUP_DIR/.pg-backup.lock"
flock -n 9 || fail "another backup is still running"

name="divvy-$(date -u +%Y%m%dT%H%M%SZ).dump"
final="$BACKUP_DIR/$name"
partial="$final.partial"

log "dumping ${PGDATABASE} on ${PGHOST}:${PGPORT} as ${PGUSER}"
pg_dump --format=custom --compress=6 --no-password --file="$partial"
# The archive must be complete enough for pg_restore to read its table of contents.
pg_restore --list "$partial" > /dev/null
mv -- "$partial" "$final"
partial=""
(cd "$BACKUP_DIR" && sha256sum -- "$name" > "$name.sha256")
log "wrote $name ($(du -h -- "$final" | cut -f1))"

if [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone > /dev/null || fail "RCLONE_REMOTE is set but rclone is not installed"
  rclone copyto --no-traverse "$final" "${RCLONE_REMOTE%/}/$name"
  rclone copyto --no-traverse "$final.sha256" "${RCLONE_REMOTE%/}/$name.sha256"
  log "copied offsite to ${RCLONE_REMOTE%/}/$name"
fi

# Rotation: local copies only. Offsite retention belongs to the bucket's lifecycle rules.
while IFS= read -r -d '' old; do
  rm -f -- "$old"
  log "rotated out ${old##*/}"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'divvy-*.dump' -o -name 'divvy-*.dump.sha256' \) -mmin "+$((RETENTION_DAYS * 24 * 60))" -print0)
# Leftovers of runs that were killed outright (SIGKILL, power loss) and never reached the cleanup.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'divvy-*.dump.partial' -mmin +1440 -delete

log "done"
