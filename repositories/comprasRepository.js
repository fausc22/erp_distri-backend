const BaseRepository = require('./BaseRepository');

class ComprasRepository extends BaseRepository {
  obtenerCompras(connection = null) {
    return this.query('SELECT * FROM compras ORDER BY fecha DESC', [], connection);
  }

  obtenerProductosCompra(compraId, connection = null) {
    return this.query(
      `SELECT compra_id, producto_id, producto_nombre, producto_um, cantidad,
              costo AS precio_costo, precio AS precio_venta, IVA, subtotal
       FROM compras_cont WHERE compra_id = ?`,
      [compraId],
      connection
    );
  }

  async insertarCompra(data, connection) {
    const fechaCompra = data.fecha || new Date().toISOString().slice(0, 19).replace('T', ' ');
    return this.insert(
      `INSERT INTO compras (
        fecha, proveedor_id, proveedor_nombre, proveedor_cuit, total, estado,
        empleado_id, empleado_nombre, cuenta_id
      ) VALUES (?, ?, ?, ?, ?, 'Registrada', ?, ?, ?)`,
      [
        fechaCompra,
        data.proveedor_id,
        data.proveedor_nombre,
        data.proveedor_cuit,
        parseFloat(data.total),
        data.empleado_id,
        data.empleado_nombre,
        data.cuentaId || null
      ],
      connection
    );
  }

  async insertarProductos(compraId, productos, connection, ivaTotal = 0) {
    const subtotalGeneral = productos.reduce(
      (acc, producto) => acc + (parseFloat(producto.subtotal) || 0),
      0
    );
    const ivaTotalNum = parseFloat(ivaTotal) || 0;

    const productosData = productos.map((producto) => {
      const subtotal = parseFloat(producto.subtotal) || 0;
      const ivaLinea =
        subtotalGeneral > 0
          ? parseFloat(((subtotal / subtotalGeneral) * ivaTotalNum).toFixed(2))
          : 0;

      return [
        compraId,
        producto.id,
        producto.nombre,
        producto.unidad_medida || null,
        parseFloat(producto.cantidad),
        parseFloat(producto.precio_costo),
        parseFloat(producto.precio_venta),
        ivaLinea,
        subtotal
      ];
    });

    return this.run(
      `INSERT INTO compras_cont (
        compra_id, producto_id, producto_nombre, producto_um,
        cantidad, costo, precio, IVA, subtotal
      ) VALUES ?`,
      [productosData],
      connection
    );
  }
}

module.exports = new ComprasRepository();
