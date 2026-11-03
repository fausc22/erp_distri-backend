/**
 * Adapta líneas comerciales (pesos/cantidades decimales) al input del motor v1.
 * Escalas: precio_int = pesos × 10^6; cantidad_int = unidades × 10^3.
 */
const {
  PRECIO_ESCALA,
  CANTIDAD_ESCALA,
  centsToNumber,
  centsToString,
  serializeBigInts,
} = require('./decimal');

function alicuotaIdDesdePorcentaje(porcentaje) {
  const p = Number(porcentaje);
  if (p === 0) return 3;
  if (p === 10.5) return 4;
  if (p === 27) return 6;
  if (p === 21) return 5;
  throw new Error(`Alícuota no soportada: ${porcentaje}`);
}

function escalarDecimal(value, decimales, field) {
  const text = String(value ?? '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`${field} inválido`);
  const fraccion = (m[2] || '').padEnd(decimales + 1, '0');
  const base = BigInt(m[1]) * 10n ** BigInt(decimales) + BigInt(fraccion.slice(0, decimales) || '0');
  return base + (Number(fraccion[decimales]) >= 5 ? 1n : 0n);
}
function pesosAPrecioInt(precio, field = 'precio') { return escalarDecimal(precio, 6, field); }
function cantidadACantidadInt(cantidad, field = 'cantidad') {
  if (/\.\d{3}.*[1-9]/.test(String(cantidad))) throw new Error(`${field}: máximo 3 decimales`);
  const result = escalarDecimal(cantidad, 3, field);
  if (result <= 0n) throw new Error(`${field} debe ser positiva`);
  return result;
}
function pctAEscala(porcentaje, field = 'descuento_pct') {
  const result = escalarDecimal(porcentaje, 2, field);
  if (result >= 10000n) throw new Error(`${field} debe ser menor a 100%`);
  return result;
}
function pesosACentavos(monto, field = 'monto') { return escalarDecimal(monto, 2, field); }

/**
 * @param {object} opts
 * @param {Array} opts.productos - líneas comerciales
 * @param {object|null} opts.descuentoGlobal - { tipo: 'monto'|'porcentaje', valor }
 * @param {boolean} opts.tratamientoExento
 * @param {string} [opts.idKey]
 */
function construirInputMotor({
  productos = [],
  descuentoGlobal = null,
  tratamientoExento = false,
  idKey = null,
} = {}) {
  const lineas = productos.map((p, idx) => {
    const lineaId =
      (idKey && p[idKey] != null && String(p[idKey])) ||
      (p.linea_id != null && String(p.linea_id)) ||
      (p.id != null && p.producto_id != null
        ? `${p.id}:${idx}`
        : String(p.id || p.producto_id || idx + 1));

    const porcentajeIva =
      p.porcentaje_iva ?? p.porcentajeIva ?? p.iva_porcentaje ?? 21;

    return {
      linea_id: String(lineaId),
      precio_int: pesosAPrecioInt(p.precio ?? p.precio_unitario ?? 0, `lineas[${idx}].precio`),
      cantidad_int: cantidadACantidadInt(p.cantidad ?? 1, `lineas[${idx}].cantidad`),
      alicuota_id: alicuotaIdDesdePorcentaje(porcentajeIva),
      descuento_linea_pct: pctAEscala(
        p.descuento_porcentaje ?? p.descuento_linea_pct ?? p.descuento ?? 0,
        `lineas[${idx}].descuento`
      ),
    };
  });

  const input = {
    regla_version: 'v1',
    lineas,
    descuento_global_pct: 0n,
    descuento_global_fijo_centavos: 0n,
  };

  if (tratamientoExento) {
    input.tratamiento_exento = true;
    input.acreditado = false;
  }

  if (descuentoGlobal && Number(descuentoGlobal.valor) > 0) {
    if (descuentoGlobal.tipo === 'porcentaje' || descuentoGlobal.tipo === 'pct') {
      input.descuento_global_pct = pctAEscala(descuentoGlobal.valor, 'descuento_global_pct');
    } else {
      input.descuento_global_fijo_centavos = pesosACentavos(
        descuentoGlobal.valor,
        'descuento_global_fijo'
      );
    }
  }

  return input;
}

function resultadoAImportesPesos(resultado) {
  if (!resultado || !resultado.ok) return null;
  return {
    subtotal: centsToNumber(resultado.totales.neto),
    iva_total: centsToNumber(resultado.totales.iva),
    total: centsToNumber(resultado.totales.total),
    subtotal_str: centsToString(resultado.totales.neto),
    iva_total_str: centsToString(resultado.totales.iva),
    total_str: centsToString(resultado.totales.total),
    regla_version: resultado.regla_version || 'v1',
    lineas: serializeBigInts(resultado.lineas || []),
    alicuotas: serializeBigInts(resultado.totales.por_alicuota || []),
  };
}

module.exports = {
  alicuotaIdDesdePorcentaje,
  pesosAPrecioInt,
  cantidadACantidadInt,
  pctAEscala,
  pesosACentavos,
  construirInputMotor,
  resultadoAImportesPesos,
};
