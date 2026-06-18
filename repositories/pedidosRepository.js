const BaseRepository = require('./BaseRepository');

class PedidosRepository extends BaseRepository {
  obtenerPedidos(connection = null) {
    return this.query('SELECT * FROM pedidos ORDER BY fecha DESC, id DESC', [], connection);
  }

  verificarPedidoDuplicado(hash, connection = null) {
    const sql = `
      SELECT id, fecha, cliente_nombre, total, estado
      FROM pedidos
      WHERE hash_pedido = ?
        AND fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY fecha DESC, id DESC
      LIMIT 1
    `;
    return this.queryOne(sql, [hash], connection);
  }

  insertPedidoCabecera(data, hash = null, meta = {}, conn = null) {
    const sql = `
      INSERT INTO pedidos
      (cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad,
       cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, exento, total,
       estado, observaciones, empleado_id, empleado_nombre, hash_pedido)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.cliente_id,
      data.cliente_nombre,
      data.cliente_telefono,
      data.cliente_direccion,
      data.cliente_ciudad,
      data.cliente_provincia,
      data.cliente_condicion,
      data.cliente_cuit,
      data.subtotal,
      data.iva_total,
      data.exento,
      data.total,
      data.estado,
      data.observaciones,
      data.empleado_id,
      data.empleado_nombre,
      hash || null
    ];

    return this.query(sql, values, conn);
  }

  async insertProductosPedido(pedidoId, productos, conn = null) {
    const sql = `
      INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal, descuento_porcentaje)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const results = [];
    for (const producto of productos) {
      const values = [
        pedidoId,
        producto.id,
        producto.nombre,
        producto.unidad_medida,
        producto.cantidad,
        producto.precio,
        producto.iva,
        producto.subtotal,
        producto.descuento_porcentaje || 0
      ];
      const result = await this.query(sql, values, conn);
      results.push(result);
    }
    return results;
  }

  actualizarTotalesPedido(pedidoId, subtotal, iva, total, conn = null) {
    const sql = `
      UPDATE pedidos
      SET subtotal = ?, iva_total = ?, total = ?
      WHERE id = ?
    `;
    return this.query(sql, [subtotal, iva, total, pedidoId], conn);
  }

  obtenerPedidoByIdForUpdate(pedidoId, conn = null) {
    const sql = `
      SELECT id, estado, empleado_id, cliente_nombre
      FROM pedidos
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `;
    return this.queryOne(sql, [pedidoId], conn);
  }

  updateEstadoPedido(pedidoId, estado, conn = null) {
    const sql = `UPDATE pedidos SET estado = ? WHERE id = ?`;
    return this.query(sql, [estado, pedidoId], conn);
  }

  updateClientePedido(pedidoId, clienteData, conn = null) {
    const sql = `
      UPDATE pedidos
      SET
        cliente_id = ?,
        cliente_nombre = ?,
        cliente_telefono = ?,
        cliente_direccion = ?,
        cliente_ciudad = ?,
        cliente_provincia = ?,
        cliente_condicion = ?,
        cliente_cuit = ?
      WHERE id = ?
    `;
    return this.query(
      sql,
      [
        clienteData.id,
        clienteData.nombre,
        clienteData.telefono || '',
        clienteData.direccion || '',
        clienteData.ciudad || '',
        clienteData.provincia || '',
        clienteData.condicion_iva || '',
        clienteData.cuit || '',
        pedidoId
      ],
      conn
    );
  }

  deleteProductoPedido(pedidoId, productoId, conn = null) {
    const sql = `DELETE FROM pedidos_cont WHERE pedido_id = ? AND id = ?`;
    return this.query(sql, [pedidoId, productoId], conn);
  }

  updateProductoPedido(pedidoId, productoData, conn = null) {
    const sql = `
      UPDATE pedidos_cont
      SET cantidad = ?, precio = ?, IVA = ?, subtotal = ?, descuento_porcentaje = ?, producto_nombre = ?
      WHERE id = ? AND pedido_id = ?
    `;
    return this.query(
      sql,
      [
        productoData.cantidad,
        productoData.precio,
        productoData.iva,
        productoData.subtotal,
        productoData.descuento_porcentaje || 0,
        productoData.producto_nombre,
        productoData.id,
        pedidoId
      ],
      conn
    );
  }
}

module.exports = new PedidosRepository();
