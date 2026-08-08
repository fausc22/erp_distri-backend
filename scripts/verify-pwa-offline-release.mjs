#!/usr/bin/env node
/**
 * Checklist / smoke de release PWA offline.
 * No despliega: valida endpoints públicos y documenta pasos manuales.
 *
 * Uso:
 *   node scripts/verify-pwa-offline-release.mjs
 *   API_URL=https://api-v2.vertimar.online FRONTEND_URL=https://www.vertimar.online node scripts/verify-pwa-offline-release.mjs
 */

const API_URL = (process.env.API_URL || 'https://api-v2.vertimar.online').replace(/\/+$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://www.vertimar.online').replace(/\/+$/, '');
const ORIGIN = FRONTEND_URL;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (err) {
    console.error(`❌ ${name}:`, err.message || err);
    return false;
  }
}

async function main() {
  console.log('=== Verificación PWA offline release ===');
  console.log('API:', API_URL);
  console.log('Frontend:', FRONTEND_URL);
  console.log('');

  const results = [];

  results.push(
    await check('GET /ping responde 200', async () => {
      const res = await fetch(`${API_URL}/ping?_t=${Date.now()}`, {
        headers: { Origin: ORIGIN, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(JSON.stringify(json));
    })
  );

  results.push(
    await check('CORS Origin permitido en /ping', async () => {
      const res = await fetch(`${API_URL}/ping?_t=${Date.now()}`, {
        headers: { Origin: ORIGIN, Accept: 'application/json' },
      });
      const allow = res.headers.get('access-control-allow-origin');
      if (allow !== ORIGIN) throw new Error(`ACA-Origin=${allow}`);
    })
  );

  results.push(
    await check('Preflight NO autoriza Cache-Control (cliente no debe enviarlo)', async () => {
      const res = await fetch(`${API_URL}/ping`, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'cache-control,pragma,expires',
        },
      });
      const allow = res.headers.get('access-control-allow-headers') || '';
      if (/cache-control/i.test(allow)) {
        throw new Error('Cache-Control está permitido — revisar allowedHeaders');
      }
    })
  );

  results.push(
    await check('Frontend responde (www)', async () => {
      const res = await fetch(FRONTEND_URL, { redirect: 'follow' });
      if (!res.ok) throw new Error(`status ${res.status}`);
    })
  );

  results.push(
    await check('Service Worker sw.js accesible', async () => {
      const res = await fetch(`${FRONTEND_URL}/sw.js`, { redirect: 'follow' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const text = await res.text();
      if (!text.includes('workbox') && !text.includes('precache')) {
        throw new Error('sw.js no parece Workbox');
      }
    })
  );

  const failed = results.filter((ok) => !ok).length;
  console.log('');
  console.log('--- Checklist manual (beta → prod) ---');
  console.log('1. Desplegar backend + frontend a BETA');
  console.log('2. En PWA instalada: online → precarga → airplane mode');
  console.log('3. Crear 1 y N pedidos offline; cerrar/reabrir app');
  console.log('4. Recuperar red → RECONECTAR APP → sync → 1 pedido servidor c/u');
  console.log('5. Token vencido offline → reconectar renueva sesión');
  console.log('6. Cortar red a mitad de sync → cola conserva restantes');
  console.log('7. Actualizar SW con pedidos pendientes → NO auto-reload destructivo');
  console.log('8. Rollback: NO limpiar localStorage de usuarios');
  console.log('');

  if (failed > 0) {
    console.error(`Resultado: ${failed} checks fallaron`);
    process.exit(1);
  }
  console.log('Resultado: smoke OK — proceder con checklist manual en dispositivos');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
