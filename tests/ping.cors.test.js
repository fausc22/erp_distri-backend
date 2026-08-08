/**
 * Verifica CORS del endpoint /ping usado por RECONECTAR APP.
 * No debe exigir headers custom; GET simple + Accept debe funcionar.
 *
 * Ejecutar: node tests/ping.cors.test.js
 * Variables opcionales:
 *   PING_URL=https://api-v2.vertimar.online/ping
 *   ORIGIN=https://www.vertimar.online
 */

const assert = require('assert');

const PING_URL = process.env.PING_URL || 'https://api-v2.vertimar.online/ping';
const ORIGIN = process.env.ORIGIN || 'https://www.vertimar.online';

async function run() {
  // Preflight con headers problemáticos (los que rompían ConnectionContext)
  const preflightBad = await fetch(PING_URL, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'cache-control,expires,pragma',
    },
  });

  const allowHeaders =
    preflightBad.headers.get('access-control-allow-headers') || '';
  console.log('Preflight allow-headers:', allowHeaders);

  // Documentar: esos headers NO están permitidos (correcto: el cliente no debe enviarlos)
  const allowsCacheControl = /cache-control/i.test(allowHeaders);
  assert.strictEqual(
    allowsCacheControl,
    false,
    'Cache-Control no debe estar en allowedHeaders; el cliente debe usar fetch simple'
  );

  // Preflight simple (solo Accept implícito / GET)
  const preflightOk = await fetch(PING_URL, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.ok(
    preflightOk.status >= 200 && preflightOk.status < 400,
    `OPTIONS /ping falló: ${preflightOk.status}`
  );
  assert.strictEqual(
    preflightOk.headers.get('access-control-allow-origin'),
    ORIGIN
  );

  // GET real estilo connectivity.js
  const ping = await fetch(`${PING_URL}?_t=${Date.now()}`, {
    method: 'GET',
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json',
    },
  });
  assert.strictEqual(ping.status, 200, `GET /ping status=${ping.status}`);
  assert.strictEqual(ping.headers.get('access-control-allow-origin'), ORIGIN);
  const body = await ping.json();
  assert.strictEqual(body.status, 'ok');

  console.log('✅ ping.cors.test.js: CORS /ping OK para', ORIGIN, '→', PING_URL);
}

run().catch((err) => {
  console.error('❌ ping.cors.test.js falló:', err);
  process.exit(1);
});
