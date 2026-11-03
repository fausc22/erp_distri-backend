#!/usr/bin/env bash
# Levanta MySQL aislado si el socket no responde. Sin red. Sin .env.
set -euo pipefail
DATADIR=/tmp/erp-reportes-mysql/data
SOCK=/tmp/erp-reportes-mysql/mysql.sock
PIDFILE=/tmp/erp-reportes-mysql/mysqld.pid
MYSQLD=/opt/homebrew/opt/mysql@8.0/bin/mysqld
MYSQL=/opt/homebrew/opt/mysql@8.0/bin/mysql

if [ -S "$SOCK" ] && "$MYSQL" --socket="$SOCK" -uroot -e "SELECT 1" >/dev/null 2>&1; then
  exit 0
fi

rm -f "$PIDFILE" "$SOCK" "${SOCK}.lock"
nohup "$MYSQLD" \
  --basedir=/opt/homebrew/opt/mysql@8.0 \
  --datadir="$DATADIR" \
  --socket="$SOCK" \
  --pid-file="$PIDFILE" \
  --port=0 \
  --skip-networking \
  --mysqlx=OFF \
  --log-error=/tmp/erp-reportes-mysql/mysql.log \
  >/tmp/erp-reportes-mysql/nohup.out 2>&1 &

for i in $(seq 1 30); do
  if [ -S "$SOCK" ] && "$MYSQL" --socket="$SOCK" -uroot -e "SELECT 1" >/dev/null 2>&1; then
    echo "isolated mysql ready"
    exit 0
  fi
  sleep 1
done
echo "failed to start isolated mysql" >&2
tail -40 /tmp/erp-reportes-mysql/mysql.log >&2 || true
exit 1
