#!/usr/bin/env bash
# Aplica migraciones QR/ARCA en orden (producción o local).
# Uso:
#   ./apply_qr_fix_produccion.sh
#   DB_PASSWORD=xxx DB_DATABASE=erp ./apply_qr_fix_produccion.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(DB_HOST|DB_USER|DB_PASSWORD|DB_DATABASE|DB_PORT)=' "$ENV_FILE" | sed 's/^/export /')
  set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_DATABASE="${DB_DATABASE:-erp_distri}"
DB_PORT="$(echo "${DB_PORT:-3306}" | tr -d ' ')"

MYSQL_OPTS=(-h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_DATABASE")
if [[ -n "$DB_PASSWORD" ]]; then
  export MYSQL_PWD="$DB_PASSWORD"
fi

echo "==> 1/2 add_importe_afip.sql (columna + backfill inicial)"
mysql "${MYSQL_OPTS[@]}" < "$SCRIPT_DIR/add_importe_afip.sql"

echo "==> 2/2 fix_qr_datos_historicos.sql (A flotantes + fecha/importe NULL)"
mysql "${MYSQL_OPTS[@]}" < "$SCRIPT_DIR/fix_qr_datos_historicos.sql"

echo "OK: migraciones QR aplicadas en $DB_DATABASE"
