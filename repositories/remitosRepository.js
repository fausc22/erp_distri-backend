const BaseRepository = require('./BaseRepository');

class RemitosRepository extends BaseRepository {
  crearRemito(conn, ventaData) {
    const sql = `
      INSERT INTO remitos
      (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit,
       cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia,
       estado, observaciones, empleado_id, empleado_nombre)
      VALUES
      (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return this.insert(sql, [
      ventaData.venta_id,
      ventaData.cliente_id,
      ventaData.cliente_nombre,
      ventaData.cliente_condicion,
      ventaData.cliente_cuit,
      ventaData.cliente_telefono,
      ventaData.cliente_direccion,
      ventaData.cliente_ciudad,
      ventaData.cliente_provincia,
      ventaData.estado,
      ventaData.observaciones,
      ventaData.empleado_id,
      ventaData.empleado_nombre
    ], conn);
  }

  async insertarProductosRemito(conn, remitoId, productos) {
    const sql = `
      INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad)
      VALUES (?, ?, ?, ?, ?)
    `;
    for (const producto of productos || []) {
      await this.run(sql, [
        remitoId,
        producto.producto_id,
        producto.producto_nombre,
        producto.producto_um,
        producto.cantidad
      ], conn);
    }
  }
}

module.exports = new RemitosRepository();
