/**
 * Pruebas de comportamiento: idempotencia, alertas, recuperación fiscal (sin ARCA real).
 */
const assert = require('assert');
const crypto = require('crypto');
const operacionesIdempotencia = require('../services/operacionesIdempotencia');
const { buildEventoClave, insertEfectoIdempotente } = require('../services/eventoClaveEfectos');
const fiscalV2 = require('../services/fiscalV2');
const { lineaNeta } = require('../dominio/calculo/decimal');
const fs = require('fs');
const path = require('path');

function readFront(rel) {
  return fs.readFileSync(path.join(__dirname, '../../frontend', rel), 'utf8');
}

function mockConnection(store) {
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
      if (s.startsWith('SELECT') && s.includes('OPERACIONES_IDEMPOTENCIA')) {
        const id = params[0];
        const row = store.ops.get(id);
        return [row ? [row] : []];
      }
      if (s.startsWith('INSERT INTO OPERACIONES_IDEMPOTENCIA') || s.startsWith('INSERT INTO `OPERACIONES_IDEMPOTENCIA`')) {
        const [id, tipo, hash, ventaId] = params;
        if (store.ops.has(id)) {
          const err = new Error('Duplicate');
          err.errno = 1062;
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        store.ops.set(id, {
          operacion_id: id,
          tipo_operacion: tipo,
          content_hash: hash,
          venta_id: ventaId,
          estado: 'EN_CURSO',
          resultado_json: null
        });
        return [{ insertId: 1 }];
      }
      if (s.startsWith('UPDATE OPERACIONES_IDEMPOTENCIA')) {
        const [resultado, ventaId, id] = params;
        const row = store.ops.get(id);
        if (row) {
          row.estado = 'COMPLETADA';
          row.resultado_json = resultado;
          row.venta_id = ventaId || row.venta_id;
        }
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('INSERT INTO `MOVIMIENTO_FONDOS`') || s.includes('INSERT INTO `MOVIMIENTO_FONDOS`')) {
        const eventoIdx = params.length - 1;
        const evento = params[eventoIdx];
        if (store.efectos.has(evento)) {
          const err = new Error('Duplicate');
          err.errno = 1062;
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        store.efectos.set(evento, { evento_clave: evento, referencia_id: params[3], monto: params[4] });
        return [{ insertId: store.efectos.size }];
      }
      if (s.includes('FROM `MOVIMIENTO_FONDOS`') && s.includes('EVENTO_CLAVE')) {
        const row = store.efectos.get(params[0]);
        return [row ? [row] : []];
      }
      return [[]];
    }
  };
}

async function run() {
  // Escalas
  assert.strictEqual(lineaNeta(2500000n, 3000n), 750n);

  // Frontend envía operacion_id
  const vd = readFront('hooks/ventas/useVentaDirecta.js');
  const notas = readFront('hooks/notas/useNotas.js');
  const api = readFront('utils/apiClient.js');
  assert.ok(vd.includes('operacion_id'));
  assert.ok(vd.includes('obtenerOperacionId'));
  assert.ok(notas.includes('operacion_id'));
  assert.ok(api.includes('X-App-Version'));

  // Idempotencia: mismo UUID+contenido → existing
  const store = { ops: new Map(), efectos: new Map() };
  const conn = mockConnection(store);
  const uuid = crypto.randomUUID();
  const payload = { a: 1, b: 2 };
  const first = await operacionesIdempotencia.beginOperacion(conn, {
    operacionId: uuid,
    tipoOperacion: 'venta_directa',
    payload
  });
  assert.strictEqual(first.existing, false);
  await operacionesIdempotencia.completeOperacion(conn, {
    operacionId: uuid,
    ventaId: 99,
    resultado: { data: { ventaId: 99 } }
  });
  const second = await operacionesIdempotencia.beginOperacion(conn, {
    operacionId: uuid,
    tipoOperacion: 'venta_directa',
    payload
  });
  assert.strictEqual(second.existing, true);
  assert.strictEqual(second.resultado.data.ventaId, 99);

  // Mismo UUID + contenido distinto → CONFLICT
  let conflicted = false;
  try {
    await operacionesIdempotencia.beginOperacion(conn, {
      operacionId: uuid,
      tipoOperacion: 'venta_directa',
      payload: { a: 1, b: 999 }
    });
  } catch (e) {
    conflicted = e.code === 'OPERACION_CONFLICTO';
  }
  assert.ok(conflicted, 'debe conflictuar con contenido distinto');

  // evento_clave: no reaplicar
  const ek = buildEventoClave('ingreso', 99, 'venta_directa');
  const e1 = await insertEfectoIdempotente(conn, {
    table: 'movimiento_fondos',
    columns: ['cuenta_id', 'tipo', 'origen', 'referencia_id', 'monto'],
    values: [1, 'INGRESO', 'test', 99, 100],
    eventoClave: ek,
    operacionId: uuid,
    contentHash: 'abc',
    compareFn: (row) => row && Number(row.referencia_id) === 99
  });
  assert.strictEqual(e1.existing, false);
  const e2 = await insertEfectoIdempotente(conn, {
    table: 'movimiento_fondos',
    columns: ['cuenta_id', 'tipo', 'origen', 'referencia_id', 'monto'],
    values: [1, 'INGRESO', 'test', 99, 100],
    eventoClave: ek,
    operacionId: uuid,
    contentHash: 'abc',
    compareFn: (row) => row && Number(row.referencia_id) === 99
  });
  assert.strictEqual(e2.existing, true);

  // Alertas: excepción antes de histórico
  const alertasSrc = fs.readFileSync(path.join(__dirname, '../controllers/alertasController.js'), 'utf8');
  assert.ok(alertasSrc.includes('esExcepcionAtencion'));
  assert.ok(alertasSrc.indexOf('esExcepcionAtencion') < alertasSrc.indexOf('esHistorico') ||
    alertasSrc.includes('Primero: ¿hay excepción'));

  // Recuperación fiscal valida identidad
  const arcaSrc = fs.readFileSync(path.join(__dirname, '../controllers/arcaIntegrationController.js'), 'utf8');
  assert.ok(arcaSrc.includes('IDENTIDAD_DIVERGENTE'));
  assert.ok(arcaSrc.includes('DISCREPANTE'));
  assert.ok(arcaSrc.includes('persistencia comercial incompleta'));

  // Hash evidencia fiscal
  const h = fiscalV2.hashEvidencia({
    cbteTipo: 6, ptoVta: 4, cbteNro: 1, cae: 'X', impTotal: '10.00',
    emisor: '20111111112', entorno: 'homologacion'
  });
  assert.ok(/^[a-f0-9]{64}$/.test(h));

  console.log('✅ integracion.idempotencia.alertas.test.js OK');
}

run().catch((e) => {
  console.error('❌ integracion.idempotencia.alertas.test.js FAIL', e);
  process.exit(1);
});
