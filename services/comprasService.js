const comprasRepository = require('../repositories/comprasRepository');
const stockRepository = require('../repositories/stockRepository');
const fondosService = require('./fondosService');
const { withTransaction } = require('../db/transaction');
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
    cuentaId = null
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

    await comprasRepository.insertarProductos(compraId, productos, conn);

    if (actualizarStock) {
      for (const producto of productos) {
        await stockRepository.incrementarStock(producto.id, producto.cantidad, conn);
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

module.exports = {
  obtenerCompras,
  obtenerProductosCompra,
  registrarCompraConStock
};
