// Solo lectura, aislado de los repositorios usados por listados y operaciones.
const HEADER_SQL = `
 WITH detalle AS (
   SELECT venta_id, COUNT(*) AS lineas,
     SUM(CASE WHEN UPPER(COALESCE(producto_nombre,'')) LIKE '%FLETE%' THEN 1 ELSE 0 END) AS fletes,
     SUM(CASE WHEN TRIM(COALESCE(producto_nombre,'')) = '' THEN 1 ELSE 0 END) AS sin_nombre,
     SUM(subtotal) AS neto_lineas, SUM(IVA) AS iva_lineas
   FROM ventas_cont GROUP BY venta_id
 )
 SELECT v.id, DATE_FORMAT(v.fecha, '%Y-%m-%d') AS fecha_comercial,
   DATE_FORMAT(COALESCE(v.fecha_fiscal, v.fecha), '%Y-%m-%d') AS fecha_fiscal,
   v.numero_factura, v.tipo_doc, v.tipo_f, v.estado, v.subtotal, v.iva_total, v.total, v.exento,
   v.empleado_id, v.empleado_nombre, v.cliente_id, v.cliente_nombre, v.cliente_ciudad, v.cliente_provincia,
   v.cuenta_id, v.venta_referencia_id, v.cae_resultado,
   d.lineas, d.fletes, d.sin_nombre, d.neto_lineas, d.iva_lineas,
   vr.id AS referencia_id, vr.empleado_id AS referencia_empleado_id,
   vr.empleado_nombre AS referencia_empleado_nombre, dr.lineas AS referencia_lineas,
   dr.fletes AS referencia_fletes, dr.sin_nombre AS referencia_sin_nombre
 FROM ventas v
 LEFT JOIN detalle d ON d.venta_id = v.id
 LEFT JOIN ventas vr ON vr.id = v.venta_referencia_id
 LEFT JOIN detalle dr ON dr.venta_id = vr.id
 WHERE (v.fecha_fiscal >= ? AND v.fecha_fiscal < ?)
    OR (v.fecha_fiscal IS NULL AND v.fecha >= ? AND v.fecha < ?)
    OR (v.fecha >= ? AND v.fecha < ?)
 ORDER BY v.id`;
const LINES_SQL = `SELECT vc.id, vc.venta_id, vc.producto_id, vc.producto_nombre, vc.producto_um,
 vc.cantidad, vc.subtotal, vc.IVA AS iva
 FROM ventas_cont vc JOIN ventas v ON v.id = vc.venta_id
 WHERE (v.fecha_fiscal >= ? AND v.fecha_fiscal < ?)
 OR (v.fecha_fiscal IS NULL AND v.fecha >= ? AND v.fecha < ?)
 ORDER BY vc.id`;
async function readReport(connection, p) {
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query(
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'
  );
  const capturado_en = new Date().toISOString();
  try {
    const read = async (sql, params) =>
      (await connection.query(sql, params))[0];
    const range = [p.anterior.desde, p.fin_exclusivo];
    const current = [p.desde, p.fin_exclusivo];
    // Secuencial sobre la misma conexión: una sola fotografía InnoDB.
    const documents = await read(HEADER_SQL, [...range, ...range, ...range]);
    const lines = await read(LINES_SQL, [...current, ...current]);
    const purchases = await read(
      `SELECT id, total, estado, cuenta_id, DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha FROM compras WHERE fecha >= ? AND fecha < ?`,
      current
    );
    const expenses = await read(
      `SELECT id, monto, cuenta_id, descripcion, DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha FROM gastos WHERE fecha >= ? AND fecha < ?`,
      current
    );
    const movements = await read(
      `SELECT mf.id, mf.cuenta_id, COALESCE(cf.nombre,'Sin cuenta') AS cuenta,
      mf.tipo, mf.origen, mf.monto, DATE_FORMAT(mf.fecha,'%Y-%m-%d %H:%i:%s') AS fecha
      FROM movimiento_fondos mf LEFT JOIN cuenta_fondos cf ON cf.id = mf.cuenta_id
      WHERE mf.fecha >= ? AND mf.fecha < ? ORDER BY mf.fecha, mf.id`,
      current
    );
    await connection.commit();
    return { documents, lines, purchases, expenses, movements, capturado_en };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
module.exports = { readReport, HEADER_SQL, LINES_SQL };
