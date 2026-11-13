#!/usr/bin/env bash
# Copia DB_distri hacia DB_distri_test.
# No para api-vertimar-v2 y no escribe en la base de producción.
set -euo pipefail

SOURCE_DB="DB_distri"
TARGET_DB="DB_distri_test"
TEST_PM2="api-vertimar-v2-ensayo"
ENV_FILE="/opt/distri-api-v2-ensayo/.env"

if [[ "$SOURCE_DB" == "$TARGET_DB" || "$TARGET_DB" != "DB_distri_test" || "$SOURCE_DB" != "DB_distri" ]]; then
  echo "Nombres de base inválidos. No se copió nada."
  exit 1
fi

notify() {
  local msg="$1"
  printf '%s\n' "$msg"
  local url=""
  if [[ -f "$ENV_FILE" ]]; then
    url="$(grep -E '^DISCORD_WEBHOOK_DEPLOY=' "$ENV_FILE" | head -n 1 || true)"
    url="${url#DISCORD_WEBHOOK_DEPLOY=}"
    url="${url//$'\r'/}"
  fi
  if [[ -z "$url" ]]; then
    return 0
  fi
  DISCORD_WEBHOOK_DEPLOY="$url" node -e '
    const https = require("https");
    const { URL } = require("url");
    const url = process.env.DISCORD_WEBHOOK_DEPLOY;
    if (!url) process.exit(0);
    const body = JSON.stringify({ content: String(process.argv[1] || "").slice(0, 1900) });
    let u;
    try { u = new URL(url); } catch { process.exit(0); }
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 8000
    }, (res) => { res.resume(); });
    req.on("error", () => process.exit(0));
    req.on("timeout", () => { req.destroy(); process.exit(0); });
    req.end(body);
  ' "$msg" || true
}

if ! sudo mysql -Nse "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${SOURCE_DB}'" | grep -qx "$SOURCE_DB"; then
  notify "Copia test cancelada: no existe ${SOURCE_DB}. Producción no se tocó."
  exit 1
fi

CHARSET="$(sudo mysql -Nse "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${SOURCE_DB}'")"
COLLATION="$(sudo mysql -Nse "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${SOURCE_DB}'")"
if [[ -z "$CHARSET" || -z "$COLLATION" ]]; then
  notify "Copia test cancelada: no se pudo leer el charset de ${SOURCE_DB}."
  exit 1
fi

DB_USER="$(grep -E '^DB_USER=' /opt/distri-api-v2/.env | head -n 1 || true)"
DB_USER="${DB_USER#DB_USER=}"
DB_USER="${DB_USER//$'\r'/}"
DB_USER="${DB_USER%\"}"
DB_USER="${DB_USER#\"}"
if [[ ! "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]]; then
  notify "Copia test cancelada: DB_USER vacío o con caracteres raros. No se copió nada."
  exit 1
fi

STARTED_TEST=0
COPIED_OK=0
if pm2 describe "$TEST_PM2" >/dev/null 2>&1; then
  pm2 stop "$TEST_PM2"
  STARTED_TEST=1
fi

start_test() {
  if [[ "$STARTED_TEST" == "1" ]]; then
    pm2 start "$TEST_PM2" >/dev/null || true
  fi
}
on_exit() {
  local code=$?
  start_test
  if [[ "$COPIED_OK" != "1" ]]; then
    notify "Copia test falló. ${SOURCE_DB} no se modificó. Solo se detuvo y volvió a iniciar ${TEST_PM2}."
  fi
  exit "$code"
}
trap on_exit EXIT

sudo mysql -e "DROP DATABASE IF EXISTS \`${TARGET_DB}\`; CREATE DATABASE \`${TARGET_DB}\` CHARACTER SET ${CHARSET} COLLATE ${COLLATION};"
while read -r db_host; do
  [[ -z "$db_host" ]] && continue
  sudo mysql -e "GRANT ALL PRIVILEGES ON \`${TARGET_DB}\`.* TO '${DB_USER}'@'${db_host}'"
done < <(sudo mysql -Nse "SELECT host FROM mysql.user WHERE user='${DB_USER}'")
sudo mysql -e "FLUSH PRIVILEGES"

sudo mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --no-tablespaces \
  --default-character-set="$CHARSET" \
  "$SOURCE_DB" | sudo mysql "$TARGET_DB"

SOURCE_TABLES="$(sudo mysql -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${SOURCE_DB}'")"
TARGET_TABLES="$(sudo mysql -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET_DB}'")"
if [[ "$TARGET_TABLES" != "$SOURCE_TABLES" || "$TARGET_TABLES" == "0" ]]; then
  notify "Copia test incompleta: producción tiene ${SOURCE_TABLES} tablas y test ${TARGET_TABLES}. ${SOURCE_DB} no se modificó."
  exit 1
fi

COPIED_OK=1
notify "Copia test ok · ${SOURCE_DB} → ${TARGET_DB} · ${TARGET_TABLES} tablas · el proceso de producción no se reinició"
