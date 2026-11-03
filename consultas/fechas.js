// Sin tablas de migraciones fiscales: fecha de reporte = fecha_fiscal de cabecera si existe, si no fecha comercial.
const FECHA_FISCAL_SQL = `v.fecha_fiscal`;
const FECHA_REPORTE_SQL = `CASE WHEN UPPER(TRIM(v.tipo_f)) IN ('A','B') THEN COALESCE(DATE(v.fecha_fiscal), DATE(v.fecha)) ELSE DATE(v.fecha) END`;

module.exports = { FECHA_FISCAL_SQL, FECHA_REPORTE_SQL };
