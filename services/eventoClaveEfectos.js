function buildEventoClave(tipo, ventaId, sufijo) {
  const tipoNormalizado = String(tipo ?? '').trim();
  const ventaIdNormalizado = String(ventaId ?? '').trim();
  const sufijoNormalizado = String(sufijo ?? '').trim();

  if (!tipoNormalizado || !ventaIdNormalizado) {
    throw new Error('tipo y ventaId son requeridos para evento_clave');
  }

  return [tipoNormalizado, ventaIdNormalizado, sufijoNormalizado].filter(Boolean).join(':');
}

function assertIdentifier(identifier, label) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`${label} inválido: ${identifier}`);
  }
  return identifier;
}

function isDuplicateKeyError(error) {
  return error?.errno === 1062 || error?.code === 'ER_DUP_ENTRY';
}

async function insertEfectoIdempotente(connection, {
  table,
  columns,
  values,
  eventoClave,
  operacionId,
  contentHash,
  selectExistingSql,
  selectExistingParams,
  compareFn
}) {
  if (!connection || typeof connection.query !== 'function') {
    throw new Error('insertEfectoIdempotente requiere una conexión transaccional');
  }
  if (!Array.isArray(columns) || !Array.isArray(values) || columns.length !== values.length) {
    throw new Error('columns y values deben ser arrays del mismo tamaño');
  }

  const tableName = assertIdentifier(table, 'table');
  const insertColumns = [...columns];
  const insertValues = [...values];

  if (eventoClave && !insertColumns.includes('evento_clave')) {
    insertColumns.push('evento_clave');
    insertValues.push(eventoClave);
  }

  const columnSql = insertColumns.map((column) => `\`${assertIdentifier(column, 'column')}\``).join(', ');
  const placeholders = insertColumns.map(() => '?').join(', ');

  try {
    const [result] = await connection.query(
      `INSERT INTO \`${tableName}\` (${columnSql}) VALUES (${placeholders})`,
      insertValues
    );
    return { existing: false, result, insertId: result?.insertId ?? null };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const sql = selectExistingSql || `SELECT * FROM \`${tableName}\` WHERE evento_clave = ? LIMIT 1`;
    const params = selectExistingParams || [eventoClave];
    const [rows] = await connection.query(sql, params);
    const row = rows?.[0] || null;
    const sameOperation = typeof compareFn === 'function'
      ? Boolean(compareFn(row, {
          table: tableName,
          columns: insertColumns,
          values: insertValues,
          eventoClave,
          operacionId,
          contentHash
        }))
      : false;

    if (row && sameOperation) {
      return { existing: true, row };
    }

    const conflict = new Error('Conflicto de idempotencia para evento_clave');
    conflict.code = 'CONFLICT';
    conflict.evidence = {
      table: tableName,
      eventoClave,
      operacionId,
      contentHash,
      existing: row,
      duplicate: {
        errno: error.errno,
        code: error.code,
        message: error.message
      }
    };
    throw conflict;
  }
}

module.exports = {
  buildEventoClave,
  insertEfectoIdempotente
};
