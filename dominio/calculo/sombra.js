/**
 * Integración del motor monetario.
 * MOTOR_CALCULO_VERSION=legacy|sombra|v1
 *
 * legacy: no calcula; el caller usa lógica previa.
 * sombra: calcula y persiste comparación sin alterar importes operativos.
 * v1: el resultado validado es autoridad; fallo aborta (no warning).
 */
const crypto = require('crypto');
const { calcular } = require('./motor');
const { serializeBigInts } = require('./decimal');
const {
  construirInputMotor,
  resultadoAImportesPesos,
} = require('./adaptadorComercial');

function motorMode() {
  return String(process.env.MOTOR_CALCULO_VERSION || 'legacy').toLowerCase();
}

class MotorCalculoError extends Error {
  constructor(code, message, detalle = {}) {
    super(message);
    this.name = 'MotorCalculoError';
    this.code = code;
    this.detalle = detalle;
    this.statusCode = 422;
  }
}

function newCalculoId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

async function persistirCalculo(connection, ventaId, resultado, input = null, mode = motorMode()) {
  if (!resultado) return null;
  const serializado = serializeBigInts(resultado);
  const inputSerializado = serializeBigInts(input || { regla_version: serializado.regla_version || 'v1' });
  const inputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(inputSerializado))
    .digest('hex');
  const totales = serializado.totales || {};
  await connection.query(
    `INSERT INTO venta_calculos
      (id, venta_id, regla_version, input_hash, input_json, resultado_json, ok, error_code,
       neto_centavos, iva_centavos, total_centavos, aplicacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newCalculoId(),
      ventaId,
      serializado.regla_version || 'v1',
      inputHash,
      JSON.stringify(inputSerializado),
      JSON.stringify(serializado),
      resultado.ok ? 1 : 0,
      resultado.ok ? null : (resultado.code || 'CALCULO_INVALIDO'),
      totales.neto != null ? String(totales.neto) : null,
      totales.iva != null ? String(totales.iva) : null,
      totales.total != null ? String(totales.total) : null,
      mode === 'v1' ? 'AUTORITATIVO' : 'SOMBRA',
    ]
  );
  return true;
}

/**
 * Calcula con input ya adaptado (precio_int / cantidad_int).
 */
function calcularMotor(input) {
  return calcular({ ...input, regla_version: 'v1' });
}

/**
 * Resuelve importes operativos según modo.
 * @param {object} opts
 * @param {Array} opts.productos
 * @param {object|null} opts.descuentoGlobal
 * @param {boolean} opts.tratamientoExento
 * @param {object|null} opts.legacyImportes - { subtotal, iva_total, total } para comparación sombra
 * @returns {{ mode, usarMotor, importes?, resultado?, diferencia? }}
 */
function resolverImportes({
  productos,
  descuentoGlobal = null,
  tratamientoExento = false,
  legacyImportes = null,
} = {}) {
  const mode = motorMode();
  if (mode === 'legacy') {
    return { mode, usarMotor: false };
  }

  if (tratamientoExento) {
    if (mode === 'v1') {
      throw new MotorCalculoError(
        'HABILITACION_NO_DISPONIBLE',
        'Tratamiento EXENTO no habilitado en motor v1; mantenga MOTOR_CALCULO_VERSION=legacy/sombra hasta validación normativa'
      );
    }
    // sombra: no intenta recalcular exentos
    return { mode, usarMotor: false, skipped: 'tratamiento_exento' };
  }

  let input;
  try {
    input = construirInputMotor({ productos, descuentoGlobal, tratamientoExento: false });
  } catch (error) {
    if (mode === 'v1') throw new MotorCalculoError('CALCULO_INVALIDO', error.message);
    return { mode, usarMotor: false, error: error.message };
  }
  const resultado = calcularMotor(input);

  if (!resultado.ok) {
    if (mode === 'v1') {
      throw new MotorCalculoError(
        resultado.code || 'CALCULO_INVALIDO',
        `Motor v1 rechazó el cálculo: ${resultado.code || 'error'}`,
        resultado
      );
    }
    console.warn(`⚠️ Motor sombra cálculo no ok: ${resultado.code}`, resultado);
    return { mode, usarMotor: false, resultado };
  }

  const importes = resultadoAImportesPesos(resultado);
  let diferencia = null;
  if (legacyImportes && mode === 'sombra') {
    const dSub = Math.abs(Number(legacyImportes.subtotal) - importes.subtotal);
    const dIva = Math.abs(Number(legacyImportes.iva_total) - importes.iva_total);
    const dTot = Math.abs(Number(legacyImportes.total) - importes.total);
    if (dSub > 0.005 || dIva > 0.005 || dTot > 0.005) {
      diferencia = {
        legacy: legacyImportes,
        motor: importes,
        delta: { subtotal: dSub, iva: dIva, total: dTot },
      };
      console.warn('⚠️ Motor sombra diverge de legacy:', JSON.stringify(diferencia.delta));
    }
  }

  return {
    mode,
    usarMotor: mode === 'v1',
    importes,
    resultado,
    diferencia,
    input,
    lineasOrdenadas: input.lineas.map(l => resultado.lineas.find(r => r.linea_id === l.linea_id)),
  };
}

/**
 * Persiste cálculo tras tener ventaId. En v1, fallo de persistencia también aborta.
 */
async function persistirResultadoMotor(connection, ventaId, resultado, mode = motorMode(), input = null) {
  if (!resultado) return null;
  try {
    await persistirCalculo(connection, ventaId, resultado, input, mode);
    return true;
  } catch (error) {
    if (mode === 'v1') {
      throw new MotorCalculoError(
        'PERSISTENCIA_CALCULO',
        `No se pudo persistir venta_calculos: ${error.message}`
      );
    }
    console.warn(`⚠️ Motor sombra persistencia falló venta ${ventaId}:`, error.message);
    return false;
  }
}

/**
 * Compat: ejecuta sombra/v1 post-venta. En v1 NO debe usarse como autoridad
 * (usar resolverImportes antes de persistir cabecera). Aquí solo persiste.
 */
async function ejecutarSombra(connection, ventaId, inputOrOpts) {
  const mode = motorMode();
  if (mode !== 'sombra' && mode !== 'v1') return { mode: 'legacy', skipped: true };

  // Si ya viene resultado de resolverImportes
  if (inputOrOpts && inputOrOpts.resultado) {
    await persistirResultadoMotor(connection, ventaId, inputOrOpts.resultado, mode, inputOrOpts.input);
    return { mode, resultado: inputOrOpts.resultado };
  }

  // Compat input crudo: si trae precio_int úsalo; si trae precio comercial, adaptar
  try {
    let input = inputOrOpts;
    if (input && Array.isArray(input.lineas) && input.lineas[0] && input.lineas[0].precio_unitario != null) {
      input = construirInputMotor({
        productos: input.lineas.map((l) => ({
          linea_id: l.linea_id,
          precio: l.precio_unitario,
          cantidad: l.cantidad,
          porcentaje_iva:
            l.alicuota_id === 4 ? 10.5 : l.alicuota_id === 6 ? 27 : l.alicuota_id === 3 ? 0 : 21,
          descuento_porcentaje: Number(l.descuento_linea_pct || 0) / 100,
        })),
        descuentoGlobal: input.descuento_global
          ? {
              tipo: input.descuento_global.tipo === 'monto' ? 'monto' : 'porcentaje',
              valor:
                input.descuento_global.tipo === 'monto'
                  ? Number(input.descuento_global.valor) / 100
                  : Number(input.descuento_global.valor),
            }
          : null,
      });
    }
    const resultado = calcularMotor(input || {});
    if (mode === 'v1' && !resultado.ok) {
      throw new MotorCalculoError(
        resultado.code || 'CALCULO_INVALIDO',
        `Motor v1 falló: ${resultado.code}`
      );
    }
    if (connection && ventaId && resultado.ok) {
      await persistirResultadoMotor(connection, ventaId, resultado, mode);
    }
    return { mode, resultado };
  } catch (error) {
    if (error instanceof MotorCalculoError) throw error;
    if (mode === 'v1') {
      throw new MotorCalculoError('CALCULO_INVALIDO', error.message);
    }
    console.warn(`⚠️ Motor sombra falló para venta ${ventaId}:`, error.message);
    return { mode, error: error.message };
  }
}

module.exports = {
  motorMode,
  MotorCalculoError,
  persistirCalculo,
  persistirResultadoMotor,
  calcularMotor,
  resolverImportes,
  ejecutarSombra,
  calcular,
};
