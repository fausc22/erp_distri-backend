function buildSerieClave({ cuit, entorno, cbteTipo, ptoVta }) {
  const parts = [cuit, entorno, cbteTipo, ptoVta].map((value) => String(value ?? '').trim());
  if (parts.some((part) => !part)) {
    throw new Error('Datos incompletos para construir serie_clave');
  }
  return parts.join(':');
}

function buildSeriesError(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = evidence;
  return error;
}

async function reservarSerie(connection, { serieClave, intentoId }) {
  if (!connection || typeof connection.query !== 'function') {
    throw new Error('reservarSerie requiere una conexión transaccional');
  }
  if (!serieClave) {
    throw new Error('serieClave es requerida');
  }

  const [rows] = await connection.query(
    `SELECT serie_clave, estado, intento_activo_id
     FROM arca_series_estado
     WHERE serie_clave = ?
     FOR UPDATE`,
    [serieClave]
  );

  const actual = rows?.[0] || null;
  if (actual?.estado === 'EN_CURSO') {
    throw buildSeriesError('IN_PROGRESS', 'La serie fiscal ya tiene una operación en curso', {
      serieClave,
      intentoActivoId: actual.intento_activo_id
    });
  }
  if (actual?.estado === 'DESCONOCIDO') {
    throw buildSeriesError('RECOVERY_REQUIRED', 'La serie fiscal requiere recuperación antes de continuar', {
      serieClave,
      intentoActivoId: actual.intento_activo_id
    });
  }

  await connection.query(
    `INSERT INTO arca_series_estado (serie_clave, estado, intento_activo_id)
     VALUES (?, 'EN_CURSO', ?)
     ON DUPLICATE KEY UPDATE
       intento_activo_id = IF(estado = 'LIBRE', VALUES(intento_activo_id), intento_activo_id),
       estado = IF(estado = 'LIBRE', 'EN_CURSO', estado)`,
    [serieClave, intentoId ?? null]
  );

  const [confirmacionRows] = await connection.query(
    `SELECT serie_clave, estado, intento_activo_id
     FROM arca_series_estado
     WHERE serie_clave = ?
     FOR UPDATE`,
    [serieClave]
  );
  const confirmacion = confirmacionRows?.[0] || null;
  if (confirmacion?.estado === 'DESCONOCIDO') {
    throw buildSeriesError('RECOVERY_REQUIRED', 'La serie fiscal requiere recuperación antes de continuar', {
      serieClave,
      intentoActivoId: confirmacion.intento_activo_id
    });
  }
  if (
    confirmacion?.estado === 'EN_CURSO' &&
    String(confirmacion.intento_activo_id ?? '') !== String(intentoId ?? '')
  ) {
    throw buildSeriesError('IN_PROGRESS', 'La serie fiscal ya tiene una operación en curso', {
      serieClave,
      intentoActivoId: confirmacion.intento_activo_id
    });
  }

  return { serieClave, estado: 'EN_CURSO', intentoActivoId: intentoId ?? null };
}

async function liberarSerie(connection, { serieClave, estadoFinal = 'LIBRE', intentoId = null }) {
  if (!connection || typeof connection.query !== 'function') {
    throw new Error('liberarSerie requiere una conexión transaccional');
  }
  if (!['LIBRE', 'DESCONOCIDO'].includes(estadoFinal)) {
    throw new Error('estadoFinal debe ser LIBRE o DESCONOCIDO');
  }

  if (intentoId == null) throw new Error('Se requiere el intento propietario para actualizar la serie');
  // Solo el intento propietario puede liberar; un callback tardío ajeno no libera otra reserva.
  const [result] = await connection.query(
    `UPDATE arca_series_estado
     SET estado = ?, intento_activo_id = IF(estado = 'LIBRE', NULL, intento_activo_id)
     WHERE serie_clave = ?
       AND (
         ? IS NOT NULL
         AND intento_activo_id = ?
       )`,
    [estadoFinal, serieClave, intentoId, intentoId]
  );

  return {
    affectedRows: result?.affectedRows ?? 0,
    liberado: (result?.affectedRows ?? 0) > 0
  };
}

async function marcarDesconocido(connection, serieClave, intentoId) {
  return liberarSerie(connection, { serieClave, estadoFinal: 'DESCONOCIDO', intentoId });
}

module.exports = {
  buildSerieClave,
  reservarSerie,
  liberarSerie,
  marcarDesconocido
};
