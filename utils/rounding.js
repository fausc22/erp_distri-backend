/**
 * Utilidad de redondeo para importes de facturación (pedidos, ventas).
 * Regla acordada: redondeo estándar (>= 0.50 sube, < 0.50 baja).
 * Se aplica en: alta de pedido, venta directa, facturación pedido → venta.
 * No modifica datos históricos; solo se usa en flujos nuevos a partir de esta implementación.
 */

/**
 * Redondea un número con criterio estándar.
 * - Parte decimal < 0.50 → baja al entero inferior.
 * - Parte decimal >= 0.50 → sube al siguiente entero.
 *
 * @param {number} value - Valor a redondear (puede ser string numérico).
 * @returns {number} Entero redondeado según la regla.
 *
 * @example
 * roundFacturacion(10.49)  // 10
 * roundFacturacion(10.50)  // 11
 * roundFacturacion(10.99)  // 11
 * roundFacturacion(10.00)  // 10
 */
function roundFacturacion(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * Redondea varios importes de una facturación (subtotal, iva, exento, total)
 * con la misma regla, para mantener coherencia.
 *
 * @param {object} importes - Objeto con propiedades numéricas a redondear.
 * @param {string[]} keys - Nombres de las propiedades (ej: ['subtotal', 'iva_total', 'exento', 'total']).
 * @returns {object} Nuevo objeto con los mismos keys y valores redondeados.
 */
function redondearImportes(importes, keys) {
  const out = {};
  for (const key of keys) {
    if (key in importes) {
      out[key] = roundFacturacion(importes[key]);
    }
  }
  return out;
}

/**
 * Resuelve una alícuota de IVA. 0% es un valor válido: no usar `|| 21`.
 * @param {unknown} value
 * @param {number} [fallback=21]
 * @returns {number}
 */
function resolvePorcentajeIva(value, fallback = 21) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Lee la alícuota de un producto de catálogo o de una línea.
 * Prefiere `porcentaje_iva` (tasa de la línea) y, si no está, `iva` (tasa de catálogo).
 */
function obtenerPorcentajeIva(producto, fallback = 21) {
  return resolvePorcentajeIva(producto?.porcentaje_iva ?? producto?.iva, fallback);
}

const ALICUOTAS_CANONICAS = [0, 10.5, 21, 27];

/**
 * Infiere % IVA desde importe de línea (histórico sin columna porcentaje_iva).
 * Redondea a la alícuota canónica más cercana (0 / 10.5 / 21 / 27).
 */
function inferPorcentajeIvaDesdeLinea(ivaMonto, subtotal, fallback = 21) {
  const iva = Number(ivaMonto);
  const neto = Number(subtotal);
  if (!Number.isFinite(iva) || !Number.isFinite(neto) || neto <= 0) {
    return resolvePorcentajeIva(fallback);
  }
  if (Math.abs(iva) < 0.005) return 0;
  const pct = (iva / neto) * 100;
  let best = ALICUOTAS_CANONICAS[0];
  let bestDiff = Math.abs(pct - best);
  for (const a of ALICUOTAS_CANONICAS) {
    const d = Math.abs(pct - a);
    if (d < bestDiff) {
      best = a;
      bestDiff = d;
    }
  }
  return best;
}

/**
 * Resuelve % de una línea de pedido/venta: columna persistida, payload, o ratio IVA/subtotal.
 */
function resolvePorcentajeIvaLinea(linea, fallback = 21) {
  if (
    linea?.porcentaje_iva !== undefined &&
    linea?.porcentaje_iva !== null &&
    linea?.porcentaje_iva !== ''
  ) {
    return resolvePorcentajeIva(linea.porcentaje_iva, fallback);
  }
  const ivaMonto = linea?.iva ?? linea?.IVA ?? linea?.iva_calculado;
  const subtotal = linea?.subtotal;
  if (ivaMonto !== undefined && subtotal !== undefined) {
    return inferPorcentajeIvaDesdeLinea(ivaMonto, subtotal, fallback);
  }
  return resolvePorcentajeIva(linea?.iva, fallback);
}

/** Mapeo AFIP/ARCA: Id de alícuota según porcentaje. */
function mapAlicuotaArca(porcentajeIva) {
  const pct = resolvePorcentajeIva(porcentajeIva, 21);
  if (pct === 0) return 3;
  if (pct === 10.5) return 4;
  if (pct === 27) return 6;
  return 5; // 21%
}

module.exports = {
  roundFacturacion,
  redondearImportes,
  resolvePorcentajeIva,
  obtenerPorcentajeIva,
  inferPorcentajeIvaDesdeLinea,
  resolvePorcentajeIvaLinea,
  mapAlicuotaArca,
};
