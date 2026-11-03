const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const vm = require('vm');

const { lineaNeta } = require('../dominio/calculo/decimal');
const { calcular } = require('../dominio/calculo/motor');
const vectores = require('../dominio/calculo/vectores_dorados.json');

function loadFrontendCalculo() {
  const filePath = path.join(__dirname, '../../frontend/utils/calculo/v1.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const transformed = code.replace(/export\s*\{([\s\S]*?)\};?\s*$/m, 'module.exports = {$1};');
  const mod = { exports: {} };
  const requireFn = Module.createRequire(filePath);
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) { ${transformed}\n})`,
    { filename: filePath }
  );
  wrapper(mod.exports, requireFn, mod, filePath, path.dirname(filePath));
  return mod.exports;
}

const frontend = loadFrontendCalculo();

function sum(items, key) {
  return items.reduce((acc, item) => acc + BigInt(item[key]), 0n);
}

function assertOk(result) {
  assert.strictEqual(result.ok, true, result.code || 'resultado no ok');
}

function assertInvariantes(result) {
  assertOk(result);
  assert.strictEqual(sum(result.lineas, 'neto'), result.totales.neto);
  assert.strictEqual(sum(result.lineas, 'iva'), result.totales.iva);
  assert.strictEqual(sum(result.lineas, 'total'), result.totales.total);
  assert.strictEqual(result.totales.neto + result.totales.iva, result.totales.total);
  assert.strictEqual(sum(result.totales.por_alicuota, 'neto'), result.totales.neto);
  assert.strictEqual(sum(result.totales.por_alicuota, 'iva'), result.totales.iva);
}

function assertTotales(result, expected) {
  assert.strictEqual(result.totales.neto, BigInt(expected.neto));
  assert.strictEqual(result.totales.iva, BigInt(expected.iva));
  assert.strictEqual(result.totales.total, BigInt(expected.total));
}

async function run() {
  assert.strictEqual(lineaNeta(2500000n, 3000n), 750n);
  assert.strictEqual(lineaNeta(1333333n, 1500n), 200n);

  const multiAlicuota = calcular({
    regla_version: 'v1',
    descuento_global_pct: 500n,
    lineas: [
      { linea_id: '1', precio_int: 100000000n, cantidad_int: 1000n, alicuota_id: 5 },
      {
        linea_id: '2',
        precio_int: 50000000n,
        cantidad_int: 2000n,
        alicuota_id: 4,
        descuento_linea_pct: 1000n,
      },
    ],
  });
  assertInvariantes(multiAlicuota);
  assertTotales(multiAlicuota, { neto: '18050', iva: '2893', total: '20943' });
  assert.strictEqual(multiAlicuota.lineas[0].descuento_global_pct, 500n);
  assert.strictEqual(multiAlicuota.lineas[1].descuento_global_pct, 450n);

  const fijoResiduo = calcular({
    regla_version: 'v1',
    descuento_global_fijo_centavos: 1n,
    lineas: [
      { linea_id: '1', precio_int: 1000000n, cantidad_int: 1000n, alicuota_id: 3 },
      { linea_id: '2', precio_int: 1000000n, cantidad_int: 1000n, alicuota_id: 3 },
      { linea_id: '3', precio_int: 1000000n, cantidad_int: 1000n, alicuota_id: 3 },
    ],
  });
  assertInvariantes(fijoResiduo);
  assert.strictEqual(fijoResiduo.lineas[0].descuento_global_fijo_final, 1n);
  assert.strictEqual(fijoResiduo.lineas[0].neto, 99n);
  assert.strictEqual(fijoResiduo.totales.total, 299n);

  const invalido = calcular({
    regla_version: 'v1',
    descuento_global_pct: 10001n,
    lineas: [{ linea_id: '1', precio_int: 1000000n, cantidad_int: 1000n, alicuota_id: 5 }],
  });
  assert.strictEqual(invalido.ok, false);
  assert.strictEqual(invalido.code, 'DESCUENTO_INVALIDO');

  const totalNegativo = calcular({
    regla_version: 'v1',
    descuento_global_fijo_centavos: 122n,
    lineas: [{ linea_id: '1', precio_int: 1000000n, cantidad_int: 1000n, alicuota_id: 5 }],
  });
  assert.strictEqual(totalNegativo.ok, false);
  assert.strictEqual(totalNegativo.code, 'TOTAL_NEGATIVO');

  const exentoNoAcreditado = calcular({
    regla_version: 'v1',
    tratamiento_exento: true,
    acreditado: false,
    lineas: [{ linea_id: '1', precio_int: 1000000n, cantidad_int: 1000n, alicuota_id: 3 }],
  });
  assert.strictEqual(exentoNoAcreditado.ok, false);
  assert.strictEqual(exentoNoAcreditado.code, 'HABILITACION_NO_DISPONIBLE');

  for (const vector of vectores) {
    const backendResult = calcular(vector.input);
    assert.strictEqual(
      backendResult.ok,
      vector.expected.ok,
      `${vector.nombre} (${path.basename(__filename)})`
    );
    if (vector.expected.ok) {
      assertInvariantes(backendResult);
      assertTotales(backendResult, vector.expected);

      const frontendResult = frontend.calcular(vector.input);
      assert.strictEqual(frontendResult.ok, true, `${vector.nombre} frontend`);
      assert.strictEqual(frontendResult.totales.neto, backendResult.totales.neto);
      assert.strictEqual(frontendResult.totales.iva, backendResult.totales.iva);
      assert.strictEqual(frontendResult.totales.total, backendResult.totales.total);
    } else {
      assert.strictEqual(backendResult.code, vector.expected.code, vector.nombre);
      if (vector.expected.diferencia_no_representable !== undefined) {
        assert.strictEqual(
          backendResult.diferencia_no_representable,
          BigInt(vector.expected.diferencia_no_representable)
        );
      }
    }
  }

  console.log('✅ dominio.calculo.v1.test.js OK');
}

run().catch((error) => {
  console.error('❌ dominio.calculo.v1.test.js FAIL', error);
  process.exit(1);
});
