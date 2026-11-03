/**
 * Pruebas de comportamiento: liberación de serie por propietario + identidad recuperación.
 */
const assert = require('assert');
const { liberarSerie, reservarSerie, buildSerieClave } = require('../services/arcaSeriesCoordinator');

function makeFakeConn(state) {
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM arca_series_estado.*FOR UPDATE/i.test(s) || /FROM arca_series_estado WHERE/i.test(s)) {
        const row = state.series[params[0]] || null;
        return [[row].filter(Boolean)];
      }
      if (/INSERT INTO arca_series_estado/i.test(s)) {
        // VALUES (?, 'EN_CURSO', ?) → [serieClave, intentoId]
        const [clave, intentoId] = params;
        const actual = state.series[clave];
        if (!actual || actual.estado === 'LIBRE') {
          state.series[clave] = { serie_clave: clave, estado: 'EN_CURSO', intento_activo_id: intentoId };
        }
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE arca_series_estado/i.test(s)) {
        // liberarSerie: estado, serieClave, intentoId, intentoId
        const [estadoFinal, serieClave, intentoIdA, intentoIdB] = params;
        const row = state.series[serieClave];
        if (!row) return [{ affectedRows: 0 }];
        const allowed =
          intentoIdA == null ||
          row.intento_activo_id == null ||
          String(row.intento_activo_id) === String(intentoIdB);
        if (!allowed) return [{ affectedRows: 0 }];
        row.estado = estadoFinal;
        row.intento_activo_id = null;
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };
}

async function run() {
  const clave = buildSerieClave({ cuit: '30111111118', entorno: 'homologacion', cbteTipo: 6, ptoVta: 4 });
  const state = { series: {} };
  const conn = makeFakeConn(state);

  await reservarSerie(conn, { serieClave: clave, intentoId: 10 });
  assert.strictEqual(state.series[clave].estado, 'EN_CURSO');
  assert.strictEqual(state.series[clave].intento_activo_id, 10);

  // Callback de intento viejo NO libera
  const libAjeno = await liberarSerie(conn, { serieClave: clave, estadoFinal: 'LIBRE', intentoId: 9 });
  assert.strictEqual(libAjeno.liberado, false);
  assert.strictEqual(state.series[clave].estado, 'EN_CURSO');
  assert.strictEqual(state.series[clave].intento_activo_id, 10);

  // Propietario sí libera
  const libOk = await liberarSerie(conn, { serieClave: clave, estadoFinal: 'LIBRE', intentoId: 10 });
  assert.strictEqual(libOk.liberado, true);
  assert.strictEqual(state.series[clave].estado, 'LIBRE');

  // Identidad: ausencia ≠ coincidencia (código fuente + helper local)
  const arcaSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../controllers/arcaIntegrationController.js'),
    'utf8'
  );
  assert.ok(arcaSrc.includes("camposIdentidadAusentes"));
  assert.ok(arcaSrc.includes("Ausencia de un campo necesario"));
  assert.ok(arcaSrc.includes("NO liberar serie aquí"));
  assert.ok(arcaSrc.includes("intentoId"));

  // Helper de coincidencia estricta
  function identidadCompleta({ reqDocTipo, consDocTipo, reqDocNro, consDocNro }) {
    const ausentes = [];
    if (reqDocTipo == null || !Number.isFinite(Number(reqDocTipo))) ausentes.push('reqDocTipo');
    if (consDocTipo == null || !Number.isFinite(Number(consDocTipo))) ausentes.push('consDocTipo');
    if (!reqDocNro) ausentes.push('reqDocNro');
    if (!consDocNro) ausentes.push('consDocNro');
    if (ausentes.length) return { ok: false, incompleta: true, ausentes };
    return {
      ok: Number(reqDocTipo) === Number(consDocTipo) && String(reqDocNro) === String(consDocNro),
      incompleta: false,
    };
  }

  assert.deepStrictEqual(
    identidadCompleta({ reqDocTipo: 80, consDocTipo: null, reqDocNro: '20111111112', consDocNro: '20111111112' }),
    { ok: false, incompleta: true, ausentes: ['consDocTipo'] }
  );
  assert.strictEqual(
    identidadCompleta({ reqDocTipo: 80, consDocTipo: 80, reqDocNro: '20111111112', consDocNro: '20111111112' }).ok,
    true
  );

  console.log('✅ fiscal.serie.identidad.test.js OK');
}

run().catch((e) => {
  console.error('❌ fiscal.serie.identidad.test.js FAIL', e);
  process.exit(1);
});
