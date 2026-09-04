const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');
const comprasService = require('../services/comprasService');
const gastosService = require('../services/gastosService');
const { mapErrorToResponse } = require('../utils/mapErrorToResponse');

const obtenerCompras = async (req, res) => {
  try {
    const results = await comprasService.obtenerCompras();
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error al obtener compras:', err);
    return mapErrorToResponse(err, res);
  }
};

const obtenerGastos = async (req, res) => {
  try {
    const results = await gastosService.obtenerGastos();
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Error al obtener gastos:', err);
    return mapErrorToResponse(err, res);
  }
};

const obtenerGasto = async (req, res) => {
  try {
    const gasto = await gastosService.obtenerGasto(req.params.gastoId);
    if (!gasto) {
      return res.status(404).json({ success: false, message: 'Gasto no encontrado' });
    }
    res.json({ success: true, data: gasto });
  } catch (err) {
    console.error('Error al obtener el gasto:', err);
    return mapErrorToResponse(err, res);
  }
};

const obtenerProductosCompra = async (req, res) => {
  try {
    const results = await comprasService.obtenerProductosCompra(req.params.compraId);
    res.json(results || []);
  } catch (err) {
    console.error('Error al obtener productos de la compra:', err);
    return mapErrorToResponse(err, res);
  }
};

const nuevoGasto = async (req, res) => {
  try {
    const data = await gastosService.crearGasto(req.body, req.user.id);

    try {
      await auditarOperacion(req, {
        accion: 'CREATE',
        tabla: 'gastos',
        registroId: data.id,
        detallesAdicionales: `Gasto registrado: ${data.descripcion} - $${data.monto}`
      });
    } catch (auditError) {
      console.error('Error en auditoría:', auditError);
    }

    res.status(201).json({
      success: true,
      message: 'Gasto registrado exitosamente',
      data
    });
  } catch (err) {
    console.error('Error en nuevo gasto:', err);
    return mapErrorToResponse(err, res);
  }
};

const actualizarGasto = async (req, res) => {
  try {
    const { datosAnteriores, datosNuevos } = await gastosService.actualizarGasto(
      req.params.gastoId,
      req.body
    );

    await auditarOperacion(req, {
      accion: 'UPDATE',
      tabla: 'gastos',
      registroId: req.params.gastoId,
      datosAnteriores,
      datosNuevos,
      detallesAdicionales: `Gasto actualizado: ${req.body.descripcion} - Monto: $${req.body.monto}`
    });

    res.json({ success: true, message: 'Gasto actualizado exitosamente' });
  } catch (err) {
    console.error('Error al actualizar gasto:', err);
    return mapErrorToResponse(err, res);
  }
};

const eliminarGasto = async (req, res) => {
  try {
    const datosAnteriores = await gastosService.eliminarGasto(req.params.gastoId);

    await auditarOperacion(req, {
      accion: 'DELETE',
      tabla: 'gastos',
      registroId: req.params.gastoId,
      datosAnteriores,
      detallesAdicionales: `Gasto eliminado: ${datosAnteriores.descripcion} - Monto: $${datosAnteriores.monto}`
    });

    res.json({ success: true, message: 'Gasto eliminado exitosamente' });
  } catch (err) {
    console.error('Error al eliminar gasto:', err);
    return mapErrorToResponse(err, res);
  }
};

const registrarCompraConStock = async (req, res) => {
  try {
    const data = await comprasService.registrarCompraConStock(req.body);

    await auditarOperacion(req, {
      accion: 'INSERT',
      tabla: 'compras',
      registroId: data.compra_id,
      datosNuevos: {
        id: data.compra_id,
        proveedor_nombre: req.body.proveedor_nombre,
        proveedor_cuit: req.body.proveedor_cuit,
        total: data.total,
        productos_count: data.productos_registrados,
        stock_actualizado: data.stock_actualizado,
        cuenta_id: data.cuenta_id
      },
      detallesAdicionales: `Compra registrada con ${data.stock_actualizado ? 'actualización' : 'sin actualización'} de stock - Proveedor: ${req.body.proveedor_nombre} - Total: $${data.total} - ${data.productos_registrados} productos${data.cuenta_id ? ` - Cuenta: ${data.cuenta_id}` : ''}`
    });

    res.json({
      success: true,
      message: `Compra registrada exitosamente${data.stock_actualizado ? ' con actualización de stock' : ''}${data.cuenta_id ? ' y movimiento de fondos' : ''}`,
      data: {
        compra_id: data.compra_id,
        total: data.total,
        productos_registrados: data.productos_registrados
      }
    });
  } catch (err) {
    console.error('Error en el proceso de compra:', err);

    try {
      await auditarOperacion(req, {
        accion: 'INSERT',
        tabla: 'compras',
        detallesAdicionales: `Error al registrar compra con stock: ${err.message}`,
        datosNuevos: req.body
      });
    } catch (auditError) {
      console.error('Error en auditoría:', auditError);
    }

    return mapErrorToResponse(err, res);
  }
};

const anularCompra = async (req, res) => {
  try {
    const data = await comprasService.anularCompra(req.params.compraId, {
      id: req.user?.id,
      nombre: req.user?.nombre
    });

    await auditarOperacion(req, {
      accion: 'UPDATE',
      tabla: 'compras',
      registroId: data.compra_id,
      datosNuevos: data,
      detallesAdicionales: `Compra #${data.compra_id} anulada - stock y fondos revertidos`
    });

    res.json({
      success: true,
      message: 'Compra anulada exitosamente',
      data
    });
  } catch (err) {
    console.error('Error al anular compra:', err);
    return mapErrorToResponse(err, res);
  }
};

module.exports = {
  obtenerGastos,
  obtenerGasto,
  obtenerCompras,
  obtenerProductosCompra,
  nuevoGasto,
  actualizarGasto,
  eliminarGasto,
  registrarCompraConStock,
  anularCompra
};
