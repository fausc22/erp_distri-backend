const document = (id, overrides = {}) => ({
  id,
  fecha_comercial: '2026-11-10',
  fecha_fiscal: '2026-11-10',
  numero_factura: `PRUEBA-${id}`,
  tipo_doc: 'FACTURA',
  tipo_f: 'A',
  estado: 'Facturada',
  subtotal: '100.00',
  iva_total: '21.00',
  total: '121.00',
  exento: '0.00',
  empleado_id: 1,
  empleado_nombre: 'Vendedor de prueba',
  cliente_id: 1,
  cliente_nombre: 'Cliente de prueba',
  cliente_ciudad: 'Ciudad de prueba',
  cliente_provincia: 'Provincia',
  cuenta_id: 1,
  lineas: 1,
  fletes: 0,
  sin_nombre: 0,
  neto_lineas: '100.00',
  iva_lineas: '21.00',
  ...overrides,
});
const line = (id, overrides = {}) => ({
  id,
  venta_id: id,
  producto_id: 1,
  producto_nombre: 'Producto de prueba',
  producto_um: 'UN',
  cantidad: '1.0',
  subtotal: '100.00',
  iva: '21.00',
  ...overrides,
});
function fixture() {
  return {
    documents: [
      document(1),
      document(2, {
        empleado_id: 2,
        empleado_nombre: 'Martín',
        subtotal: '200.00',
        iva_total: '42.00',
        total: '242.00',
        fletes: 1,
        neto_lineas: '200.00',
        iva_lineas: '42.00',
      }),
    ],
    lines: [
      line(1),
      line(2, {
        producto_id: 2,
        producto_nombre: 'FLETE',
        subtotal: '200.00',
        iva: '42.00',
      }),
    ],
    purchases: [],
    expenses: [],
    movements: [],
  };
}
module.exports = { document, line, fixture };
