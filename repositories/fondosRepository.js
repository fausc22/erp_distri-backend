const BaseRepository = require('./BaseRepository');

class FondosRepository extends BaseRepository {
  async obtenerCuentaPorIdForUpdate(connection, id) {
    return this.queryOne(
      `SELECT id, nombre, saldo
       FROM cuenta_fondos
       WHERE id = ?
       FOR UPDATE`,
      [id],
      connection
    );
  }

  async registrarMovimiento(connection, data) {
    const { cuenta_id, tipo, origen, monto, referencia_id = null } = data;
    const insertId = await this.insert(
      `INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, monto, referencia_id)
       VALUES (?, ?, ?, ?, ?)`,
      [cuenta_id, tipo, origen, monto, referencia_id],
      connection
    );
    return { insertId };
  }

  async actualizarSaldo(connection, cuentaId, delta) {
    const affectedRows = await this.update(
      `UPDATE cuenta_fondos
       SET saldo = saldo + ?
       WHERE id = ?`,
      [delta, cuentaId],
      connection
    );
    return { affectedRows };
  }

  async transferir(connection, origenId, destinoId, monto, meta = {}) {
    const egreso = await this.registrarMovimiento(connection, {
      cuenta_id: origenId,
      tipo: 'EGRESO',
      origen: meta.origen || 'transferencia',
      monto,
      referencia_id: meta.referencia_id || null
    });

    await this.registrarMovimiento(connection, {
      cuenta_id: destinoId,
      tipo: 'INGRESO',
      origen: meta.origen || 'transferencia',
      monto,
      referencia_id: egreso.insertId
    });

    await this.actualizarSaldo(connection, origenId, -Math.abs(parseFloat(monto)));
    await this.actualizarSaldo(connection, destinoId, Math.abs(parseFloat(monto)));

    return { referenciaEgresoId: egreso.insertId };
  }

  async registrarEgreso(cuentaId, origen, referenciaId, monto, connection = null) {
    await this.insert(
      `INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, referencia_id, monto)
       VALUES (?, 'EGRESO', ?, ?, ?)`,
      [cuentaId, origen, referenciaId, monto],
      connection
    );
    await this.update(
      'UPDATE cuenta_fondos SET saldo = saldo - ? WHERE id = ?',
      [monto, cuentaId],
      connection
    );
  }

  async revertirEgreso(cuentaId, origen, referenciaId, monto, connection = null) {
    await this.remove(
      'DELETE FROM movimiento_fondos WHERE origen = ? AND referencia_id = ?',
      [origen, referenciaId],
      connection
    );
    await this.update(
      'UPDATE cuenta_fondos SET saldo = saldo + ? WHERE id = ?',
      [monto, cuentaId],
      connection
    );
  }
}

module.exports = new FondosRepository();
