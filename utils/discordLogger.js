// utils/discordLogger.js - Envío de logs y notificaciones a Discord (webhooks)
// No lanza errores; si Discord falla o no hay webhook configurado, se ignora.

const axios = require('axios');

const DISCORD_TIMEOUT_MS = 5000;
const MAX_CONTENT_LENGTH = 1900; // Discord límite 2000, dejar margen

// Zona horaria para mostrar en Discord (ej. Argentina). Configurable con DISCORD_TIMEZONE en .env
const DISCORD_TIMEZONE = process.env.DISCORD_TIMEZONE || 'America/Argentina/Buenos_Aires';

/**
 * Formato de fecha/hora legible en tu zona horaria (ej. "30/01/2026 17:53:43").
 */
function formatDiscordTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: DISCORD_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(d);
}

// Throttle para canal consola: buffer y flush cada N ms o cada M mensajes
const CONSOLA_FLUSH_INTERVAL_MS = 5000;
const CONSOLA_FLUSH_MAX_ITEMS = 15;
let consolaBuffer = [];
let consolaFlushTimer = null;

function getWebhook(key) {
  const url = process.env[key];
  return url && url.startsWith('https://discord.com/api/webhooks/') ? url : null;
}

/**
 * Envía un POST al webhook de Discord. No lanza; errores se silencian.
 */
async function postToWebhook(webhookKey, payload) {
  const url = getWebhook(webhookKey);
  if (!url) return;

  try {
    const body = typeof payload === 'string' ? { content: truncate(payload) } : payload;
    await axios.post(url, body, {
      timeout: DISCORD_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    // No romper la app; solo log interno (evitar recursión con logger)
    if (process.env.NODE_ENV === 'development') {
      console.error('[discordLogger] Error enviando a Discord:', err.message);
    }
  }
}

function truncate(text) {
  if (typeof text !== 'string') return String(text);
  if (text.length <= MAX_CONTENT_LENGTH) return text;
  return text.slice(0, MAX_CONTENT_LENGTH - 3) + '...';
}

function formatContext(context) {
  if (!context || typeof context !== 'object') return '';
  const parts = Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (k === 'timestamp' && (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}T/) || v instanceof Date)) {
        return `${k}: ${formatDiscordTime(v)}`;
      }
      return `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`;
    });
  return parts.length ? '\n' + parts.join('\n') : '';
}

// ---------- API pública ----------

/**
 * Resumen diario (uso del API). Un mensaje por día.
 */
async function sendResumenDiario(textOrEmbed) {
  const key = 'DISCORD_WEBHOOK_RESUMEN_DIARIO';
  if (typeof textOrEmbed === 'string') {
    await postToWebhook(key, textOrEmbed);
  } else if (textOrEmbed && textOrEmbed.title) {
    await postToWebhook(key, { embeds: [textOrEmbed] });
  }
}

/**
 * Log general de consola (todos los logs). Con throttle para no saturar.
 */
function sendConsola(level, message, context = {}) {
  const key = 'DISCORD_WEBHOOK_CONSOLA';
  if (!getWebhook(key)) return;

  const ts = formatDiscordTime();
  const ctxStr = formatContext(context);
  const line = `[${ts}] [${level.toUpperCase()}] ${message}${ctxStr}`;

  consolaBuffer.push(line);

  function flush() {
    if (consolaBuffer.length === 0) return;
    const toSend = consolaBuffer.splice(0, CONSOLA_FLUSH_MAX_ITEMS);
    const text = toSend.join('\n');
    consolaBuffer = [];
    postToWebhook(key, truncate(text));
  }

  if (consolaBuffer.length >= CONSOLA_FLUSH_MAX_ITEMS) {
    if (consolaFlushTimer) {
      clearTimeout(consolaFlushTimer);
      consolaFlushTimer = null;
    }
    flush();
    return;
  }

  if (!consolaFlushTimer) {
    consolaFlushTimer = setTimeout(() => {
      consolaFlushTimer = null;
      flush();
    }, CONSOLA_FLUSH_INTERVAL_MS);
  }
}

/**
 * Solo errores (y opcionalmente warns). Envío inmediato.
 */
async function sendErrores(message, context = {}) {
  const key = 'DISCORD_WEBHOOK_ERRORES';
  const ctxStr = formatContext(context);
  const text = `🚨 **ERROR**\n${message}${ctxStr}`;
  await postToWebhook(key, text);
}

/**
 * Ejecución de cron jobs (inicio/fin).
 */
async function sendCron(nombreCron, estado, detalle = {}) {
  const key = 'DISCORD_WEBHOOK_CRON';
  const ctxStr = formatContext(detalle);
  const text = `⏰ **CRON** ${nombreCron} — ${estado}${ctxStr}`;
  await postToWebhook(key, text);
}

/**
 * Logs de facturación ARCA / AFIP.
 */
async function sendArcaAfip(message, context = {}) {
  const key = 'DISCORD_WEBHOOK_ARCA_AFIP';
  const ctxStr = formatContext(context);
  const text = `📄 **ARCA/AFIP**\n${message}${ctxStr}`;
  await postToWebhook(key, text);
}

/**
 * Alertas de health (servidor caído o unhealthy).
 */
async function sendHealthAlerta(message) {
  const key = 'DISCORD_WEBHOOK_HEALTH';
  await postToWebhook(key, `🏥 **HEALTH**\n${message}`);
}

/**
 * Flush manual del buffer de consola (útil al cerrar proceso).
 */
function flushConsola() {
  if (consolaFlushTimer) {
    clearTimeout(consolaFlushTimer);
    consolaFlushTimer = null;
  }
  if (consolaBuffer.length > 0) {
    const text = consolaBuffer.join('\n');
    consolaBuffer = [];
    return postToWebhook('DISCORD_WEBHOOK_CONSOLA', truncate(text));
  }
  return Promise.resolve();
}

module.exports = {
  sendResumenDiario,
  sendConsola,
  sendErrores,
  sendCron,
  sendArcaAfip,
  sendHealthAlerta,
  flushConsola,
  formatDiscordTime
};
