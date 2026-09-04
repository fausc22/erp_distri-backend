const BaseRepository = require('./BaseRepository');

class GastosRepository extends BaseRepository {
  obtenerGastos(connection = null) {
    return this.query('SELECT * FROM gastos ORDER BY fecha DESC', [], connection);
  }

  obtenerGasto(id, connection = null) {
    return this.queryOne('SELECT * FROM gastos WHERE id = ?', [id], connection);
  }

  async crear(gastoData, connection = null) {
    return this.insert(
      `INSERT INTO gastos (fecha, descripcion, monto, forma_pago, observaciones, empleado_id, cuenta_id)
       VALUES (NOW(), ?, ?, ?, ?, ?, ?)`,
      [
        gastoData.descripcion,
        gastoData.monto,
        gastoData.forma_pago,
        gastoData.observaciones,
        gastoData.empleado_id,
        gastoData.cuenta_id || null
      ],
      connection
    );
  }

  async actualizar(gastoId, data, connection = null) {
    return this.update(
      `UPDATE gastos
       SET descripcion = ?, monto = ?, forma_pago = ?, observaciones = ?, empleado_id = ?, cuenta_id = ?
       WHERE id = ?`,
      [
        data.descripcion,
        data.monto,
        data.formaPago,
        data.observaciones,
        data.empleadoId,
        data.cuentaId,
        gastoId
      ],
      connection
    );
  }

  async eliminar(gastoId, connection = null) {
    return this.remove('DELETE FROM gastos WHERE id = ?', [gastoId], connection);
  }
}

module.exports = new GastosRepository();
