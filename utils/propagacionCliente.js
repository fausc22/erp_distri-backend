/**
 * Reglas de propagación de datos comerciales del maestro de clientes
 * hacia pedidos/ventas abiertos. No toca documentos con CAE aprobado.
 */

function pedidoRecibeDatosCliente(estado) {
  const valor = String(estado || '').trim();
  return valor !== 'Facturado';
}

function ventaTieneCaeAprobado(caeId, caeResultado) {
  const cae = caeId != null && String(caeId).trim() !== '';
  const resultado = String(caeResultado || '').trim().toUpperCase();
  return cae && resultado === 'A';
}

/**
 * Solo X, o A/B sin autorización ARCA (cae_id + resultado A).
 * Notas viven en ventas y usan la misma regla.
 */
function ventaRecibeDatosCliente(tipoF, caeId, caeResultado) {
  const tipo = String(tipoF || '').trim().toUpperCase();
  if (tipo === 'X') return true;
  if (tipo === 'A' || tipo === 'B') {
    return !ventaTieneCaeAprobado(caeId, caeResultado);
  }
  return false;
}

/** Fragmento SQL alineado con ventaRecibeDatosCliente (params: ninguno extra). */
const SQL_VENTA_RECIBE_DATOS_CLIENTE = `
  (
    UPPER(TRIM(COALESCE(tipo_f, ''))) = 'X'
    OR (
      UPPER(TRIM(COALESCE(tipo_f, ''))) IN ('A', 'B')
      AND NOT (
        cae_id IS NOT NULL
        AND TRIM(COALESCE(cae_id, '')) <> ''
        AND UPPER(TRIM(COALESCE(cae_resultado, ''))) = 'A'
      )
    )
  )
`;

module.exports = {
  pedidoRecibeDatosCliente,
  ventaRecibeDatosCliente,
  ventaTieneCaeAprobado,
  SQL_VENTA_RECIBE_DATOS_CLIENTE
};
