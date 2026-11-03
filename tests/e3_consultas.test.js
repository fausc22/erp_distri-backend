/**
 * E3 source-guards + pruebas unitarias sin conexión a base productiva.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calcularHashDocumentos } = require('../services/reportesCortes');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function run() {
  const proyeccion = read('consultas/proyeccion.js');
  const vistas = read('consultas/vistas.js');
  const cortes = read('services/reportesCortes.js');
  const listados = read('services/listadosService.js');
  const alertasRoutes = read('routes/alertasRoutes.js');
  const alertasController = read('controllers/alertasController.js');
  const inicio = read('../frontend/pages/inicio.jsx');

  assert.ok(proyeccion.includes('WITH detalle AS'), 'proyeccion debe agregar líneas en CTE');
  assert.ok(proyeccion.includes('GROUP BY vc.venta_id'), 'detalle debe agruparse por venta antes del join');
  assert.ok(proyeccion.includes('LEFT JOIN detalle d ON d.venta_id = v.id'), 'ventas debe unirse contra detalle agregado');
  assert.ok(proyeccion.includes('v.estado_fiscal IS NOT NULL'), 'estado_fiscal existente debe respetarse');
  assert.ok(proyeccion.includes('fecha_provisional'), 'A/B sin fecha fiscal debe marcar fecha_provisional');

  assert.ok(vistas.includes('totalGerencial'), 'vistas debe exponer totalGerencial');
  assert.ok(vistas.includes('libroIvaRevision'), 'vistas debe exponer libroIvaRevision');
  assert.ok(vistas.includes('seccionPendientes'), 'libro revision debe separar pendientes');

  assert.ok(cortes.includes('hash_contenido'), 'cortes debe calcular hash_contenido');
  assert.ok(cortes.includes('reportes_cortes_documentos'), 'cortes debe persistir snapshot de documentos');
  assert.ok(cortes.includes('cliente_nombre'), 'snapshot debe conservar labels mutables');

  const docsA = [
    { id: 1, cliente_nombre: 'Cliente A', total: 121, generado_en: '2026-11-03T10:00:00Z' },
    { id: 2, cliente_nombre: 'Cliente B', total: 50, nested: { generado_en: 'x', valor: 1 } }
  ];
  const docsB = [
    { id: 1, cliente_nombre: 'Cliente A', total: 121, generado_en: '2026-11-04T10:00:00Z' },
    { id: 2, cliente_nombre: 'Cliente B', total: 50, nested: { generado_en: 'y', valor: 1 } }
  ];
  const docsC = [
    { id: 1, cliente_nombre: 'Cliente Modificado', total: 121, generado_en: '2026-11-04T10:00:00Z' },
    { id: 2, cliente_nombre: 'Cliente B', total: 50, nested: { generado_en: 'y', valor: 1 } }
  ];
  assert.equal(calcularHashDocumentos(docsA), calcularHashDocumentos(docsB), 'generado_en no debe afectar el hash');
  assert.notEqual(calcularHashDocumentos(docsA), calcularHashDocumentos(docsC), 'labels mutables sí forman parte del snapshot hasheado');

  assert.ok(listados.includes('totalCabecera * multiplicador'), 'listado vendedores debe imputar total final');
  assert.ok(!listados.includes("? netoCabecera : totalCabecera"), 'listado vendedores no debe usar subtotal para A/B');

  assert.ok(alertasRoutes.includes("router.get('/fiscales-pendientes'"));
  assert.ok(alertasRoutes.includes('requireManager'), 'alertas fiscales debe exigir gerente');
  assert.ok(alertasController.includes('ALERTAS_FISCALES_ACTIVACION_FECHA'));
  assert.ok(alertasController.includes('72 * 60 * 60 * 1000'));
  assert.ok(alertasController.includes('America/Argentina/Cordoba'));

  assert.ok(inicio.includes("axiosAuth.get('/alertas/fiscales-pendientes')"), 'inicio gerente debe consultar alertas fiscales');
  assert.ok(inicio.includes('alertasFiscales'), 'inicio debe mostrar panel simple de alertas fiscales');

  console.log('✅ e3_consultas.test.js OK');
}

run().catch((error) => {
  console.error('❌ e3_consultas.test.js FAIL', error);
  process.exit(1);
});
