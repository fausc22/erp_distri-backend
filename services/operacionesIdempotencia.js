const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertOperacionId(operacionId) {
  const id = String(operacionId || '').trim();
  if (!UUID_RE.test(id)) {
    const err = new Error('operacion_id UUID es requerido');
    err.code = 'OPERACION_ID_REQUERIDO';
    err.statusCode = 422;
    throw err;
  }
  return id;
}

function contentHash(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Reserva o recupera una operación idempotente.
 * - misma clave + mismo hash → existing
 * - misma clave + hash distinto → CONFLICT
 */
async function beginOperacion(connection, {
  operacionId,
  tipoOperacion,
  payload,
  ventaId = null
}) {
  const id = assertOperacionId(operacionId);
  const hash = contentHash(payload);

  // INSERT adquiere el bloqueo único antes de leer, sin carreras por gap locks.
  try {
    await connection.query(
      `INSERT INTO operaciones_idempotencia
        (operacion_id, tipo_operacion, content_hash, venta_id, estado)
       VALUES (?, ?, ?, ?, 'EN_CURSO')`, [id, tipoOperacion, hash, ventaId]);
    return { existing: false, operacionId: id, contentHash: hash, resumed: false };
  } catch (error) {
    if (error.errno !== 1062 && error.code !== 'ER_DUP_ENTRY') throw error;
  }

  const [existing] = await connection.query(
    `SELECT operacion_id, tipo_operacion, content_hash, resultado_json, venta_id, estado
     FROM operaciones_idempotencia
     WHERE operacion_id = ?
     LIMIT 1
     FOR SHARE`,
    [id]
  );

  if (existing.length) {
    const row = existing[0];
    if (row.content_hash !== hash) {
      const err = new Error('La misma operacion_id se reutilizó con contenido distinto');
      err.code = 'OPERACION_CONFLICTO';
      err.statusCode = 409;
      err.evidence = { operacionId: id, existingHash: row.content_hash, newHash: hash };
      throw err;
    }
    if (row.estado === 'COMPLETADA' && row.resultado_json) {
      const resultado = typeof row.resultado_json === 'string'
        ? JSON.parse(row.resultado_json)
        : row.resultado_json;
      return { existing: true, operacionId: id, contentHash: hash, resultado, row };
    }
    const err = new Error('La operación sigue en curso; no repetir efectos');
    err.statusCode = 409; err.code = 'OPERACION_EN_CURSO'; throw err;
  }

  throw new Error('No se encontró la operación después del conflicto de clave');
}

async function completeOperacion(connection, { operacionId, resultado, ventaId = null }) {
  await connection.query(
    `UPDATE operaciones_idempotencia
     SET estado = 'COMPLETADA',
         resultado_json = ?,
         venta_id = COALESCE(?, venta_id),
         actualizado_en = CURRENT_TIMESTAMP
     WHERE operacion_id = ?`,
    [JSON.stringify(resultado), ventaId, operacionId]
  );
}

async function failOperacion(connection, { operacionId, code = 'CONFLICTO' }) {
  await connection.query(
    `UPDATE operaciones_idempotencia
     SET estado = ?, actualizado_en = CURRENT_TIMESTAMP
     WHERE operacion_id = ?`,
    [code === 'CONFLICTO' ? 'CONFLICTO' : 'EN_CURSO', operacionId]
  );
}

module.exports = {
  UUID_RE,
  assertOperacionId,
  contentHash,
  beginOperacion,
  completeOperacion,
  failOperacion
};
