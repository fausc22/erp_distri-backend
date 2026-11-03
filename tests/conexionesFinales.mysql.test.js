// Pruebas operativas: solo socket aislado y base desechable, nunca carga .env.
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const SOCK = '/tmp/erp-reportes-mysql/mysql.sock';
const DATABASE = 'erp_preprod_conexiones';
process.env.MOTOR_CALCULO_VERSION = 'v1';
process.env.AFIP_CUIT = '30111111118';
process.env.ARCA_CUIT = '30111111118';
process.env.ARCA_ENTORNO = 'homologacion';
process.env.AFIP_ENV = 'homologacion';
process.env.AFIP_PRODUCTION = 'false';
process.env.NODE_ENV = 'test';
process.env.DEFAULT_PUNTO_VENTA = '0004';
// La instancia real de DB nunca se importa: inyección del pool local antes de cargar servicios.
const pool = mysql.createPool({ socketPath: SOCK, user: 'root', database: DATABASE, connectionLimit: 8 });
const dbPath = require.resolve('../db/index');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
const auditPath=require.resolve('../middlewares/auditoriaMiddleware');
require.cache[auditPath]={id:auditPath,filename:auditPath,loaded:true,exports:{auditarOperacion:async()=>{}}};
const log = console.log;
console.log = () => {};
let server;
async function run() {
  const [[{ d }]] = await pool.query('SELECT DATABASE() d');
  assert.equal(d, DATABASE);
  const [[cliente]] = await pool.query('SELECT id FROM clientes LIMIT 1');
  const [[empleado]] = await pool.query('SELECT id FROM empleados LIMIT 1');
  const [[producto]] = await pool.query("SELECT id FROM productos WHERE activo=1 AND COALESCE(es_servicio_flete,0)=0 LIMIT 1");
  await pool.query('UPDATE productos SET stock_actual=1000 WHERE id=?', [producto.id]);
  const body = {
    cliente_id: cliente.id, cliente_nombre: 'TEST CONEXIONES', cliente_telefono: '', cliente_direccion: 'LOCAL',
    cliente_ciudad: 'LOCAL', cliente_provincia: 'Cordoba', cliente_condicion: 'Responsable Inscripto', cliente_cuit: '20111111112',
    empleado_id: empleado.id, empleado_nombre: 'TEST', cuentaId: 1, tipoFiscal: 'A',
    subtotalSinIva: 1000, ivaTotal: 210, totalConIva: 1089,
    descuentoAplicado: { tipo: 'porcentaje', valor: 10, descuentoCalculado: 121 },
    productos: [{ id: producto.id, nombre: 'PRODUCTO TEST', unidad_medida: 'Unidad', cantidad: 1, precio: 1000, subtotal: 1000, iva: 210, porcentaje_iva: 21, descuento_porcentaje: 0 }],
    observaciones: 'TEST LOCAL', operacion_id: crypto.randomUUID()
  };
  const ventas = require('../services/ventasService');
  const app = express(); app.use(express.json());
  app.use((req,res,next) => { req.user={ id: empleado.id, rol:'GERENTE', usuario:'TEST', nombre:'TEST' }; next(); });
  app.post('/directa', ventas.ventaDirecta);
  app.post('/pedido', ventas.facturarPedido);
  app.post('/nota', require('../services/notasService').crearNota);
  app.post('/libro', require('../services/listadosService').generarPdfLibroIva);
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening',r));
  const post = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const first = await post('/directa',body);
  const id = first.data.ventaId;
  const [[venta]] = await pool.query('SELECT * FROM ventas WHERE id=?',[id]);
  const [lineas] = await pool.query('SELECT * FROM ventas_cont WHERE venta_id=?',[id]);
  assert.equal(venta.total,'1089.00'); assert.equal(venta.subtotal,'900.00'); assert.equal(venta.iva_total,'189.00');
  assert.equal(lineas[0].subtotal,'900.00'); assert.equal(lineas[0].IVA,'189.00');
  const { cargarCalculo, validarDocumento, payloadCalculo } = require('../dominio/calculo/documento');
  const calculo = await cargarCalculo(pool,id); assert.ok(calculo); validarDocumento(venta,lineas,calculo);
  const again = await post('/directa',body); assert.equal(again.data.ventaId,id);
  // Misma operación: no se repiten efectos.
  const [[efectos]] = await pool.query('SELECT COUNT(*) n FROM movimiento_fondos WHERE referencia_id=?',[id]);
  assert.equal(Number(efectos.n),1);
  const [[stock]] = await pool.query('SELECT stock_actual FROM productos WHERE id=?',[producto.id]);
  assert.equal(Number(stock.stock_actual),999);
  // Dos intenciones comerciales idénticas deben producir dos ventas.
  const second = await post('/directa',{...body,operacion_id:crypto.randomUUID()}); assert.notEqual(second.data.ventaId,id);
  const concBody={...body,operacion_id:crypto.randomUUID(),observaciones:'CONCURRENCIA'};
  const concurrent = await Promise.all(Array.from({length:4},()=>post('/directa',concBody)));
  assert.equal(new Set(concurrent.map(r=>r.data.ventaId)).size,1);
  log('OK HTTP venta directa: descuento, detalle, snapshot, reintento, concurrencia, intenciones distintas');
  // Pedido → venta: mismo cálculo y mismos renglones, reintento por pedido_id.
  const [pedidoNuevo] = await pool.query(`INSERT INTO pedidos
    (cliente_id,cliente_nombre,cliente_condicion,cliente_cuit,subtotal,iva_total,total,estado,empleado_id,empleado_nombre)
    VALUES (?, 'TEST PEDIDO', 'Responsable Inscripto', '20111111112', 1000,210,1210,'Exportado',?,'TEST')`,[cliente.id,empleado.id]);
  await pool.query(`INSERT INTO pedidos_cont(pedido_id,producto_id,producto_nombre,producto_um,cantidad,precio,IVA,porcentaje_iva,subtotal,descuento_porcentaje)
    VALUES (?,?,'PRODUCTO TEST','Unidad',1,1000,210,21,1000,0)`,[pedidoNuevo.insertId,producto.id]);
  const pedidoBody={...body,pedidoId:pedidoNuevo.insertId};
  const facturada=await post('/pedido',pedidoBody);
  const [[ventaPedido]]=await pool.query('SELECT * FROM ventas WHERE id=?',[facturada.data.ventaId]);
  const [detallePedido]=await pool.query('SELECT * FROM ventas_cont WHERE venta_id=?',[facturada.data.ventaId]);
  validarDocumento(ventaPedido,detallePedido,await cargarCalculo(pool,ventaPedido.id));
  assert.equal(ventaPedido.total,'1089.00');
  assert.equal((await post('/pedido',pedidoBody)).data.ventaId,ventaPedido.id);
  // Centavos no desaparecen en factura B ni en PDF previo al CAE.
  const centsBody={...body,tipoFiscal:'B',cliente_condicion:'Consumidor Final',cliente_cuit:'0',operacion_id:crypto.randomUUID(),
    descuentoAplicado:null,subtotalSinIva:1000.01,ivaTotal:210,totalConIva:1210.01,
    productos:[{...body.productos[0],precio:1000.01,subtotal:1000.01}]};
  const centsSale=await post('/directa',centsBody);
  const [[ventaCents]]=await pool.query('SELECT * FROM ventas WHERE id=?',[centsSale.data.ventaId]);
  const [detalleCents]=await pool.query('SELECT * FROM ventas_cont WHERE venta_id=?',[ventaCents.id]);
  assert.equal(ventaCents.total,'1210.01');
  const pdf=require('../utils/pdfGenerator');
  const buffer=await pdf.generarFacturaGenerica(ventaCents,detalleCents);
  const output=path.resolve(__dirname,'../../output/pdf'); fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'preprod-factura-b-centavos.pdf'),buffer);
  const text=(await require('pdf-parse')(buffer)).text; assert.match(text,/1[.,]210,01/);
  log('OK HTTP pedido → venta + PDF B con centavos');
  const [[fractionStockBefore]]=await pool.query('SELECT stock_actual FROM productos WHERE id=?',[producto.id]);
  const fractionBody={...body,operacion_id:crypto.randomUUID(),descuentoAplicado:null,
    subtotalSinIva:2333.29,ivaTotal:489.99,totalConIva:2823.28,
    productos:[{...body.productos[0],precio:'1000.123456',cantidad:'2.333',subtotal:2333.29,iva:489.99}]};
  const fractional=await post('/directa',fractionBody);
  const [[fractionLine]]=await pool.query('SELECT cantidad,precio,subtotal,IVA FROM ventas_cont WHERE venta_id=?',[fractional.data.ventaId]);
  assert.equal(fractionLine.cantidad,'2.333'); assert.equal(fractionLine.precio,'1000.123456');
  assert.equal(fractionLine.subtotal,'2333.29'); assert.equal(fractionLine.IVA,'489.99');
  const [[fractionStockAfter]]=await pool.query('SELECT stock_actual FROM productos WHERE id=?',[producto.id]);
  assert.equal(Math.round((Number(fractionStockBefore.stock_actual)-Number(fractionStockAfter.stock_actual))*1000),2333);
  const [[fractionRemito]]=await pool.query('SELECT cantidad FROM detalle_remitos WHERE remito_id=?',[fractional.data.remitoId]);
  assert.equal(fractionRemito.cantidad,'2.333');
  const [[beforeInvalid]]=await pool.query('SELECT COUNT(*) n FROM ventas');
  const invalid=await fetch(`http://127.0.0.1:${server.address().port}/directa`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...body,operacion_id:crypto.randomUUID(),descuentoAplicado:{tipo:'porcentaje',valor:101}})});
  assert.equal(invalid.status,422);
  const [[afterInvalid]]=await pool.query('SELECT COUNT(*) n FROM ventas'); assert.equal(beforeInvalid.n,afterInvalid.n);
  const conflict=await fetch(`http://127.0.0.1:${server.address().port}/directa`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...body,descuentoAplicado:{tipo:'porcentaje',valor:20}})});
  assert.equal(conflict.status,409);
  log('OK precisión precio/cantidad/stock/remito, rechazo de cálculo inválido y conflicto de intención');



  const { transformarAFormatoARCA } = await import('../arca-microservice/utils/formatters.js');
  const solicitud = { ...payloadCalculo(calculo), tipoComprobante:1, puntoVenta:4, numeroComprobante: 90000000 + id, fecha:20261201, cliente:{tipoDocumento:80,numeroDocumento:'20111111112',condicionIVA:1} };
  const fiscal = transformarAFormatoARCA(solicitud,solicitud.numeroComprobante,4);
  assert.equal(fiscal.ImpTotal,1089); assert.equal(fiscal.ImpNeto,900); assert.equal(fiscal.ImpIVA,189);
  assert.throws(()=>transformarAFormatoARCA({...solicitud,impTotal:'1090.00'},solicitud.numeroComprobante,4));
  const fiscalV2=require('../services/fiscalV2');
  const conn=await pool.getConnection();
  const [intento]=await conn.query("INSERT INTO arca_solicitudes_log(venta_id,request_data,estado) VALUES (?,?,'EN_PROCESO')",[id,JSON.stringify(solicitud)]);
  const respuesta={autorizacion:{cae:String(70000000000000+id),fechaVencimiento:'20261211',resultado:'A'},datosARCA:fiscal};
  const coordinator=require('../services/arcaSeriesCoordinator');
  const serieClave=`TEST_CONEXIONES:${id}`;
  await conn.beginTransaction();
  await coordinator.reservarSerie(conn,{serieClave,intentoId:intento.insertId});
  await conn.commit();
  const params={venta,ventaId:id,intentoId:intento.insertId,respuesta,solicitud,serieClave};
  // Caída antes del commit: nada queda parcialmente autorizado.
  await conn.beginTransaction(); await fiscalV2.persistirAutorizacionNormal(conn,params); await conn.rollback();
  const [[antes]]=await conn.query('SELECT cae_id,autorizacion_id FROM ventas WHERE id=?',[id]);
  assert.equal(antes.autorizacion_id,null); assert.ok(!antes.cae_id);
  const [[serieAntes]]=await conn.query('SELECT * FROM arca_series_estado WHERE serie_clave=?',[serieClave]);
  assert.equal(serieAntes.estado,'EN_CURSO');
  assert.equal(Number(serieAntes.intento_activo_id),intento.insertId);
  await conn.beginTransaction(); await fiscalV2.persistirAutorizacionNormal(conn,params); await conn.commit();
  const [[serieDespues]]=await conn.query('SELECT * FROM arca_series_estado WHERE serie_clave=?',[serieClave]);
  assert.equal(serieDespues.estado,'LIBRE');
  const { fetchProyeccion,FECHA_REPORTE_SQL }=require('../consultas/proyeccion');
  const { libroIvaRevision }=require('../consultas/vistas');
  // Fecha legacy incorrecta: no debe mover una autorización acreditada de diciembre a noviembre.
  await conn.query("UPDATE ventas SET fecha='2026-11-03',fecha_fiscal='2026-11-03' WHERE id=?",[id]);
  const rows=await fetchProyeccion({connection:conn,where:`v.id=? AND ${FECHA_REPORTE_SQL} BETWEEN ? AND ?`,params:[id,'2026-12-01','2026-12-31']});
  assert.equal(rows.length,1); assert.equal(rows[0].fecha_fiscal_acreditada,'2026-12-01');
  const libro=libroIvaRevision(rows); assert.equal(libro.acreditados.length,1); assert.equal(libro.totalesAcreditados.total,'1089.00');
  assert.equal((await fetchProyeccion({connection:conn,where:`v.id=? AND ${FECHA_REPORTE_SQL} BETWEEN ? AND ?`,params:[id,'2026-11-01','2026-11-30']})).length,0);
  log('OK formatter real + autorización normal transaccional + libro IVA por fecha acreditada');
  const [[stockAntesNota]]=await pool.query('SELECT stock_actual FROM productos WHERE id=?',[producto.id]);
  const notaBody={...body,tipoNota:'NOTA_CREDITO',tipo_nc:'AJUSTE_PRECIO',ventaReferenciaId:id,operacion_id:crypto.randomUUID(),
    subtotalSinIva:100,ivaTotal:21,totalConIva:121,descuentoAplicado:null,
    productos:[{...body.productos[0],precio:100,subtotal:100,iva:21}]};
  const nota=await post('/nota',notaBody);
  const [[notaGuardada]]=await pool.query('SELECT * FROM ventas WHERE id=?',[nota.data.notaId]);
  const [notaLineas]=await pool.query('SELECT * FROM ventas_cont WHERE venta_id=?',[nota.data.notaId]);
  validarDocumento(notaGuardada,notaLineas,await cargarCalculo(pool,notaGuardada.id));
  assert.equal(notaGuardada.total,'121.00');
  assert.equal((await post('/nota',notaBody)).data.notaId,nota.data.notaId);
  const [[stockDespuesNota]]=await pool.query('SELECT stock_actual FROM productos WHERE id=?',[producto.id]);
  assert.equal(stockAntesNota.stock_actual,stockDespuesNota.stock_actual);
  log('OK HTTP NC ajuste de precio: cálculo, referencia, reintento y sin devolución de stock');

  // PDF fiscal B real con autorización simulada: QR local, sin HTTP externo.
  const bCalculo = await cargarCalculo(conn,ventaCents.id);
  const bSolicitud={...solicitud,...payloadCalculo(bCalculo),tipoComprobante:6,numeroComprobante:90000000+ventaCents.id,
    cliente:{tipoDocumento:99,numeroDocumento:'0',condicionIVA:5}};
  const bDatos=transformarAFormatoARCA(bSolicitud,bSolicitud.numeroComprobante,4);
  const [bi]=await conn.query("INSERT INTO arca_solicitudes_log(venta_id,request_data,estado) VALUES (?,?,'EN_PROCESO')",[ventaCents.id,JSON.stringify(bSolicitud)]);
  await conn.beginTransaction();
  await fiscalV2.persistirAutorizacionNormal(conn,{venta:ventaCents,ventaId:ventaCents.id,intentoId:bi.insertId,
    solicitud:bSolicitud,respuesta:{autorizacion:{cae:String(70000000000000+ventaCents.id),fechaVencimiento:'20261211',resultado:'A'},datosARCA:bDatos}});
  await conn.commit();
  const [[bAutorizada]]=await conn.query('SELECT * FROM ventas WHERE id=?',[ventaCents.id]);
  pdf.generarQRDesdeARCA=pdf.generarQRLocal.bind(pdf);
  const bPdf=await pdf.generarFacturaARCA(bAutorizada,detalleCents);
  fs.writeFileSync(path.join(output,'preprod-factura-b-centavos.pdf'),bPdf);
  assert.match((await require('pdf-parse')(bPdf)).text,/1[.,]210,01/);
  const libroResponse=await fetch(`http://127.0.0.1:${server.address().port}/libro`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mes:12,anio:2026})});
  assert.equal(libroResponse.status,200);
  const libroPdf=Buffer.from(await libroResponse.arrayBuffer());
  fs.writeFileSync(path.join(output,'preprod-libro-iva.pdf'),libroPdf);
  const libroText=(await require('pdf-parse')(libroPdf)).text;
  assert.ok(!libroText.includes('AUTORIZADOS CONCILIADOS'));
  assert.ok(!libroText.includes('PENDIENTES'));
  assert.ok(!libroText.includes('[PROV]'));
  assert.match(libroText,/01\/12\/2026/);
  assert.ok(!libroText.includes('30/11/2026'));
  assert.ok(libroText.includes(process.env.AFIP_CUIT));
  assert.ok(libroText.includes(bAutorizada.numero_factura));
  // El reporte gerencial debe usar exactamente el mismo corte temporal.
  const {readReport}=require('../reportes/repository');
  const {period}=require('../reportes/period');
  const raw=await readReport(conn,period({desde:'2026-12-01',hasta:'2026-12-31'}));
  assert.equal(raw.documents.find(r=>r.id===id).fecha_fiscal,'2026-12-01');
  assert.ok(raw.lines.some(l=>l.venta_id===id));
  log('OK PDF fiscal B, QR local, libro IVA HTTP y fechas compartidas con reportes');
  conn.release();
  log('OK conexiones finales MySQL/HTTP');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{ if(server) await new Promise(r=>server.close(r)); await pool.end(); });
