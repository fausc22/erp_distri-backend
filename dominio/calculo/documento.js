const { centsToString } = require('./decimal');

function centavos(value) {
  const text = String(value ?? '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Importe monetario inválido: ${text}`);
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0')));
}
function aplicarLineas(productos, resolucion) {
  if (!resolucion?.usarMotor) return productos;
  if (productos.length !== resolucion.lineasOrdenadas.length) throw new Error('Detalle no coincide con motor');
  return productos.map((p, i) => {
    const l = resolucion.lineasOrdenadas[i];
    return { ...p, subtotal: centsToString(l.neto), IVA: centsToString(l.iva), iva: centsToString(l.iva) };
  });
}
function validarVistaPrevia(resolucion, totalMostrado) {
  if (!resolucion?.usarMotor) return;
  if (centavos(totalMostrado) !== BigInt(resolucion.resultado.totales.total)) {
    const err = new Error(`La vista previa no coincide con el cálculo del servidor. Total correcto: ${resolucion.importes.total_str}. Actualice la pantalla antes de confirmar.`);
    err.statusCode = 422; err.code = 'PREVIEW_DESACTUALIZADA'; throw err;
  }
}
/**
 * Cálculo autoritativo (venta_calculos) — desconectado.
 * La vía operativa usa cabecera persistida; no exige migraciones M013+.
 */
async function cargarCalculo(_connection, _ventaId) {
  return null;
}
function validarDocumento(venta, productos, calculo) {
  if (!calculo) return;
  const t = calculo.totales;
  if (centavos(venta.subtotal) !== BigInt(t.neto) || centavos(venta.iva_total) !== BigInt(t.iva) || centavos(venta.total) !== BigInt(t.total)) {
    throw new Error('Cabecera diferente del cálculo guardado; emisión bloqueada');
  }
  const neto = productos.reduce((a,p) => a + centavos(p.subtotal), 0n);
  const iva = productos.reduce((a,p) => a + centavos(p.iva ?? p.IVA), 0n);
  if (neto !== BigInt(t.neto) || iva !== BigInt(t.iva)) throw new Error('Detalle diferente del cálculo guardado; emisión bloqueada');
}
function payloadCalculo(calculo) {
  const t = calculo.totales;
  return {
    reglaCalculo: 'v1',
    impNeto: centsToString(t.neto), impIVA: centsToString(t.iva), impTotal: centsToString(t.total),
    impOpEx: 0, impTotConc: 0, impTrib: 0,
    ivaCalculado: t.por_alicuota.map(a => ({ Id: a.alicuota_id, BaseImp: centsToString(a.neto), Importe: centsToString(a.iva) }))
  };
}
module.exports = { validarVistaPrevia, centavos, aplicarLineas, cargarCalculo, validarDocumento, payloadCalculo };
