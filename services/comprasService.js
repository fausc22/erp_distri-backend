const comprasRepository = require('../repositories/comprasRepository');
const stockRepository = require('../repositories/stockRepository');
const fondosService = require('./fondosService');
const { withTransaction } = require('../db/transaction');
const { query: cQuery } = require('../db/connectionQuery');
const { registrarMovimientoStock } = require('../utils/stockMovement');
const AppError = require('../errors/AppError');

async function obtenerCompras() {
  return comprasRepository.obtenerCompras();
}

async function obtenerProductosCompra(compraId) {
  if (!compraId) throw new AppError('compraId es requerido', 'VALIDATION_ERROR', 400);
  return comprasRepository.obtenerProductosCompra(compraId);
}

function validarCompraPayload(body) {
  const { proveedor_id, proveedor_nombre, total, productos } = body;
  if (!proveedor_id || !proveedor_nombre || !total || !productos || productos.length === 0) {
    throw new AppError(
      'Datos incompletos. Se requiere proveedor, total y al menos un producto.',
      'VALIDATION_ERROR',
      400
    );
  }
}

async function registrarCompraConStock(body) {
  validarCompraPayload(body);

  const {
    proveedor_id,
    proveedor_nombre,
    proveedor_cuit,
    total,
    fecha,
    productos,
    empleado_id = null,
    empleado_nombre = null,
    actualizarStock = true,
    cuentaId = null,
    iva_total = 0
  } = body;

  return withTransaction(async (conn) => {
    const compraId = await comprasRepository.insertarCompra(
      {
        proveedor_id,
        proveedor_nombre,
        proveedor_cuit,
        total,
        fecha,
        empleado_id,
        empleado_nombre,
        cuentaId
      },
      conn
    );

    await comprasRepository.insertarProductos(compraId, productos, conn, iva_total);

    if (actualizarStock) {
      for (const producto of productos) {
        const stockRows = await cQuery(
          `SELECT stock_actual FROM productos WHERE id = ? FOR UPDATE`,
          [producto.id],
          conn
        );
        const stockAntes = stockRows?.length ? parseFloat(stockRows[0].stock_actual) : 0;
        const cantidad = parseFloat(producto.cantidad);

        await stockRepository.incrementarStock(producto.id, cantidad, conn);

        await registrarMovimientoStock(conn, {
          productoId: producto.id,
          delta: cantidad,
          stockAntes,
          stockDespues: stockAntes + cantidad,
          tipoOperacion: 'COMPRA',
          referenciaTipo: 'compras',
          referenciaId: compraId,
          usuarioId: empleado_id,
          usuarioNombre: empleado_nombre,
          observaciones: `Compra #${compraId}`
        });
      }
    }

    if (cuentaId) {
      await fondosService.manejarMovimiento(
        cuentaId,
        parseFloat(total),
        'compras',
        compraId,
        'insertar',
        conn
      );
    }

    return {
      compra_id: compraId,
      total: parseFloat(total),
      productos_registrados: productos.length,
      stock_actualizado: actualizarStock,
      cuenta_id: cuentaId
    };
  });
}

async function anularCompra(compraId, empleado = {}) {
  if (!compraId) {
    throw new AppError('compraId es requerido', 'VALIDATION_ERROR', 400);
  }

  return withTransaction(async (conn) => {
    const compraRows = await cQuery(
      `SELECT * FROM compras WHERE id = ? FOR UPDATE`,
      [compraId],
      conn
    );
    const compra = compraRows?.[0];
    if (!compra) {
      throw new AppError('Compra no encontrada', 'NOT_FOUND', 404);
    }
    if (compra.estado === 'Anulada') {
      throw new AppError('La compra ya está anulada', 'VALIDATION_ERROR', 400);
    }

    const productos = await comprasRepository.obtenerProductosCompra(compraId, conn);

    for (const producto of productos) {
      const productoId = producto.producto_id;
      const cantidad = parseFloat(producto.cantidad) || 0;
      if (!productoId || cantidad <= 0) continue;

      const stockRows = await cQuery(
        `SELECT stock_actual FROM productos WHERE id = ? FOR UPDATE`,
        [productoId],
        conn
      );
      const stockAntes = stockRows?.length ? parseFloat(stockRows[0].stock_actual) : 0;
      const stockDespues = stockAntes - cantidad;

      await stockRepository.incrementarStock(productoId, -cantidad, conn);

      await registrarMovimientoStock(conn, {
        productoId,
        delta: -cantidad,
        stockAntes,
        stockDespues,
        tipoOperacion: 'AJUSTE_MANUAL',
        referenciaTipo: 'compras',
        referenciaId: compraId,
        usuarioId: empleado.id || null,
        usuarioNombre: empleado.nombre || null,
        observaciones: `Anulación compra #${compraId}`
      });
    }

    if (compra.cuenta_id) {
      await fondosService.manejarMovimiento(
        compra.cuenta_id,
        parseFloat(compra.total),
        'compras',
        compraId,
        'eliminar',
        conn
      );
    }

    await cQuery(
      `UPDATE compras SET estado = 'Anulada' WHERE id = ?`,
      [compraId],
      conn
    );

    return {
      compra_id: Number(compraId),
      estado: 'Anulada',
      productos_revertidos: productos.length,
      fondos_revertidos: Boolean(compra.cuenta_id)
    };
  });
}

module.exports = {
  obtenerCompras,
  obtenerProductosCompra,
  registrarCompraConStock,
  anularCompra
};
