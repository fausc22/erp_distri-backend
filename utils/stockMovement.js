const { query: cQuery } = require('../db/connectionQuery');

const MOTIVO_A_TIPO_OPERACION = {
  nuevo_pedido: 'PEDIDO_NUEVO',
  agregar_producto_pedido: 'PEDIDO_ITEM_AGREGADO',
  actualizar_producto_pedido: 'PEDIDO_ITEM_MODIFICADO',
  eliminar_producto_pedido: 'PEDIDO_ITEM_ELIMINADO',
  eliminar_pedido_completo: 'PEDIDO_ANULADO',
  pedido_anulado: 'PEDIDO_ANULADO',
  pedido_reactivado: 'PEDIDO_REACTIVADO',
  actualizar_cantidad_pedido: 'PEDIDO_ITEM_MODIFICADO'
};

async function registrarMovimientoStock(connection, {
  productoId,
  delta,
  stockAntes,
  stockDespues,
  tipoOperacion,
  referenciaTipo,
  referenciaId = null,
  usuarioId = null,
  usuarioNombre = null,
  observaciones = null
}) {
  if (!connection) return;

  await cQuery(
    `INSERT INTO movimiento_stock
     (producto_id, delta, stock_antes, stock_despues, tipo_operacion,
      referencia_tipo, referencia_id, usuario_id, usuario_nombre, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productoId,
      delta,
      stockAntes,
      stockDespues,
      tipoOperacion,
      referenciaTipo,
      referenciaId,
      usuarioId,
      usuarioNombre,
      observaciones
    ],
    connection
  );
}

async function registrarMovimientoStockPool({
  productoId,
  delta,
  stockAntes,
  stockDespues,
  tipoOperacion,
  referenciaTipo,
  referenciaId = null,
  usuarioId = null,
  usuarioNombre = null,
  observaciones = null
}) {
  await cQuery(
    `INSERT INTO movimiento_stock
     (producto_id, delta, stock_antes, stock_despues, tipo_operacion,
      referencia_tipo, referencia_id, usuario_id, usuario_nombre, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productoId,
      delta,
      stockAntes,
      stockDespues,
      tipoOperacion,
      referenciaTipo,
      referenciaId,
      usuarioId,
      usuarioNombre,
      observaciones
    ],
    null
  );
}

function resolverTipoOperacion(motivo, tipoOperacionOverride) {
  if (tipoOperacionOverride) return tipoOperacionOverride;
  return MOTIVO_A_TIPO_OPERACION[motivo] || 'AJUSTE_MANUAL';
}

module.exports = {
  registrarMovimientoStock,
  registrarMovimientoStockPool,
  resolverTipoOperacion,
  MOTIVO_A_TIPO_OPERACION
};
