#!/usr/bin/env bash
# Aplica migraciones M001–M018 en orden.
# NO hardcodea credenciales: las toma del entorno o de un .env local del servidor.
#
# Uso en el servidor (después del backup):
#   export MYSQL_HOST=...
#   export MYSQL_PORT=3306
#   export MYSQL_USER=...
#   export MYSQL_PASSWORD=...
#   export MYSQL_DATABASE=...
#   CONFIRM=PRODUCCION bash backend/scripts/aplicar_migraciones_produccion.sh
#
# Opcional: cargar variables desde un archivo (sin imprimirlo):
#   ENV_FILE=/ruta/segura/.env.produccion CONFIRM=PRODUCCION bash ...
#
# Dry-run (solo lista qué aplicaría):
#   DRY_RUN=1 bash backend/scripts/aplicar_migraciones_produccion.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/migrations"

if [[ -n "${ENV_FILE:-}" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: ENV_FILE no existe: $ENV_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Compat con nombres frecuentes del proyecto
MYSQL_HOST="${MYSQL_HOST:-${DB_HOST:-127.0.0.1}}"
MYSQL_PORT="${MYSQL_PORT:-${DB_PORT:-3306}}"
MYSQL_USER="${MYSQL_USER:-${DB_USER:-}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${DB_PASSWORD:-}}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${DB_NAME:-${DB_DATABASE:-}}}"

missing=0
for var in MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE; do
  if [[ -z "${!var}" ]]; then
    echo "ERROR: falta variable $var" >&2
    missing=1
  fi
done
if [[ "$missing" -eq 1 ]]; then
  echo "Definí MYSQL_HOST/PORT/USER/PASSWORD/DATABASE (o DB_*) o ENV_FILE." >&2
  exit 1
fi

if [[ "${CONFIRM:-}" != "PRODUCCION" && "${DRY_RUN:-}" != "1" ]]; then
  echo "STOP: para ejecutar en vivo exportá CONFIRM=PRODUCCION (o DRY_RUN=1 para simular)." >&2
  echo "Asegurate de tener backup completo ANTES." >&2
  exit 1
fi

MYSQL=(mysql --host="$MYSQL_HOST" --port="$MYSQL_PORT" --user="$MYSQL_USER" "--password=$MYSQL_PASSWORD" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw)

echo "Destino: host=$MYSQL_HOST port=$MYSQL_PORT db=$MYSQL_DATABASE user=$MYSQL_USER"
echo "Migraciones: $MIG_DIR"
if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "Modo DRY_RUN: no se escribe nada."
fi

# Crear tabla de control si no existe (M001)
if [[ "${DRY_RUN:-}" != "1" ]]; then
  "${MYSQL[@]}" < "$MIG_DIR/M001_schema_migrations.sql"
fi

mapfile -t FILES < <(ls -1 "$MIG_DIR"/M*.sql | sort)

aplicadas=0
omitidas=0
fallidas=0

for file in "${FILES[@]}"; do
  base="$(basename "$file")"
  version="$(echo "$base" | sed -E 's/^M([0-9]+).*/\1/' | awk '{printf "%03d",$1}')"
  # version almacenada como M001, M002...
  ver_key="$(echo "$base" | sed -E 's/^(M[0-9]+).*/\1/')"

  already="$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM schema_migrations WHERE version='${ver_key}' OR version='${version}';" 2>/dev/null || echo 0)"
  if [[ "$already" != "0" ]]; then
    echo "SKIP  $base (ya registrada)"
    omitidas=$((omitidas + 1))
    continue
  fi

  checksum="$(shasum -a 256 "$file" | awk '{print $1}')"
  echo "APPLY $base"

  if [[ "${DRY_RUN:-}" == "1" ]]; then
    aplicadas=$((aplicadas + 1))
    continue
  fi

  if ! "${MYSQL[@]}" < "$file"; then
    echo "FAIL  $base — detenido. Revisá backup/rollback." >&2
    fallidas=$((fallidas + 1))
    exit 1
  fi

  # Registrar si el propio SQL no lo hizo
  "${MYSQL[@]}" -e "
    INSERT IGNORE INTO schema_migrations (version, nombre, checksum)
    VALUES ('${ver_key}', '${base}', '${checksum}');
  " || true

  aplicadas=$((aplicadas + 1))
  echo "OK    $base"
done

echo
echo "Resumen: aplicadas/planificadas=$aplicadas omitidas=$omitidas fallidas=$fallidas"
echo "Listo."
