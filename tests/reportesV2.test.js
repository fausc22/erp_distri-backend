const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
const { cents, decimal } = require('../reportes/money');
const { createSnapshotStore } = require('../reportes/snapshots');
const { htmlReport } = require('../reportes/pdf');
const { document, line, fixture } = require('./fixtures/reportesV2');
const p = period({ desde: '2026-11-01', hasta: '2026-11-30' });
const build = (raw) => buildReport(raw, p, '2026-11-30T15:00:00Z');
test('total real incluye fletes; las dimensiones y la partición concilian', () => {
  const d = build(fixture());
  assert.equal(d.resumen.total, '363.00');
  assert.equal(d.resumen.normal, '121.00');
  assert.equal(d.resumen.flete, '242.00');
  assert.equal(d.resumen.ticket_factura, '181.50');
  assert.equal(d.conciliacion.libro_iva, '363.00');
  assert.equal(d.conciliacion.comercial, '300.00');
  assert.ok(Object.values(d.conciliacion.controles).every(Boolean));
});
test('factura mixta se clasifica completa como flete; descuentos no se recalculan', () => {
  const raw = fixture();
  raw.documents = [
    document(1, {
      lineas: 2,
      fletes: 1,
      total: '330.00',
      subtotal: '300.00',
      iva_total: '63.00',
      neto_lineas: '300.00',
      iva_lineas: '63.00',
    }),
  ];
  raw.lines[1].venta_id = 1;
  const d = build(raw);
  assert.equal(d.resumen.flete, '330.00');
  assert.equal(d.resumen.normal, '0.00');
  assert.equal(d.productos_totales.ajuste_cabeceras, '-33.00');
  assert.equal(d.productos_totales.total_lineas, '363.00');
  assert.ok(d.alertas.some((a) => a.codigo === 'DIFERENCIA_CABECERA_LINEAS'));
});
test('notas heredan referencia, vendedor y clasificación; flete neto negativo es válido', () => {
  const raw = fixture();
  raw.documents = [
    document(3, {
      tipo_doc: 'NOTA_CREDITO',
      referencia_id: 2,
      referencia_empleado_id: 2,
      referencia_empleado_nombre: 'Martín',
      referencia_lineas: 1,
      referencia_fletes: 1,
    }),
  ];
  raw.lines = [line(3, { producto_nombre: 'Ajuste' })];
  const d = build(raw);
  assert.equal(d.resumen.total, '-121.00');
  assert.equal(d.resumen.flete, '-121.00');
  assert.equal(d.resumen.facturas, 0);
  assert.equal(d.resumen.notas_credito, 1);
  assert.equal(d.resumen.ticket_factura, null);
  assert.equal(d.vendedores[0].nombre, 'Martín');
  assert.equal(d.productos[0].cantidad, '-1.0');
});
test('sin detalle y notas sin referencia permanecen en el total como pendientes', () => {
  const raw = fixture();
  raw.documents = [
    document(1, { lineas: null, neto_lineas: null, iva_lineas: null }),
    document(2, { tipo_doc: 'NOTA_DEBITO' }),
  ];
  raw.lines = [line(2)];
  const d = build(raw);
  assert.equal(d.resumen.total, '242.00');
  assert.equal(d.resumen.pendiente, '242.00');
  assert.equal(d.conciliacion.clasificacion_completa, false);
});
test('más de 50 grupos, mismo nombre distintos IDs, clientes no se duplican entre ciudades', () => {
  const raw = fixture();
  raw.documents = Array.from({ length: 65 }, (_, i) =>
    document(i + 1, {
      empleado_id: i + 1,
      cliente_ciudad: `Ciudad ${i}`,
      total: '0.11',
      subtotal: '0.10',
      iva_total: '0.01',
      neto_lineas: '0.10',
      iva_lineas: '0.01',
    })
  );
  raw.lines = raw.documents.map((r) =>
    line(r.id, { producto_id: r.id, subtotal: '0.10', iva: '0.01' })
  );
  const d = build(raw);
  assert.equal(d.resumen.total, '7.15');
  assert.equal(d.resumen.clientes, 1);
  assert.equal(d.vendedores.length, 65);
  assert.equal(d.ciudades.length, 65);
  assert.equal(d.productos.length, 65);
});
test('imputación fiscal y comercial se concilian por documento y período', () => {
  const raw = fixture();
  raw.documents[0].fecha_comercial = '2026-10-31';
  raw.documents.push(document(4, { estado: 'Anulada', tipo_f: 'A' }));
  const d = build(raw);
  assert.equal(d.resumen.total, '363.00');
  assert.equal(d.conciliacion.libro_iva, '484.00');
  assert.equal(d.conciliacion.diferencia_iva, '-121.00');
  assert.equal(d.conciliacion.comercial, '200.00');
  assert.equal(
    d.conciliacion.documentos.find((r) => r.id === 4).en_reporte,
    false
  );
});
test('compras anuladas no se restan; transferencias no inflan ingresos externos', () => {
  const raw = fixture();
  raw.purchases = [
    { id: 1, total: '100.00', estado: 'Anulada' },
    { id: 2, total: '50.00', estado: 'Confirmada' },
  ];
  raw.expenses = [{ id: 1, monto: '10.00' }];
  raw.movements = [
    {
      id: 1,
      cuenta_id: 1,
      cuenta: 'Banco',
      tipo: 'INGRESO',
      origen: 'venta',
      monto: '100.00',
    },
    {
      id: 2,
      cuenta_id: 1,
      cuenta: 'Banco',
      tipo: 'EGRESO',
      origen: 'transferencia',
      monto: '80.00',
    },
    {
      id: 3,
      cuenta_id: 2,
      cuenta: 'Caja',
      tipo: 'INGRESO',
      origen: 'transferencia',
      monto: '80.00',
    },
  ];
  const d = build(raw);
  assert.equal(d.resultado.diferencia, '303.00');
  assert.equal(d.resultado.ganancia, null);
  assert.equal(d.caja.ingresos, '100.00');
  assert.equal(d.caja.variacion, '100.00');
  assert.equal(d.caja.egresos, '0.00');
  assert.equal(d.caja.saldo_final, null);
});
test('dinero exacto y valores inválidos nunca convertidos silenciosamente a cero', () => {
  assert.equal(
    decimal(cents('99999999999999.99') + cents('0.01')),
    '100000000000000.00'
  );
  assert.throws(() => cents(null));
  assert.throws(() => cents('1.001'));
  const raw = fixture();
  raw.documents[0].total = null;
  assert.throws(() => build(raw));
});
test('fechas estrictas, límites y filtros sin soporte', () => {
  assert.throws(() => period({ desde: '2026-02-30', hasta: '2026-03-01' }));
  assert.throws(() => period({ desde: '2026-11-02', hasta: '2026-11-01' }));
  assert.throws(() =>
    period({ desde: '2026-11-01', hasta: '2026-11-30', empleado_id: 1 })
  );
  assert.equal(p.fin_exclusivo, '2026-12-01');
  assert.equal(p.anterior.desde, '2026-10-02');
});
test('snapshot inmutable, aislado por usuario, caducidad y memoria acotada', () => {
  let time = 0;
  const store = createSnapshotStore({
    now: () => time,
    ttl: 1000,
    maxEntries: 1,
  });
  const d = store.put(1, build(fixture()));
  d.resumen.total = 'ERROR';
  assert.equal(store.get(1, d.snapshot_id).resumen.total, '363.00');
  assert.throws(
    () => store.get(2, d.snapshot_id),
    (e) => e.status === 410
  );
  time = 1001;
  assert.throws(
    () => store.get(1, d.snapshot_id),
    (e) => e.status === 410
  );
  time = 0;
  const old = store.put(1, { test: true });
  store.put(1, { test: false });
  assert.throws(() => store.get(1, old.snapshot_id));
  assert.throws(
    () => createSnapshotStore({ maxBytes: 1 }).put(1, { x: 1 }),
    (e) => e.status === 413
  );
});
test('PDF gerencial usa cifras de cabecera y no incluye texto de auditoría', () => {
  const d = build(fixture());
  d.vendedores[0].nombre = '<script>alert(1)</script>';
  const html = htmlReport(d);
  assert.ok(html.includes('$ 363,00'));
  assert.ok(html.includes('$ 242,00'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('Pendiente de clasificación'));
  assert.ok(!html.includes('Reglas y trazabilidad'));
  assert.ok(!html.includes('Excepciones de integridad'));
  assert.ok(!html.includes('Lectura del período'));
  assert.ok(!html.includes('Conciliación con listados'));
});
test('periodos comparacion y anual se resuelven sin migraciones', () => {
  const { resolveReportRequest } = require('../reportes/period');
  const { htmlComparison, htmlAnnual, htmlForPayload } = require('../reportes/pdf');
  const comp = resolveReportRequest({
    tipo: 'comparacion',
    meses: '2026-01,2026-03,2026-09',
  });
  assert.equal(comp.tipo, 'comparacion');
  assert.equal(comp.periodos.length, 3);
  assert.equal(comp.periodos[0].desde, '2026-01-01');
  assert.equal(comp.periodos[0].hasta, '2026-01-31');
  const anual = resolveReportRequest({ tipo: 'anual', anio: '2026' });
  assert.equal(anual.tipo, 'anual');
  assert.equal(anual.periodo.desde, '2026-01-01');
  assert.equal(anual.periodo.hasta, '2026-12-31');
  const base = build(fixture());
  const htmlComp = htmlComparison({
    tipo: 'comparacion',
    periodos: [
      { ...base, periodo: { ...base.periodo, mes: '2026-01', desde: '2026-01-01', hasta: '2026-01-31' } },
      { ...base, periodo: { ...base.periodo, mes: '2026-03', desde: '2026-03-01', hasta: '2026-03-31' } },
      { ...base, periodo: { ...base.periodo, mes: '2026-09', desde: '2026-09-01', hasta: '2026-09-30' } },
    ],
  });
  assert.ok(htmlComp.includes('Comparación de tres meses'));
  assert.ok(htmlComp.includes('Enero 2026'));
  assert.ok(!htmlComp.includes('Reglas y trazabilidad'));
  const htmlAn = htmlAnnual({ ...base, tipo: 'anual', anio: '2026' });
  assert.ok(htmlAn.includes('Cierre anual 2026'));
  assert.equal((htmlAn.match(/Enero 2026|Febrero 2026|Marzo 2026|Abril 2026|Mayo 2026|Junio 2026|Julio 2026|Agosto 2026|Septiembre 2026|Octubre 2026|Noviembre 2026|Diciembre 2026/g) || []).length, 12);
  assert.equal(htmlForPayload({ ...base, tipo: 'anual', anio: '2026' }).includes('Cierre anual'), true);
});
test('período vacío no inventa tickets, ganancias ni saldos', () => {
  const d = build({
    documents: [],
    lines: [],
    purchases: [],
    expenses: [],
    movements: [],
  });
  assert.equal(d.resumen.total, '0.00');
  assert.equal(d.resumen.ticket_factura, null);
  assert.equal(d.resultado.ganancia, null);
  assert.equal(d.caja.saldo_inicial, null);
});
test('no se presenta un período abierto como una caída comparable', () => {
  const d = buildReport(fixture(), p, '2026-11-02T12:00:00Z');
  assert.equal(d.comparacion.comparable, false);
  assert.equal(d.comparacion.porcentaje, null);
  assert.equal(d.comparacion.diferencia, null);
  const closed = buildReport(fixture(), p, '2026-12-01T12:00:00Z');
  assert.equal(closed.comparacion.comparable, true);
  assert.equal(closed.comparacion.diferencia, '363.00');
});
test('nombres nulos no desaparecen y vendedor distinto de Martín genera control, no reclasificación', () => {
  const raw = fixture();
  raw.documents[0].sin_nombre = 1;
  raw.lines[0].producto_nombre = null;
  raw.documents[1].empleado_nombre = 'Otro vendedor';
  const d = build(raw);
  assert.equal(d.resumen.pendiente, '121.00');
  assert.equal(d.resumen.flete, '242.00');
  assert.ok(d.alertas.some((r) => r.codigo === 'FLETE_REVISAR_VENDEDOR'));
});
test('IVA 21, 10.5, cero y tipo X conservan importes guardados, con descuentos', () => {
  const raw = fixture();
  raw.documents = [
    document(1, {
      subtotal: '90.00',
      iva_total: '18.90',
      total: '108.90',
      neto_lineas: '90.00',
      iva_lineas: '18.90',
    }),
    document(2, {
      tipo_f: 'B',
      subtotal: '100.00',
      iva_total: '10.50',
      total: '110.50',
      neto_lineas: '100.00',
      iva_lineas: '10.50',
    }),
    document(3, {
      tipo_f: 'X',
      subtotal: '121.00',
      iva_total: '0.00',
      total: '121.00',
      neto_lineas: '121.00',
      iva_lineas: '0.00',
    }),
    document(4, {
      subtotal: '100.00',
      iva_total: '0.00',
      total: '100.00',
      neto_lineas: '100.00',
      iva_lineas: '0.00',
    }),
  ];
  raw.lines = raw.documents.map((r) =>
    line(r.id, { subtotal: r.subtotal, iva: r.iva_total })
  );
  const d = build(raw);
  assert.equal(d.resumen.total, '440.40');
  assert.equal(d.resumen.ab, '319.40');
  assert.equal(d.resumen.x, '121.00');
  assert.equal(d.resumen.iva, '29.40');
  assert.equal(d.conciliacion.comercial, '411.00');
  assert.equal(d.productos_totales.ajuste_cabeceras, '0.00');
});
test('participaciones utilizan el universo global y no un ranking limitado', () => {
  const d = build(fixture());
  assert.equal(d.vendedores[0].porcentaje_total, '66.67');
  assert.equal(d.ciudades[0].porcentaje_total, '100.00');
});
