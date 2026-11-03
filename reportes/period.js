function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail('Use fechas YYYY-MM-DD.');
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    fail('Fecha inexistente.');
  return d;
}
function shift(value, days) {
  const d = day(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function lastDayOfMonth(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm)) fail('Use meses en formato YYYY-MM.');
  const [y, m] = yyyyMm.split('-').map(Number);
  if (m < 1 || m > 12) fail('Mes inválido.');
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}
function firstDayOfMonth(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm)) fail('Use meses en formato YYYY-MM.');
  return `${yyyyMm}-01`;
}
function periodFromRange(desde, hasta) {
  const from = day(desde);
  const to = day(hasta);
  const days = (to - from) / 86400000 + 1;
  if (days < 1 || days > 2192)
    fail('El período debe tener entre 1 día y 6 años.');
  return {
    desde,
    hasta,
    fin_exclusivo: shift(hasta, 1),
    dias: days,
    anterior: {
      desde: shift(desde, -days),
      hasta: shift(desde, -1),
    },
  };
}
/** Compat: solo desde/hasta (mensual / rango libre). */
function period(query) {
  const unsupported = Object.keys(query).filter(
    (k) => !['desde', 'hasta', 'tipo', 'meses', 'anio'].includes(k)
  );
  if (unsupported.length)
    fail(
      'Este reporte admite únicamente desde, hasta, tipo, meses y anio; los desgloses se consultan dentro del mismo resultado.'
    );
  return periodFromRange(query.desde, query.hasta);
}
function periodFromMonth(yyyyMm) {
  return {
    ...periodFromRange(firstDayOfMonth(yyyyMm), lastDayOfMonth(yyyyMm)),
    mes: yyyyMm,
  };
}
/**
 * Resuelve el contrato gerencial:
 * - tipo=mensual (default): desde + hasta
 * - tipo=comparacion: meses=YYYY-MM,YYYY-MM,YYYY-MM
 * - tipo=anual: anio=YYYY
 */
function resolveReportRequest(query = {}) {
  const tipo = String(query.tipo || 'mensual')
    .trim()
    .toLowerCase();

  if (tipo === 'anual') {
    const anio = String(query.anio || '').trim();
    if (!/^\d{4}$/.test(anio)) fail('Indique un año válido (YYYY).');
    const yearNum = Number(anio);
    if (yearNum < 2000 || yearNum > 2100) fail('Año fuera de rango.');
    return {
      tipo: 'anual',
      anio,
      periodo: periodFromRange(`${anio}-01-01`, `${anio}-12-31`),
    };
  }

  if (tipo === 'comparacion') {
    const meses = String(query.meses || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (meses.length !== 3)
      fail('La comparación requiere exactamente 3 meses (YYYY-MM,YYYY-MM,YYYY-MM).');
    const unique = new Set(meses);
    if (unique.size !== 3) fail('Los tres meses de comparación deben ser distintos.');
    return {
      tipo: 'comparacion',
      periodos: meses.map(periodFromMonth),
    };
  }

  if (tipo !== 'mensual') fail('tipo debe ser mensual, comparacion o anual.');
  if (!query.desde || !query.hasta)
    fail('El reporte mensual requiere desde y hasta.');
  return {
    tipo: 'mensual',
    periodo: periodFromRange(query.desde, query.hasta),
  };
}

module.exports = {
  period,
  shift,
  resolveReportRequest,
  periodFromRange,
  periodFromMonth,
  firstDayOfMonth,
  lastDayOfMonth,
};
