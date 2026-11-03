const db = require('../db/legacyAdapter');

const ZONA_ALERTAS = 'America/Argentina/Cordoba';
const ACTIVACION_DEFAULT = '2026-11-03';
const TIPOS_VALIDOS = new Set(['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO']);
const FISCALES_VALIDOS = new Set(['A', 'B']);

function norm(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

function parseCordobaDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00-03:00`).getTime();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(' ', 'T')}-03:00`).getTime();
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function inferirEstadoFiscal(row) {
  const estado = norm(row.estado_fiscal);
  if (estado) return estado;
  const tipoF = norm(row.tipo_f);
  const cae = String(row.cae_id ?? '').trim();
  const resultado = norm(row.cae_resultado);

  if (tipoF === 'X') return 'NO_APLICA';
  if (cae && ['A', 'AUTORIZADO'].includes(resultado)) return 'AUTORIZADO';
  if (['R', 'RECHAZADO'].includes(resultado)) return 'RECHAZADO';
  if (row.cae_solicitud_fecha) return 'EN_CURSO';
  if (FISCALES_VALIDOS.has(tipoF)) return 'SIN_SOLICITUD';
  return 'DESCONOCIDO';
}

function documento(row) {
  return {
    venta_id: row.id,
    numero_factura: row.numero_factura,
    fecha: row.fecha,
    fecha_fiscal: row.fecha_fiscal,
    tipo_doc: norm(row.tipo_doc || 'FACTURA'),
    tipo_f: norm(row.tipo_f),
    cliente_nombre: row.cliente_nombre,
    total: Number(row.total) || 0,
    estado_fiscal: inferirEstadoFiscal(row),
    estado_conciliacion: row.estado_conciliacion || 'NO_EVALUADO'
  };
}

function esExcepcionAtencion(row, doc, ahoraMs) {
  const estadoConciliacion = norm(row.estado_conciliacion);
  const estadoFiscal = doc.estado_fiscal;
  const fechaMs = parseCordobaDateTime(row.fecha);

  // Inmediatos (sin esperar 72h)
  if (['DISCREPANTE', 'EVIDENCIA_INCOMPLETA', 'CONFLICTO'].includes(estadoConciliacion)) {
    return estadoConciliacion === 'DISCREPANTE' ? 'DISCREPANTE'
      : estadoConciliacion === 'CONFLICTO' ? 'CONFLICTO'
      : 'EVIDENCIA_INCOMPLETA';
  }
  if (estadoFiscal === 'RECHAZADO') return 'RECHAZADO';
  if (estadoFiscal === 'DESCONOCIDO') return 'DESCONOCIDO';
  if (estadoFiscal === 'EN_CURSO') return 'EN_CURSO';
  if (!fechaMs) return 'SIN_FECHA';
  // Pendiente > 72h corridas desde creación comercial
  if (estadoFiscal === 'SIN_SOLICITUD' && ahoraMs - fechaMs > 72 * 60 * 60 * 1000) {
    return 'SIN_SOLICITUD';
  }
  return null;
}

function clasificarAlerta(row, ahoraMs, activacionMs) {
  const fechaMs = parseCordobaDateTime(row.fecha);
  const doc = documento(row);

  // 1) Primero: ¿hay excepción que requiere atención?
  const excepcion = esExcepcionAtencion(row, doc, ahoraMs);
  if (!excepcion) return null; // autorizados conciliados no alertan

  // 2) Después: separar históricos vs recientes
  const esHistorico = activacionMs != null && fechaMs != null && fechaMs < activacionMs;
  if (esHistorico) {
    return { grupo: 'historicos_previos', doc: { ...doc, excepcion } };
  }
  return { grupo: excepcion, doc };
}

async function obtenerAlertasFiscalesPendientes(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  const activacion = process.env.ALERTAS_FISCALES_ACTIVACION_FECHA || ACTIVACION_DEFAULT;
  const activacionMs = parseCordobaDateTime(activacion);
  const ahoraMs = Date.now();

  const grupos = {
    SIN_SOLICITUD: [],
    EN_CURSO: [],
    DESCONOCIDO: [],
    RECHAZADO: [],
    DISCREPANTE: [],
    EVIDENCIA_INCOMPLETA: [],
    CONFLICTO: [],
    SIN_FECHA: []
  };
  const historicosPrevios = [];

  try {
    // Sin columnas de migraciones (estado_fiscal / estado_conciliacion): se infieren desde CAE.
    const rows = await db.query(
      `SELECT
          id, numero_factura, DATE_FORMAT(fecha, '%Y-%m-%d %H:%i:%s') AS fecha,
          DATE_FORMAT(fecha_fiscal, '%Y-%m-%d') AS fecha_fiscal,
          tipo_doc, tipo_f, cliente_nombre, total,
          cae_id, cae_resultado, cae_solicitud_fecha
       FROM ventas
       WHERE UPPER(TRIM(COALESCE(tipo_f, ''))) IN ('A', 'B')
         AND UPPER(TRIM(COALESCE(tipo_doc, 'FACTURA'))) IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO')
         AND UPPER(TRIM(COALESCE(estado, 'FACTURADA'))) IN ('FACTURADA', 'FACTURADO')
       ORDER BY fecha ASC, id ASC`
    );

    for (const row of rows) {
      if (!TIPOS_VALIDOS.has(norm(row.tipo_doc || 'FACTURA'))) continue;
      const clasificada = clasificarAlerta(row, ahoraMs, activacionMs);
      if (!clasificada) continue;
      if (clasificada.grupo === 'historicos_previos') historicosPrevios.push(clasificada.doc);
      else if (grupos[clasificada.grupo]) grupos[clasificada.grupo].push(clasificada.doc);
    }

    const resumen = Object.entries(grupos).reduce((acc, [grupo, docs]) => {
      acc[grupo] = docs.length;
      return acc;
    }, {});
    resumen.historicos_previos = historicosPrevios.length;
    // Históricos pendientes también cuentan como abiertas (visibles aunque no haya recientes)
    resumen.total_abiertas = Object.values(grupos).reduce((acc, docs) => acc + docs.length, 0)
      + historicosPrevios.length;

    res.json({
      success: true,
      data: {
        zona: ZONA_ALERTAS,
        activacion_fecha: activacion,
        resumen,
        grupos,
        historicos_previos: {
          cantidad: historicosPrevios.length
        }
      }
    });
  } catch (error) {
    console.error('❌ Error obteniendo alertas fiscales pendientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo alertas fiscales pendientes'
    });
  }
}

module.exports = {
  obtenerAlertasFiscalesPendientes,
  inferirEstadoFiscal,
  parseCordobaDateTime
};
