#!/usr/bin/env bash
# Actualiza una carpeta ya clonada y reinicia un solo proceso PM2.
# Si /ping no vuelve, deja el commit anterior y reinicia de nuevo.
# Combinaciones permitidas: ensayo (3003) y produccion (3002).
set -euo pipefail

APP_DIR="${APP_DIR:?Falta APP_DIR}"
PM2_NAME="${PM2_NAME:?Falta PM2_NAME}"
PORT="${PORT:?Falta PORT}"
BRANCH="${DEPLOY_BRANCH:-refactor/backend-v2}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
ACTOR="${DEPLOY_ACTOR:-manual}"

APP_DIR="$(realpath "$APP_DIR")"
cd "$APP_DIR"

if [[ -z "${PUPPETEER_CACHE_DIR:-}" ]]; then
  export PUPPETEER_CACHE_DIR="${HOME}/.cache/puppeteer"
fi

PREV=""
LOCK_CHANGED=0

notify() {
  local msg="$1"
  printf '%s\n' "$msg"
  if [[ -z "${DISCORD_WEBHOOK_DEPLOY:-}" && -f .env ]]; then
    local line
    line="$(grep -E '^DISCORD_WEBHOOK_DEPLOY=' .env | head -n 1 || true)"
    line="${line#DISCORD_WEBHOOK_DEPLOY=}"
    line="${line//$'\r'/}"
    DISCORD_WEBHOOK_DEPLOY="$line"
  fi
  if [[ -z "${DISCORD_WEBHOOK_DEPLOY:-}" ]]; then
    return 0
  fi
  node -e '
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
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 8000
    }, (res) => { res.resume(); });
    req.on("error", () => process.exit(0));
    req.on("timeout", () => { req.destroy(); process.exit(0); });
    req.end(body);
  ' "$msg" || true
}

fail() {
  notify "$1"
  exit 1
}

wait_ping() {
  local i
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS -m 3 "http://127.0.0.1:${PORT}/ping" >/dev/null; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

restore_deps_if_needed() {
  if [[ "$LOCK_CHANGED" == "1" ]]; then
    npm ci --no-audit --no-fund
  fi
}

case "${APP_DIR}:${PM2_NAME}:${PORT}" in
  /opt/distri-api-v2:api-vertimar-v2:3002) ;;
  /opt/distri-api-v2-ensayo:api-vertimar-v2-ensayo:3003) ;;
  *)
    fail "Deploy cancelado: combinación no permitida (${APP_DIR}, ${PM2_NAME}, ${PORT}). No se reinició nada."
    ;;
esac

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  fail "Deploy cancelado: ${APP_DIR} está en ${CURRENT_BRANCH} y se esperaba ${BRANCH}. No se reinició ${PM2_NAME}."
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "Deploy cancelado: ${APP_DIR} tiene cambios locales sin commit. No se hizo pull ni restart de ${PM2_NAME}."
fi

if ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  fail "Deploy cancelado: no existe el proceso PM2 ${PM2_NAME}. No se tocó la otra API."
fi

PREV="$(git rev-parse HEAD)"
PREV_LOCK=""
if [[ -f package-lock.json ]]; then
  PREV_LOCK="$(sha256sum package-lock.json | awk '{print $1}')"
fi

notify "Deploy empezó · ${PM2_NAME} · ${BRANCH} · ${PREV:0:7} · ${ACTOR}"

if ! git fetch origin "$BRANCH"; then
  fail "Deploy cancelado: git fetch falló en ${PM2_NAME}. Sigue ${PREV:0:7}. No se reinició."
fi

if ! git pull --ff-only origin "$BRANCH"; then
  fail "Deploy cancelado: git pull no pudo avanzar en línea recta en ${PM2_NAME}. Sigue ${PREV:0:7}. No se reinició."
fi

NEW="$(git rev-parse HEAD)"

set +e
MIG_OUT="$(node migraciones.js 2>&1)"
MIG_STATUS=$?
set -e
printf '%s\n' "$MIG_OUT"

if [[ "$MIG_STATUS" -ne 0 ]]; then
  git reset --hard "$PREV"
  fail "Deploy cancelado: no se pudieron leer las migraciones. ${PM2_NAME} no se reinició. Código vuelto a ${PREV:0:7}."
fi

if printf '%s\n' "$MIG_OUT" | grep -q '^WOULD '; then
  git reset --hard "$PREV"
  fail "Deploy detenido: hay migraciones pendientes. ${PM2_NAME} no se reinició y el código volvió a ${PREV:0:7}. Aplicarlas es un paso aparte, con backup."
fi

NEW_LOCK=""
if [[ -f package-lock.json ]]; then
  NEW_LOCK="$(sha256sum package-lock.json | awk '{print $1}')"
fi
if [[ "$NEW_LOCK" != "$PREV_LOCK" ]]; then
  LOCK_CHANGED=1
  if ! npm ci --no-audit --no-fund; then
    git reset --hard "$PREV"
    npm ci --no-audit --no-fund || true
    fail "Deploy cancelado: npm ci falló. Dependencias vueltas a ${PREV:0:7}. ${PM2_NAME} no se reinició."
  fi
  if ! node -e 'const fs=require("fs"); const p=require("puppeteer").executablePath(); if(!fs.existsSync(p)){ console.error(p); process.exit(1);} console.log(p);'; then
    git reset --hard "$PREV"
    npm ci --no-audit --no-fund || true
    fail "Deploy cancelado: Puppeteer quedó sin Chrome. Dependencias vueltas a ${PREV:0:7}. ${PM2_NAME} no se reinició."
  fi
fi

if ! pm2 restart "$PM2_NAME"; then
  git reset --hard "$PREV"
  restore_deps_if_needed || true
  pm2 restart "$PM2_NAME" || true
  fail "Deploy falló: pm2 restart de ${PM2_NAME} no arrancó. Se intentó volver a ${PREV:0:7}."
fi

if ! wait_ping; then
  git reset --hard "$PREV"
  restore_deps_if_needed || true
  pm2 restart "$PM2_NAME" || true
  if wait_ping; then
    fail "Rollback hecho · ${PM2_NAME} · /ping no respondió en el puerto ${PORT} · vuelve ${PREV:0:7} y el ping de ese commit sí respondió."
  fi
  fail "ATENCION · ${PM2_NAME} · /ping sigue sin responder después del rollback a ${PREV:0:7}. Revisar pm2 logs ${PM2_NAME}."
fi

HEALTH_NOTE=""
if ! curl -fsS -m 8 "http://127.0.0.1:${PORT}/health" >/dev/null; then
  HEALTH_NOTE=" · /health no respondió (el proceso sigue en ${NEW:0:7}; no se hizo rollback)"
fi

notify "Deploy ok · ${PM2_NAME} · ${BRANCH} · ${NEW:0:7} · ${ACTOR} · ping :${PORT}${HEALTH_NOTE}"
