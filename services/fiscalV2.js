const { centavos } = require('../dominio/calculo/documento');
/**
 * Adaptación fiscal v2: reserva persistente de serie + canonicalización de evidencia.
 * Activada solo con FISCAL_V2=true. No reclasifica operaciones legacy.
 */
const crypto = require('crypto');
const {
  buildSerieClave,
  reservarSerie,
  liberarSerie,
  marcarDesconocido
} = require('./arcaSeriesCoordinator');

const isFiscalV2Enabled = () =>
  String(process.env.FISCAL_V2 || '').toLowerCase() === 'true';

// Misma fuente de configuración que afip.config.js: no etiquetar producción como homologación.
const entornoActual = () => String(process.env.AFIP_PRODUCTION).toLowerCase() === 'true'
  ? 'produccion' : 'homologacion';
const emisorCuit = () => String(process.env.AFIP_CUIT || '').replace(/\D/g, '');

async function reservarNumeroYPersistirIntento(connection, {
  ventaId,
  cbteTipo,
  ptoVta,
  requestData,
  ultimoAutorizado
}) {
  const cuit = emisorCuit();
  if (!cuit) {
    const err = new Error('AFIP_CUIT no configurado para reserva fiscal v2');
    err.code = 'CONFIG_FALTANTE';
    throw err;
  }
  const serieClave = buildSerieClave({
    cuit,
    entorno: entornoActual(),
    cbteTipo,
    ptoVta
  });
  const cbteNroReservado = Number(ultimoAutorizado) + 1;

  const [insertResult] = await connection.query(
    `INSERT INTO arca_solicitudes_log
      (venta_id, request_data, estado, cbte_nro_reservado, serie_clave)
     VALUES (?, ?, 'EN_PROCESO', ?, ?)`,
    [ventaId, JSON.stringify(requestData), cbteNroReservado, serieClave]
  );
  const intentoId = insertResult.insertId;
  await reservarSerie(connection, { serieClave, intentoId });
  return { serieClave, intentoId, cbteNroReservado };
}

async function registrarRespuestaTardia(db, {
  intentoId,
  responseData,
  estado = 'EXITOSO',
  mensajeError = null
}) {
  if (!intentoId) return;
  await db.execute(
    `UPDATE arca_solicitudes_log
     SET response_data = ?, estado = ?, mensaje_error = COALESCE(?, mensaje_error),
         tiempo_respuesta = COALESCE(tiempo_respuesta, ?)
     WHERE id = ? AND estado IN ('EN_PROCESO','DESCONOCIDO')`,
    [
      JSON.stringify(responseData),
      estado,
      mensajeError,
      null,
      intentoId
    ]
  );
}

