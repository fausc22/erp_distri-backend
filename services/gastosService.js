const gastosRepository = require('../repositories/gastosRepository');
const fondosService = require('./fondosService');
const AppError = require('../errors/AppError');

async function obtenerGastos() {
  return gastosRepository.obtenerGastos();
}

async function obtenerGasto(gastoId) {
  return gastosRepository.obtenerGasto(gastoId);
}

async function crearGasto(body, empleadoId) {
  const { descripcion, monto, forma_pago, observaciones } = body;

  if (!descripcion || !monto || !forma_pago) {
    throw new AppError('Los campos descripcion, monto y forma_pago son obligatorios', 'VALIDATION_ERROR', 400);
  }

  if (typeof monto !== 'number' || monto <= 0) {
    throw new AppError('El monto debe ser un número mayor a 0', 'VALIDATION_ERROR', 400);
  }

  if (monto > 99999999.99) {
    throw new AppError('El monto no puede exceder $99.999.999,99', 'VALIDATION_ERROR', 400);
  }

  const gastoData = {
    descripcion: descripcion.trim(),
    monto: parseFloat(monto).toFixed(2),
    forma_pago: forma_pago.trim(),
    observaciones: observaciones ? observaciones.trim() : null,
    empleado_id: empleadoId
  };

  const gastoId = await gastosRepository.crear(gastoData);

  return {
    id: gastoId,
    descripcion: gastoData.descripcion,
    monto: parseFloat(gastoData.monto),
    forma_pago: gastoData.forma_pago,
    observaciones: gastoData.observaciones,
    empleado_id: gastoData.empleado_id,
    fecha: new Date()
  };
}

async function actualizarGasto(gastoId, body) {
  const { descripcion, monto, formaPago, observaciones, empleadoId, cuentaId } = body;
  const datosAnteriores = await gastosRepository.obtenerGasto(gastoId);

  if (!datosAnteriores) {
    throw new AppError('Gasto no encontrado', 'NOT_FOUND', 404);
  }

  await gastosRepository.actualizar(gastoId, {
    descripcion,
    monto,
    formaPago,
    observaciones,
    empleadoId,
    cuentaId
  });

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
        'eliminar'
      );
    }
    if (cuentaId) {
      await fondosService.manejarMovimiento(cuentaId, montoNuevo, 'gastos', gastoId, 'insertar');
    }
  }

  return {
    datosAnteriores,
    datosNuevos: { ...datosAnteriores, descripcion, monto, formaPago, observaciones, empleadoId, cuentaId }
  };
}

async function eliminarGasto(gastoId) {
  const datosAnteriores = await gastosRepository.obtenerGasto(gastoId);

  if (!datosAnteriores) {
    throw new AppError('Gasto no encontrado', 'NOT_FOUND', 404);
  }

  if (datosAnteriores.cuenta_id) {
    await fondosService.manejarMovimiento(
      datosAnteriores.cuenta_id,
      parseFloat(datosAnteriores.monto),
      'gastos',
      gastoId,
      'eliminar'
    );
  }

  await gastosRepository.eliminar(gastoId);
  return datosAnteriores;
}

module.exports = {
  obtenerGastos,
  obtenerGasto,
  crearGasto,
  actualizarGasto,
  eliminarGasto
};
