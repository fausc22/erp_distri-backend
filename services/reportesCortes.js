const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { retencionDiasPorTipo } = require('../config/cortes');

function limpiarParaHash(value) {
  if (Array.isArray(value)) return value.map(limpiarParaHash);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .filter((key) => key !== 'generado_en')
    .sort()
    .reduce((acc, key) => {
      acc[key] = limpiarParaHash(value[key]);
      return acc;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(limpiarParaHash(value));
}

function calcularHashDocumentos(documentos = []) {
  return crypto.createHash('sha256').update(stableStringify(documentos)).digest('hex');
}

function asDateString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(date, days) {
  if (days == null) return null;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function guardarPdfOpcional({ id, pdfBuffer, pdfPath }) {
  if (!pdfBuffer) return pdfPath || null;

  const storageRoot = process.env.CORTES_STORAGE_PATH || path.join(__dirname, '..', 'storage', 'cortes');
  await fs.mkdir(storageRoot, { recursive: true });
  const targetPath = pdfPath || path.join(storageRoot, `${id}.pdf`);
  await fs.writeFile(targetPath, pdfBuffer);
  return targetPath;
}

function documentoSnapshot(documento) {
  const tipoDoc = String(documento.tipo_doc || documento.tipo || 'FACTURA').trim().toUpperCase();
  const signo = Number(documento.signo) || (tipoDoc === 'NOTA_CREDITO' ? -1 : 1);
  const total = Number(documento.total ?? documento.importe_total) || 0;

  return {
    venta_id: documento.venta_id ?? documento.id,
    numero_factura: documento.numero_factura ?? documento.numero ?? null,
    fecha_comercial: asDateString(documento.fecha_comercial ?? documento.fecha),
    fecha_fiscal: asDateString(documento.fecha_fiscal_acreditada ?? documento.fecha_fiscal),
    tipo_doc: tipoDoc,
    tipo_f: documento.tipo_f ?? documento.fiscal ?? null,
    estado_venta: documento.estado_venta ?? documento.estado ?? null,
    segmento: documento.segmento || 'pendiente',
    signo,
    subtotal: Number(documento.subtotal) || 0,
    iva_total: Number(documento.iva_total ?? documento.iva) || 0,
    exento: Number(documento.exento) || 0,
    total,
    total_firmado: Number(documento.total_firmado) || total * signo,
    neto_lineas: documento.neto_lineas ?? null,
    iva_lineas: documento.iva_lineas ?? null,
    diferencia_lineas: documento.diferencia_lineas ?? null,
    cliente_id: documento.cliente_id ?? null,
    cliente_nombre: documento.cliente_nombre ?? documento.cliente ?? null,
    cliente_cuit: documento.cliente_cuit ?? documento.cuit ?? null,
    cliente_condicion: documento.cliente_condicion ?? null,
    cliente_ciudad: documento.cliente_ciudad ?? documento.ciudad ?? null,
    cliente_provincia: documento.cliente_provincia ?? documento.provincia ?? null,
    vendedor_emisor_id: documento.vendedor_emisor_id ?? documento.empleado_id ?? null,
    vendedor_emisor_nombre: documento.vendedor_emisor_nombre ?? documento.empleado_nombre ?? null,
    vendedor_atribuible_id: documento.vendedor_atribuible_id ?? documento.vendedor_id ?? null,
    vendedor_nombre: documento.vendedor_nombre ?? documento.vendedor ?? null,
    vendedor_atribuible_origen: documento.vendedor_atribuible_origen ?? null,
    cuenta_id: documento.cuenta_id ?? null,
    venta_referencia_id: documento.venta_referencia_id ?? documento.referencia_id ?? null,
    cae_id: documento.cae_id ?? null,
    estado_fiscal: documento.estado_fiscal ?? null,
    estado_conciliacion: documento.estado_conciliacion ?? 'NO_EVALUADO',
    alertas_json: JSON.stringify(documento.alertas ?? [])
  };
}

async function crearCorte({
  tipo,
  desde,
  hasta,
  documentos = [],
  parametros = {},
  usuarioId = null,
  estado = 'GENERADO',
  pdfBuffer = null,
  pdfPath = null
}) {
  const id = crypto.randomUUID();
  const hashContenido = calcularHashDocumentos(documentos);
  const version = parametros.version || 'E3';
  const tipoReporte = tipo || 'GERENCIAL';
  const capturadoEn = new Date();
  const retencionDias = retencionDiasPorTipo[tipoReporte] ?? retencionDiasPorTipo[String(tipoReporte).toLowerCase()] ?? null;
  const expiraEn = addDays(asDateString(capturadoEn), retencionDias);
  const pdfGuardado = await guardarPdfOpcional({ id, pdfBuffer, pdfPath });

  const snapshots = documentos.map(documentoSnapshot);
  const resumen = {
    documentos: snapshots.length,
    total_firmado: snapshots.reduce((acc, doc) => acc + Number(doc.total_firmado || 0), 0),
    hash_contenido: hashContenido,
    pdf_path: pdfGuardado
  };
  const controles = { hash_contenido: hashContenido };

  const db = require('../db/legacyAdapter');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO reportes_cortes
        (id, tipo_reporte, version, periodo_desde, periodo_hasta, capturado_en, filtros_json,
         resumen_json, controles_json, alertas_json, generado_por_id, generado_por_nombre, estado, expira_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tipoReporte,
        version,
        desde,
        hasta,
        capturadoEn,
        JSON.stringify(parametros),
        JSON.stringify(resumen),
        JSON.stringify(controles),
        JSON.stringify(parametros.alertas || []),
        usuarioId,
        parametros.usuarioNombre || null,
        estado,
        expiraEn
      ]
    );

    for (const doc of snapshots) {
      await connection.query(
        `INSERT INTO reportes_cortes_documentos
          (corte_id, venta_id, numero_factura, fecha_comercial, fecha_fiscal, tipo_doc, tipo_f,
           estado_venta, segmento, signo, subtotal, iva_total, exento, total, total_firmado,
           neto_lineas, iva_lineas, diferencia_lineas, cliente_id, cliente_nombre, cliente_cuit,
           cliente_condicion, cliente_ciudad, cliente_provincia, vendedor_emisor_id,
           vendedor_emisor_nombre, vendedor_atribuible_id, vendedor_nombre,
           vendedor_atribuible_origen, cuenta_id, venta_referencia_id, cae_id, estado_fiscal,
           estado_conciliacion, alertas_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          doc.venta_id,
          doc.numero_factura,
          doc.fecha_comercial,
          doc.fecha_fiscal,
          doc.tipo_doc,
          doc.tipo_f,
          doc.estado_venta,
          doc.segmento,
          doc.signo,
          doc.subtotal,
          doc.iva_total,
          doc.exento,
          doc.total,
          doc.total_firmado,
          doc.neto_lineas,
          doc.iva_lineas,
          doc.diferencia_lineas,
          doc.cliente_id,
          doc.cliente_nombre,
          doc.cliente_cuit,
          doc.cliente_condicion,
          doc.cliente_ciudad,
          doc.cliente_provincia,
          doc.vendedor_emisor_id,
          doc.vendedor_emisor_nombre,
          doc.vendedor_atribuible_id,
          doc.vendedor_nombre,
          doc.vendedor_atribuible_origen,
          doc.cuenta_id,
          doc.venta_referencia_id,
          doc.cae_id,
          doc.estado_fiscal,
          doc.estado_conciliacion,
          doc.alertas_json
        ]
      );
    }

    await connection.commit();
    return {
      id,
      tipo: tipoReporte,
      desde,
      hasta,
      hash_contenido: hashContenido,
      pdf_path: pdfGuardado,
      documentos: snapshots.length,
      expira_en: expiraEn
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function obtenerCorte(corteId) {
  const db = require('../db/legacyAdapter');
  const cortes = await db.query(
    `SELECT * FROM reportes_cortes WHERE id = ? LIMIT 1`,
    [corteId]
  );
  if (!cortes.length) return null;
  const documentos = await db.query(
    `SELECT * FROM reportes_cortes_documentos WHERE corte_id = ? ORDER BY venta_id ASC`,
    [corteId]
  );
  return { ...cortes[0], documentos };
}

module.exports = {
  crearCorte,
  obtenerCorte,
  stableStringify,
  calcularHashDocumentos
};
