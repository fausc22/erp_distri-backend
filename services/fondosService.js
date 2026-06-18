const fondosRepository = require('../repositories/fondosRepository');

async function manejarMovimiento(cuentaId, monto, origen, referenciaId, tipoOperacion = 'insertar', connection = null) {
  if (!cuentaId || monto <= 0) return;

  if (tipoOperacion === 'insertar') {
    await fondosRepository.registrarEgreso(cuentaId, origen, referenciaId, monto, connection);
    return;
  }

  if (tipoOperacion === 'eliminar') {
    await fondosRepository.revertirEgreso(cuentaId, origen, referenciaId, monto, connection);
  }
}

module.exports = { manejarMovimiento };
