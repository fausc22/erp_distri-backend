// Integración opt-in: solo socket Unix de la instancia de prueba, nunca .env.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { readReport } = require('../reportes/repository');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
const socketPath = process.env.REPORTES_TEST_SOCKET;
const p = period({ desde: '2026-11-01', hasta: '2026-11-30' });
test(
  'MySQL 8: esquema noviembre, límites de fecha, NULL y snapshot consistente',
  { skip: !socketPath },
  async () => {
    assert.ok(
      socketPath.startsWith('/tmp/erp-reportes-mysql/'),
      'Se requiere la instancia aislada de prueba'
    );
    const config = { socketPath, user: 'root', database: 'erp_reportes_test' };
    const conn = await mysql.createConnection(config);
    const writer = await mysql.createConnection(config);
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      for (const table of [
        'ventas_cont',
        'ventas',
        'movimiento_fondos',
        'compras',
        'gastos',
        'cuenta_fondos',
      ])
        await conn.query(`DELETE FROM ${table}`);
      await conn.query(
        "INSERT INTO cuenta_fondos(id,nombre,saldo) VALUES (1,'Prueba',0)"
      );
      await conn.query(`INSERT INTO ventas(id,fecha,fecha_fiscal,tipo_doc,tipo_f,estado,subtotal,iva_total,total,empleado_id,empleado_nombre)
    VALUES (1,'2026-11-30 23:59:59',NULL,'FACTURA','A','Facturada',100,21,121,1,'Prueba'),
    (2,'2026-11-10 12:00:00','2026-11-10','FACTURA','A','Facturada',200,42,242,2,'Martín'),
    (3,'2026-12-01 00:00:00',NULL,'FACTURA','A','Facturada',100,21,121,1,'Prueba'),
    (4,'2026-11-05 00:00:00',NULL,'FACTURA','X','Facturada',50,0,50,1,'Prueba')`);
      await conn.query(`INSERT INTO ventas_cont(id,venta_id,producto_nombre,cantidad,precio,IVA,subtotal) VALUES
    (1,1,'Producto',1,100,21,100),(2,2,'FLETE',1,200,42,200),(3,NULL,'FLETE huérfano',1,100,21,100)`);
      await conn.query(
        "INSERT INTO movimiento_fondos(id,cuenta_id,tipo,origen,monto,fecha) VALUES (1,1,'INGRESO','venta',121,'2026-11-30 23:59:59'),(2,1,'INGRESO','venta',999,'2026-12-01 00:00:00')"
      );
      const actual = buildReport(await readReport(conn, p), p);
      assert.equal(actual.resumen.total, '413.00');
      assert.equal(actual.resumen.normal, '121.00');
      assert.equal(actual.resumen.flete, '242.00');
      assert.equal(actual.resumen.pendiente, '50.00');
      assert.equal(actual.caja.ingresos, '121.00');
      assert.equal(actual.documentos.length, 3);
      assert.equal(actual.lineas.length, 2);
      // Modificar cabecera y detalle desde otra conexión DESPUÉS de leer cabeceras.
      let changed = false;
      const wrapped = {
        query: async (sql, params) => {
          const result = await conn.query(sql, params);
          if (sql.includes('WITH detalle AS') && !changed) {
            changed = true;
            await writer.beginTransaction();
            await writer.query(
              'UPDATE ventas SET total=122, iva_total=22 WHERE id=1'
            );
            await writer.query('UPDATE ventas_cont SET IVA=22 WHERE id=1');
            await writer.commit();
          }
          return result;
        },
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
      };
      const consistent = buildReport(await readReport(wrapped, p), p);
      assert.equal(consistent.resumen.total, '413.00');
      assert.equal(consistent.productos_totales.total_lineas, '363.00');
      const later = buildReport(await readReport(conn, p), p);
      assert.equal(later.resumen.total, '414.00');
      assert.equal(later.productos_totales.total_lineas, '364.00');
      // Una transacción de reporte rechaza cualquier escritura accidental.
      await conn.query('START TRANSACTION READ ONLY');
      await assert.rejects(
        conn.query('UPDATE ventas SET total=1 WHERE id=1'),
        (e) => e.code === 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION'
      );
      await conn.rollback();
      if (process.env.REPORTES_PDF_TEST === '1') {
        const express = require('express');
        const jwt = require('jsonwebtoken');
        const parsePDF = require('pdf-parse');
        const { createController } = require('../reportes/controller');
        const { requireManager } = require('../middlewares/authMiddleware');
        const pool = mysql.createPool(config);
        const controller = createController({
          getConnection: () => pool.getConnection(),
        });
        const app = express();
        app.get('/reportes', requireManager, controller.get);
        app.get('/reportes/:snapshotId/pdf', requireManager, controller.pdf);
        process.env.JWT_SECRET = 'reportes-integration-local-only';
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        try {
          const base = `http://127.0.0.1:${server.address().port}`;
          const headers = {
            Authorization: `Bearer ${jwt.sign({ id: 1, rol: 'GERENTE', usuario: 'prueba' }, process.env.JWT_SECRET)}`,
          };
          const response = await fetch(
            `${base}/reportes?desde=2026-11-01&hasta=2026-11-30`,
            { headers }
          );
          assert.equal(response.status, 200);
          const json = await response.json();
          assert.equal(json.data.resumen.total, '414.00');
          // Cambia BD después de cargar pantalla: PDF debe mantener 414.
          await writer.query('UPDATE ventas SET total=999 WHERE id=1');
          const pdfResponse = await fetch(
            `${base}/reportes/${json.data.snapshot_id}/pdf`,
            { headers }
          );
          assert.equal(pdfResponse.status, 200);
          const pdf = await parsePDF(
            Buffer.from(await pdfResponse.arrayBuffer())
          );
          assert.match(pdf.text, /414,00/);
          assert.ok(pdf.text.includes(json.data.snapshot_id));
        } finally {
          await new Promise((resolve) => server.close(resolve));
          await pool.end();
        }
      }
    } finally {
      await conn.end();
      await writer.end();
    }
  }
);
