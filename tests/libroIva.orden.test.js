const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  libroIvaRevision,
  compararFilasLibroIva,
  parseNumeroComprobanteLibro
} = require('../consultas/vistas');

test('parsea número de factura y nota para orden numérico', () => {
  assert.deepEqual(parseNumeroComprobanteLibro('A 0004-00001991'), { ptoVta: 4, nro: 1991 });
  assert.deepEqual(parseNumeroComprobanteLibro('0004-00096'), { ptoVta: 4, nro: 96 });
  assert.deepEqual(parseNumeroComprobanteLibro('B 0004-00001988'), { ptoVta: 4, nro: 1988 });
});

test('dentro del mismo día ordena por número ASC, no DESC', () => {
  const filas = [
    { fecha_comercial: '2026-10-31', tipo_doc: 'FACTURA', tipo_f: 'A', numero_factura: 'A 0004-00001991', venta_id: 3 },
    { fecha_comercial: '2026-10-31', tipo_doc: 'FACTURA', tipo_f: 'A', numero_factura: 'A 0004-00001988', venta_id: 1 },
    { fecha_comercial: '2026-10-31', tipo_doc: 'FACTURA', tipo_f: 'A', numero_factura: 'A 0004-00001990', venta_id: 2 }
  ].sort(compararFilasLibroIva);

  assert.deepEqual(
    filas.map((f) => f.numero_factura),
    ['A 0004-00001988', 'A 0004-00001990', 'A 0004-00001991']
  );
});

test('ordena por fecha comercial y dentro del día factura antes que NC, luego número', () => {
  const filas = [
    {
      fecha_comercial: '2026-10-30',
      tipo_doc: 'NOTA_CREDITO',
      tipo_f: 'A',
      numero_factura: '0004-00096',
      venta_id: 10,
      tipo_f_raw: 'A',
      estado_fiscal: 'AUTORIZADO',
      subtotal_firmado: -100,
      iva_firmado: -21,
      total_firmado: -121,
      total: 121,
      subtotal: 100,
      iva_total: 21,
      exento: 0,
      cae_id: '1',
      cae_resultado: 'A'
    },
    {
      fecha_comercial: '2026-10-31',
      tipo_doc: 'FACTURA',
      tipo_f: 'A',
      numero_factura: 'A 0004-00001988',
      venta_id: 11,
      estado_fiscal: 'AUTORIZADO',
      subtotal_firmado: 100,
      iva_firmado: 21,
      total_firmado: 121,
      total: 121,
      subtotal: 100,
      iva_total: 21,
      exento: 0,
      cae_id: '2',
      cae_resultado: 'A'
    },
    {
      fecha_comercial: '2026-10-30',
      tipo_doc: 'FACTURA',
      tipo_f: 'A',
      numero_factura: 'A 0004-00001987',
      venta_id: 9,
      estado_fiscal: 'AUTORIZADO',
      subtotal_firmado: 100,
      iva_firmado: 21,
      total_firmado: 121,
      total: 121,
      subtotal: 100,
      iva_total: 21,
      exento: 0,
      cae_id: '3',
      cae_resultado: 'A'
    },
    {
      fecha_comercial: '2026-10-31',
      tipo_doc: 'FACTURA',
      tipo_f: 'A',
      numero_factura: 'A 0004-00001991',
      venta_id: 12,
      estado_fiscal: 'AUTORIZADO',
      subtotal_firmado: 100,
      iva_firmado: 21,
      total_firmado: 121,
      total: 121,
      subtotal: 100,
      iva_total: 21,
      exento: 0,
      cae_id: '4',
      cae_resultado: 'A'
    }
  ];

  const { acreditados } = libroIvaRevision(filas);
  assert.deepEqual(
    acreditados.map((f) => f.numero_factura),
    ['A 0004-00001987', '0004-00096', 'A 0004-00001988', 'A 0004-00001991']
  );
});
