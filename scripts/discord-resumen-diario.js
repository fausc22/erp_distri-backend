#!/usr/bin/env node
/**
 * Script de resumen diario para Discord.
 * Obtiene métricas del API (endpoint /metrics) y envía un resumen al canal de Discord.
 * Uso: node scripts/discord-resumen-diario.js
 * Cron ejemplo (todos los días a las 08:00): 0 8 * * * cd /ruta/backend && node scripts/discord-resumen-diario.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const discordLogger = require('../utils/discordLogger');

const PORT = process.env.PORT || 3001;
const METRICS_TOKEN = process.env.METRICS_TOKEN;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function fetchMetrics() {
  const url = `${BASE_URL}/metrics`;
  const config = {};
  if (METRICS_TOKEN) {
    config.headers = { Authorization: `Bearer ${METRICS_TOKEN}` };
  }
  const { data } = await axios.get(url, { ...config, timeout: 5000 });
  return data;
}

const DISCORD_TZ = process.env.DISCORD_TIMEZONE || 'America/Argentina/Buenos_Aires';

function formatResumen(metrics) {
  const fecha = new Date().toLocaleDateString('es-AR', {
    timeZone: DISCORD_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const req = metrics.requests || {};
  const total = req.total || 0;
  const ok = (req.byStatus && req.byStatus['2xx']) || 0;
  const err4 = (req.byStatus && req.byStatus['4xx']) || 0;
  const err5 = (req.byStatus && req.byStatus['5xx']) || 0;
  const successRate = req.successRate || '0%';

  const uptime = (metrics.uptime && metrics.uptime.formatted) || 'N/A';
  const rt = metrics.responseTimes && metrics.responseTimes.overall;
  const avgMs = rt && rt.avg ? `${rt.avg}ms` : 'N/A';

  const cache = metrics.cache || {};
  const cacheHitRate = cache.hitRate || '0%';
  const cacheKeys = (cache.hits || 0) + (cache.misses || 0);

  const errs = metrics.errors || {};
  const totalErrors = errs.total || 0;
  const recentCount = errs.recentCount || 0;

  const lines = [
    `📊 **Resumen diario API ERP Distri**`,
    `_${fecha}_`,
    ``,
    `**Requests**`,
    `• Total: ${total}`,
    `• 2xx: ${ok} | 4xx: ${err4} | 5xx: ${err5}`,
    `• Tasa éxito: ${successRate}`,
    ``,
    `**Servidor**`,
    `• Uptime: ${uptime}`,
    `• Tiempo respuesta (avg): ${avgMs}`,
    ``,
    `**Caché**`,
    `• Hit rate: ${cacheHitRate} (${cacheKeys} accesos)`,
    ``,
    `**Errores**`,
    `• Total registrados: ${totalErrors}`,
    `• Recientes (buffer): ${recentCount}`
  ];

  return lines.join('\n');
}

async function main() {
  try {
    const metrics = await fetchMetrics();
    const text = formatResumen(metrics);
    await discordLogger.sendResumenDiario(text);
    console.log('Resumen diario enviado a Discord.');
  } catch (err) {
    const msg = err.response
      ? `Servidor respondió ${err.response.status}`
      : err.code === 'ECONNREFUSED'
        ? 'Servidor no disponible (¿está corriendo el backend?)'
        : err.message;
    const fallback = `⚠️ **Resumen diario**\nNo se pudo obtener métricas: ${msg}\n_${discordLogger.formatDiscordTime(new Date())}_`;
    try {
      await discordLogger.sendResumenDiario(fallback);
    } catch (_) {
      console.error('No se pudo enviar a Discord:', fallback);
    }
    process.exitCode = 1;
  }
}

main();
