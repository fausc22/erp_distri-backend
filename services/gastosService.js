const gastosRepository = require('../repositories/gastosRepository');
const fondosService = require('./fondosService');
const { withTransaction } = require('../db/transaction');
const AppError = require('../errors/AppError');

async function obtenerGastos() {
  return gastosRepository.obtenerGastos();
}

async function obtenerGasto(gastoId) {
  return gastosRepository.obtenerGasto(gastoId);
}

async function crearGasto(body, empleadoId) {
  const { descripcion, monto, forma_pago, observaciones, cuentaId } = body;

  if (!descripcion || !monto || !forma_pago) {
    throw new AppError('Los campos descripcion, monto y forma_pago son obligatorios', 'VALIDATION_ERROR', 400);
  }

  if (!cuentaId) {
    throw new AppError('Debe seleccionar una cuenta de origen para el egreso', 'VALIDATION_ERROR', 400);
  }

  const montoNum = typeof monto === 'number' ? monto : parseFloat(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    throw new AppError('El monto debe ser un número mayor a 0', 'VALIDATION_ERROR', 400);
  }

  if (montoNum > 99999999.99) {
    throw new AppError('El monto no puede exceder $99.999.999,99', 'VALIDATION_ERROR', 400);
  }

  const gastoData = {
    descripcion: descripcion.trim(),
    monto: parseFloat(montoNum).toFixed(2),
    forma_pago: forma_pago.trim(),
    observaciones: observaciones ? observaciones.trim() : null,
    empleado_id: empleadoId,
    cuenta_id: Number(cuentaId)
  };

  return withTransaction(async (conn) => {
    const gastoId = await gastosRepository.crear(gastoData, conn);

    await fondosService.manejarMovimiento(
      gastoData.cuenta_id,
      parseFloat(gastoData.monto),
      'gastos',
      gastoId,
      'insertar',
      conn
    );

    return {
      id: gastoId,
      descripcion: gastoData.descripcion,
      monto: parseFloat(gastoData.monto),
      forma_pago: gastoData.forma_pago,
      observaciones: gastoData.observaciones,
      empleado_id: gastoData.empleado_id,
      cuenta_id: gastoData.cuenta_id,
      fecha: new Date()
    };
  });
}

async function actualizarGasto(gastoId, body) {
  const { descripcion, monto, formaPago, observaciones, empleadoId, cuentaId } = body;
  const datosAnteriores = await gastosRepository.obtenerGasto(gastoId);

  if (!datosAnteriores) {
    throw new AppError('Gasto no encontrado', 'NOT_FOUND', 404);
  }

  return withTransaction(async (conn) => {
    await gastosRepository.actualizar(gastoId, {
      descripcion,
      monto,
      formaPago,
      observaciones,
      empleadoId,
      cuentaId
    }, conn);

    const montoAnterior = parseFloat(datosAnteriores.monto);
    const montoNuevo = parseFloat(monto);
    const cuentaAnterior = datosAnteriores.cuenta_id;

    if (cuentaAnterior !== cuentaId || montoAnterior !== montoNuevo) {
      if (cuentaAnterior) {
        await fondosService.manejarMovimiento(
          cuentaAnterior,
          montoAnterior,
          'gastos',
          gastoId,
          'eliminar',
          conn
        );
      }
      if (cuentaId) {
        await fondosService.manejarMovimiento(cuentaId, montoNuevo, 'gastos', gastoId, 'insertar', conn);
      }
    }

    return {
      datosAnteriores,
      datosNuevos: { ...datosAnteriores, descripcion, monto, formaPago, observaciones, empleadoId, cuentaId }
    };
  });
}

async function eliminarGasto(gastoId) {
  const datosAnteriores = await gastosRepository.obtenerGasto(gastoId);

  if (!datosAnteriores) {
    throw new AppError('Gasto no encontrado', 'NOT_FOUND', 404);
  }

  return withTransaction(async (conn) => {
    if (datosAnteriores.cuenta_id) {
      await fondosService.manejarMovimiento(
        datosAnteriores.cuenta_id,
        parseFloat(datosAnteriores.monto),
        'gastos',
        gastoId,
        'eliminar',
        conn
      );
    }

    await gastosRepository.eliminar(gastoId, conn);
    return datosAnteriores;
  });
}

module.exports = {
  obtenerGastos,
  obtenerGasto,
  crearGasto,
  actualizarGasto,
  eliminarGasto
};