async function insertarAutorizacionCanonica(connection, payload) {
  const {
    ventaId,
    intentoId,
    cbteTipo,
    ptoVta,
    cbteNro,
    cae,
    caeVto,
    cbteFch,
    impTotal,
    impNeto,
    impIva,
    ivaAlicuotas,
    calidad = 'RESPUESTA_DIRECTA'
  } = payload;

  try {
    // Compat M004+M016: rellena columnas legacy (cae_vencimiento/fecha_emision) y nuevas.
    const fechaEmision = cbteFch && String(cbteFch).length === 8
      ? `${String(cbteFch).slice(0, 4)}-${String(cbteFch).slice(4, 6)}-${String(cbteFch).slice(6, 8)}`
      : null;
    const [result] = await connection.query(
      `INSERT INTO arca_autorizaciones_canonicas
        (emisor_cuit, entorno, cbte_tipo, pto_vta, cbte_nro, venta_id, intento_id,
         cae, cae_vencimiento, cae_vto, fecha_emision, cbte_fch,
         imp_total, imp_neto, imp_iva, iva_alicuotas, calidad)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        emisorCuit(),
        entornoActual(),
        cbteTipo,
        ptoVta,
        cbteNro,
        ventaId,
        intentoId,
        cae,
        caeVto || null,
        caeVto || null,
        fechaEmision,
        cbteFch || null,
        impTotal,
        impNeto,
        impIva,
        JSON.stringify(ivaAlicuotas || []),
        calidad
      ]
    );
    return { id: result.insertId, conflicto: false };
  } catch (error) {
    if (error.errno !== 1062 && error.code !== 'ER_DUP_ENTRY') throw error;
    await connection.query(
      `INSERT INTO arca_conflictos
        (venta_id, intento_id, emisor_cuit, entorno, cbte_tipo, pto_vta, cbte_nro,
         evidencia_json, motivo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CAE_DUPLICADO_O_IDENTIDAD')`,
      [
        ventaId,
        intentoId,
        emisorCuit(),
        entornoActual(),
        cbteTipo,
        ptoVta,
        cbteNro,
        JSON.stringify(payload)
      ]
    );
    return { id: null, conflicto: true };
  }
}

function fechaSQL(value) {
  if (value == null) return null;
  const text = String(value).replace(/-/g, '');
  if (!/^\d{8}$/.test(text)) throw new Error('Fecha fiscal inválida');
  return `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`;
}

// El caller posee la transacción: autorización, venta, log y serie se confirman juntos.
async function persistirAutorizacionNormal(connection, { venta, ventaId, intentoId, respuesta, solicitud, serieClave }) {
  const datos = respuesta.datosARCA;
  const cae = respuesta.autorizacion?.cae;
  if (!datos || !cae || respuesta.autorizacion?.resultado !== 'A') throw new Error('Autorización fiscal incompleta');
  for (const field of ['CbteTipo','PtoVta','CbteDesde','CbteFch','DocTipo','DocNro','ImpNeto','ImpIVA','ImpTotal']) {
    if (datos[field] == null) throw new Error(`Autorización sin ${field}`);
  }
  if (Number(datos.CbteTipo) !== Number(solicitud.tipoComprobante) || Number(datos.PtoVta) !== Number(solicitud.puntoVenta) ||
      Number(datos.DocTipo) !== Number(solicitud.cliente.tipoDocumento) || Number(datos.DocNro) !== Number(solicitud.cliente.numeroDocumento) ||
      (solicitud.numeroComprobante != null && Number(datos.CbteDesde) !== Number(solicitud.numeroComprobante))) {
    throw new Error('Identidad fiscal diferente de la solicitud');
  }
  const coincide = centavos(venta.total) === centavos(datos.ImpTotal) &&
    centavos(venta.subtotal) === centavos(datos.ImpNeto) && centavos(venta.iva_total) === centavos(datos.ImpIVA) &&
    String(datos.CbteFch) === String(solicitud.fecha);
  const conciliacion = coincide ? 'CONCILIADO' : 'DISCREPANTE';
  const auth = await insertarAutorizacionCanonica(connection, {
    ventaId, intentoId, cbteTipo: datos.CbteTipo, ptoVta: datos.PtoVta, cbteNro: datos.CbteDesde,
    cae, caeVto: fechaSQL(respuesta.autorizacion.fechaVencimiento), cbteFch: String(datos.CbteFch),
    impTotal: datos.ImpTotal, impNeto: datos.ImpNeto, impIva: datos.ImpIVA,
    ivaAlicuotas: datos.Iva || [], calidad: 'RESPUESTA_DIRECTA'
  });
  if (auth.conflicto) throw new Error('Conflicto de identidad fiscal: recuperar antes de reintentar');
  const pv = String(datos.PtoVta).padStart(4, '0');
  const numero = venta.tipo_doc === 'FACTURA' || !venta.tipo_doc
    ? `${venta.tipo_f} ${pv}-${String(datos.CbteDesde).padStart(8, '0')}`
    : `${pv}-${String(datos.CbteDesde).padStart(5, '0')}`;
  await connection.query(
    `UPDATE ventas SET cae_id=?, cae_fecha=?, cae_resultado='A', cae_solicitud_fecha=NOW(),
      fecha_fiscal=?, importe_afip=?, estado_fiscal='AUTORIZADO', estado_conciliacion=?,
      autorizacion_id=?, numero_factura=? WHERE id=?`,
    [cae, fechaSQL(respuesta.autorizacion.fechaVencimiento), fechaSQL(datos.CbteFch), datos.ImpTotal,
     conciliacion, auth.id, numero, ventaId]);
  await connection.query(
    `UPDATE arca_autorizaciones_canonicas SET resultado_json=?, evidencia_json=? WHERE id=?`,
    [JSON.stringify(respuesta), JSON.stringify({ solicitud, datosAutorizados: datos }), auth.id]);
  await connection.query(`UPDATE arca_solicitudes_log SET estado='EXITOSO', response_data=? WHERE id=?`,
    [JSON.stringify({ success: true, data: respuesta }), intentoId]);
  if (serieClave) {
    const liberacion = await liberarSerie(connection, { serieClave, estadoFinal: 'LIBRE', intentoId });
    if (!liberacion.liberado) throw new Error('La serie fiscal ya no pertenece al intento');
  }
  return { autorizacionId: auth.id, conciliacion };
}

function hashEvidencia({ cbteTipo, ptoVta, cbteNro, cae, impTotal, emisor, entorno }) {
  const raw = [
    emisor || emisorCuit(),
    entorno || entornoActual(),
    cbteTipo,
    ptoVta,
    cbteNro,
    cae,
    impTotal
  ].map((v) => String(v ?? '')).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  persistirAutorizacionNormal,
  isFiscalV2Enabled,
  entornoActual,
  emisorCuit,
  reservarNumeroYPersistirIntento,
  registrarRespuestaTardia,
  insertarAutorizacionCanonica,
  hashEvidencia,
  liberarSerie,
  marcarDesconocido,
  buildSerieClave
};
