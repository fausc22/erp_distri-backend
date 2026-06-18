const BaseRepository = require('./BaseRepository');

class VentasRepository extends BaseRepository {
  obtenerVentas(connection = null) {
    return this.query('SELECT * FROM ventas ORDER BY fecha DESC, id DESC', [], connection);
  }

  verificarVentaExistentePorPedido(conn, pedidoId) {
    const sql = `
      SELECT v.id, v.numero_factura, v.fecha, v.cliente_nombre, v.total, v.tipo_f, v.estado
      FROM ventas v
      INNER JOIN pedidos p ON v.cliente_id = p.cliente_id
        AND v.cliente_nombre = p.cliente_nombre
        AND ABS(v.total - p.total) < 0.01
      WHERE p.id = ?
      AND v.tipo_doc = 'FACTURA'
      AND v.fecha >= DATE_SUB(NOW(), INTERVAL 1 DAY)
      ORDER BY v.fecha DESC, v.id DESC
      LIMIT 1
    `;
    return this.queryOne(sql, [pedidoId], conn);
  }

  verificarVentaExistentePorHash(conn, hash) {
    if (!hash) return null;
    const sql = `
      SELECT id, numero_factura, fecha, cliente_nombre, total, tipo_f, estado
      FROM ventas
      WHERE hash_venta = ?
      AND fecha >= DATE_SUB(NOW(), INTERVAL 1 DAY)
      ORDER BY fecha DESC, id DESC
      LIMIT 1
    `;
    return this.queryOne(sql, [hash], conn);
  }

  insertarVentaCabecera(conn, data) {
    const sql = `
      INSERT INTO ventas
      (fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion,
       cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit,
       cuenta_id, tipo_doc, tipo_f, subtotal, iva_total, exento, total, estado,
       observaciones, empleado_id, empleado_nombre, hash_venta,
       cae_id, cae_fecha, cae_resultado, cae_observaciones, cae_solicitud_fecha, comprobante_path)
      VALUES
      (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.numero_factura,
      data.cliente_id,
      data.cliente_nombre,
      data.cliente_telefono,
      data.cliente_direccion,
      data.cliente_ciudad,
      data.cliente_provincia,
      data.cliente_condicion,
      data.cliente_cuit,
      data.cuenta_id,
      data.tipo_doc,
      data.tipo_f,
      data.subtotal,
      data.iva_total,
      data.exento,
      data.total,
      data.estado,
      data.observaciones,
      data.empleado_id,
      data.empleado_nombre,
      data.hash_venta || null,
      data.cae_id ?? null,
      data.cae_fecha ?? null,
      data.cae_resultado ?? null,
      data.cae_observaciones ?? null,
      data.cae_solicitud_fecha ?? null,
      data.comprobante_path ?? null
    ];

    return this.insert(sql, values, conn);
  }

  async insertarVentaItems(conn, ventaId, items) {
    const sql = `
      INSERT INTO ventas_cont
      (venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal, descuento_porcentaje)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (const item of items || []) {
      await this.run(sql, [
        ventaId,
        item.producto_id,
        item.producto_nombre,
        item.producto_um,
        item.cantidad,
        item.precio,
        item.iva,
        item.subtotal,
        item.descuento_porcentaje || 0
      ], conn);
    }
  }

  actualizarTotalesVenta(conn, ventaId, totales) {
    const sql = `
      UPDATE ventas
      SET subtotal = ?, iva_total = ?, exento = ?, total = ?
      WHERE id = ?
    `;
    return this.update(sql, [
      totales.subtotal,
      totales.iva_total,
      totales.exento,
      totales.total,
      ventaId
    ], conn);
  }

  async obtenerSiguienteNumeroFactura(conn, tipoFiscal, pv) {
    const puntoVenta = String(pv || process.env.DEFAULT_PUNTO_VENTA).padStart(4, '0');
    const check = await this.query(
      'SELECT ultimo_numero FROM control_numeracion_facturas WHERE punto_venta = ? AND tipo_factura = ?',
      [puntoVenta, tipoFiscal],
      conn
    );
    if (!check.length) {
      await this.run(
        'INSERT INTO control_numeracion_facturas (punto_venta, tipo_factura, ultimo_numero) VALUES (?, ?, 0)',
        [puntoVenta, tipoFiscal],
        conn
      );
    }
    await this.run(
      'UPDATE control_numeracion_facturas SET ultimo_numero = ultimo_numero + 1 WHERE punto_venta = ? AND tipo_factura = ?',
      [puntoVenta, tipoFiscal],
      conn
    );
    const row = await this.queryOne(
      'SELECT ultimo_numero FROM control_numeracion_facturas WHERE punto_venta = ? AND tipo_factura = ? LIMIT 1',
      [puntoVenta, tipoFiscal],
      conn
    );
    const numeroFactura = row?.ultimo_numero;
    if (typeof numeroFactura === 'undefined') {
      throw new Error(`No se pudo obtener el número de factura para tipo ${tipoFiscal} en PV ${puntoVenta}`);
    }
    return {
      numeroFactura,
      numeroCompleto: `${tipoFiscal} ${puntoVenta}-${String(numeroFactura).padStart(8, '0')}`,
      puntoVenta
    };
  }
}

module.exports = new VentasRepository();
