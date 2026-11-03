/**
 * Caracterización + autoridad del motor v1.
 * Verifica: legacy no cambia; sombra no altera; v1 gobierna importes; exento bloqueado en v1.
 */
const assert = require('assert');

async function run() {
  const prev = process.env.MOTOR_CALCULO_VERSION;

  const {
    pesosAPrecioInt,
    cantidadACantidadInt,
    construirInputMotor,
    resultadoAImportesPesos,
  } = require('../dominio/calculo/adaptadorComercial');
  const { calcular } = require('../dominio/calculo/motor');

  // Escalas: $100 × 1 ud = 10000 centavos = $100.00 neto; +21% = $121.00
  assert.strictEqual(pesosAPrecioInt(100), 100000000n);
  assert.strictEqual(cantidadACantidadInt(1), 1000n);

  const inputBase = construirInputMotor({
    productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
  });
  const rBase = calcular(inputBase);
  assert.strictEqual(rBase.ok, true);
  const impBase = resultadoAImportesPesos(rBase);
  assert.strictEqual(impBase.subtotal, 1000);
  assert.strictEqual(impBase.iva_total, 210);
  assert.strictEqual(impBase.total, 1210);

  // Descuento global 10% sobre neto → neto 900, IVA 189, total 1089
  const inputPct = construirInputMotor({
    productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
    descuentoGlobal: { tipo: 'porcentaje', valor: 10 },
  });
  const rPct = calcular(inputPct);
  assert.strictEqual(rPct.ok, true);
  const impPct = resultadoAImportesPesos(rPct);
  assert.strictEqual(impPct.subtotal, 900);
  assert.strictEqual(impPct.iva_total, 189);
  assert.strictEqual(impPct.total, 1089);

  // Descuento fijo final $121 → total 1089
  const inputFijo = construirInputMotor({
    productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
    descuentoGlobal: { tipo: 'monto', valor: 121 },
  });
  const rFijo = calcular(inputFijo);
  assert.strictEqual(rFijo.ok, true);
  const impFijo = resultadoAImportesPesos(rFijo);
  assert.strictEqual(impFijo.total, 1089);

  // Modos
  delete require.cache[require.resolve('../dominio/calculo/sombra')];
  process.env.MOTOR_CALCULO_VERSION = 'legacy';
  let sombra = require('../dominio/calculo/sombra');
  let res = sombra.resolverImportes({
    productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
  });
  assert.strictEqual(res.mode, 'legacy');
  assert.strictEqual(res.usarMotor, false);

  delete require.cache[require.resolve('../dominio/calculo/sombra')];
  process.env.MOTOR_CALCULO_VERSION = 'sombra';
  sombra = require('../dominio/calculo/sombra');
  res = sombra.resolverImportes({
    productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
    legacyImportes: { subtotal: 1000, iva_total: 210, total: 1210 },
  });
  assert.strictEqual(res.mode, 'sombra');
  assert.strictEqual(res.usarMotor, false);
  assert.ok(res.importes);
  assert.strictEqual(res.importes.total, 1210);

  delete require.cache[require.resolve('../dominio/calculo/sombra')];
  process.env.MOTOR_CALCULO_VERSION = 'v1';
  sombra = require('../dominio/calculo/sombra');
  res = sombra.resolverImportes({
    productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
  });
  assert.strictEqual(res.mode, 'v1');
  assert.strictEqual(res.usarMotor, true);
  assert.strictEqual(res.importes.total, 1210);

  let threw = false;
  try {
    sombra.resolverImportes({
      productos: [{ linea_id: '1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
      tratamientoExento: true,
    });
  } catch (e) {
    threw = e.code === 'HABILITACION_NO_DISPONIBLE';
  }
  assert.ok(threw, 'v1 debe abortar tratamiento EXENTO no validado');

  // Servicios conectan resolverImportes (no solo sombra post-facto)
  const ventasSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../services/ventasService.js'),
    'utf8'
  );
  assert.ok(ventasSrc.includes('resolverImportes'));
  assert.ok(ventasSrc.includes('usarMotor'));
  const notasSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../services/notasService.js'),
    'utf8'
  );
  assert.ok(notasSrc.includes('resolverImportes'));

  if (prev === undefined) delete process.env.MOTOR_CALCULO_VERSION;
  else process.env.MOTOR_CALCULO_VERSION = prev;

  console.log('✅ motor.autoridad.v1.test.js OK');
}

run().catch((e) => {
  console.error('❌ motor.autoridad.v1.test.js FAIL', e);
  process.exit(1);
});
