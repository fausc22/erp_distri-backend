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
function period(query) {
  const unsupported = Object.keys(query).filter(
    (k) => !['desde', 'hasta'].includes(k)
  );
  if (unsupported.length)
    fail(
      'Este reporte admite únicamente desde y hasta; los desgloses se consultan dentro del mismo resultado.'
    );
  const from = day(query.desde);
  const to = day(query.hasta);
  const days = (to - from) / 86400000 + 1;
  if (days < 1 || days > 2192)
    fail('El período debe tener entre 1 día y 6 años.');
  return {
    desde: query.desde,
    hasta: query.hasta,
    fin_exclusivo: shift(query.hasta, 1),
    dias: days,
    anterior: {
      desde: shift(query.desde, -days),
      hasta: shift(query.desde, -1),
    },
  };
}
module.exports = { period, shift };
