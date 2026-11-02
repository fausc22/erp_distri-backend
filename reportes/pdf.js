const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
const money = (value) => {
  if (value == null) return 'No disponible';
  const [whole, frac = '00'] = String(value).split('.');
  return `$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac.padEnd(2, '0')}`;
};
function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Sin operaciones en este período</td></tr>`}</tbody></table>`;
}
function htmlReport(d) {
  const s = d.resumen;
  const cells = [
    ['Facturación total', s.total],
    ['Documentos normales', s.normal],
    ['Documentos con flete', s.flete],
    ['Pendiente de clasificación', s.pendiente],
  ];
  const comparison = d.comparacion;
  const warnings = d.alertas;
  const differences = d.conciliacion.documentos.filter(
    (r) =>
      r.en_reporte !== r.en_libro ||
      !r.en_listado ||
      r.fecha !== r.fecha_comercial
  );
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>VERTIMAR - Reporte gerencial ${esc(d.periodo.desde)} al ${esc(d.periodo.hasta)}</title><style>
    *{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#172638;margin:0;line-height:1.5}
    h1{font-size:26px;line-height:1.2;margin:8px 0}h2{font-size:17px;margin:22px 0 9px;color:#124d5a;break-after:avoid}h3{font-size:12px;margin:14px 0 5px;break-after:avoid}
    .brand{font-size:10px;letter-spacing:2px;color:#207686;font-weight:bold}.muted{color:#536677}.lead{font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.metric{padding:15px;border:1px solid #c9dbe1;border-radius:8px;background:#f3f8fa;break-inside:avoid}.metric strong{display:block;font-size:22px;margin-top:5px}.metric span{font-size:10px;text-transform:uppercase;letter-spacing:.5px}.note{padding:12px;background:#fff5dd;border-left:3px solid #d59b2b;margin:12px 0;break-inside:avoid}.good{background:#ecf7f1;border-color:#218857}.page{break-before:page}
    table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:9px;table-layout:auto}th{background:#183e4a;color:white;text-align:left;font-size:9px}td,th{padding:7px 6px;border-bottom:1px solid #dce5e9;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}tbody tr:nth-child(even){background:#f4f7f8}ul{padding-left:18px}li{margin:5px 0;break-inside:avoid}.small{font-size:9px;overflow-wrap:anywhere}
  </style></head><body>
  <div class="brand">VERTIMAR / INFORMACIÓN PARA GERENCIA</div><h1>Reporte financiero</h1>${d.demo ? '<div class="note">EJEMPLO DE VALIDACIÓN · DATOS SINTÉTICOS</div>' : ''}
  <div class="lead">${esc(d.periodo.desde)} al ${esc(d.periodo.hasta)} · Importes en pesos argentinos</div>
  <p class="muted">Fecha fiscal con respaldo en los importes guardados de cada comprobante. Incluye notas de débito y descuenta notas de crédito.</p>
  <div class="grid">${cells.map(([label, v]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(money(v))}</strong></div>`).join('')}</div>
  <div class="note ${d.conciliacion.clasificacion_completa ? 'good' : ''}">${d.conciliacion.clasificacion_completa ? 'Clasificación completa. Total = normales + documentos con flete.' : `${s.documentos_pendientes} documentos pendientes. Total = normales + fletes + pendientes. No se certifica la separación completa.`} Conciliación aritmética: meses, vendedores, ciudades y detalle coinciden.</div>
  ${table(['Facturas', 'Notas débito', 'Notas crédito', 'Ticket de factura'], [[s.facturas, s.notas_debito, s.notas_credito, money(s.ticket_factura)]])}
  ${table(['A/B · total final', 'X · total final', 'Otros tipos', 'Neto guardado', 'IVA guardado'], [[money(s.ab), money(s.x), money(s.otros), money(s.neto), money(s.iva)]])}
  <h2>Lectura del período</h2><ul>${d.comentarios.map((c) => `<li>${esc(c)}</li>`).join('') || '<li>Sin excepciones detectadas por los controles disponibles.</li>'}</ul>
  <h3>Comparación de igual cantidad de días</h3>
  <p>Anterior: ${esc(comparison.periodo.desde)} al ${esc(comparison.periodo.hasta)}: <b>${esc(money(comparison.resumen.total))}</b>.
  Diferencia: <b>${esc(money(comparison.diferencia))}</b>. Variación: ${comparison.porcentaje == null ? (comparison.comparable ? 'no calculable con base anterior no positiva' : 'no disponible en período abierto') : esc(comparison.porcentaje) + '%'}.</p>
  <p class="small muted">${esc(comparison.criterio)}</p>
  <div class="page"></div><h2>Evolución de la facturación</h2>
  ${table(
    [
      'Mes',
      'Total',
      'Normales',
      'Con flete',
      'Pendientes',
      'Facturas / ND / NC',
    ],
    d.meses.map((r) => [
      r.nombre,
      money(r.total),
      money(r.normal),
      money(r.flete),
      money(r.pendiente),
      `${r.facturas} / ${r.notas_debito} / ${r.notas_credito}`,
    ])
  )}
  <h2>Vendedores · facturación final</h2><p class="small">Todos los vendedores; notas imputadas a la factura original cuando existe referencia.</p>
  ${table(
    ['Vendedor', 'Documentos', 'Total', 'Normales', 'Con flete', 'Pendientes'],
    d.vendedores.map((r) => [
      r.nombre,
      r.documentos,
      money(r.total),
      money(r.normal),
      money(r.flete),
      money(r.pendiente),
    ])
  )}
  <h2>Ciudades · primeras 10 por facturación neta</h2><p class="small">Universo completo: ${d.ciudades.length} ciudades. Facturación global: ${esc(money(s.total))}. El ranking no se usa para calcular totales.</p>
  ${table(
    ['Ciudad / provincia', 'Documentos', 'Clientes con ID', 'Facturación'],
    d.ciudades
      .slice(0, 10)
      .map((r) => [r.nombre, r.documentos, r.clientes, money(r.total)])
  )}
  <h2>Productos · primeras 10 filas por cantidad</h2><p class="small">Comparar cantidades solo dentro de la misma unidad. Incluye fletes y devoluciones. Importes de líneas guardados, sin distribuir ajustes globales.</p>
  ${table(
    ['Producto', 'Unidad', 'Cantidad', 'Neto', 'IVA'],
    d.productos
      .slice(0, 10)
      .map((r) => [r.nombre, r.unidad, r.cantidad, money(r.neto), money(r.iva)])
  )}
  <p>Total de todas las líneas: ${esc(money(d.productos_totales.total_lineas))}. Ajustes/diferencias contra cabeceras: ${esc(money(d.productos_totales.ajuste_cabeceras))}. Facturación: ${esc(money(s.total))}.</p>
  <h2>Compras, gastos y movimientos de fondos</h2>
  ${table(['Facturación', 'Compras registradas/confirmadas', 'Gastos', 'Diferencia'], [[money(s.total), money(d.resultado.compras), money(d.resultado.gastos), money(d.resultado.diferencia)]])}
  <div class="note">${esc(d.resultado.motivo)}</div>
  ${table(
    [
      'Cuenta',
      'Ingresos externos',
      'Egresos externos',
      'Transfer. entrada',
      'Transfer. salida',
      'Variación',
    ],
    d.caja.cuentas.map((r) => [
      r.nombre,
      money(r.ingresos),
      money(r.egresos),
      money(r.transferencias_entrada),
      money(r.transferencias_salida),
      money(r.variacion),
    ])
  )}
  <p>Variación de fondos: ${esc(money(d.caja.variacion))}. No equivale al saldo final de las cuentas; el saldo inicial no está certificado.</p>
  <h2>Conciliación con listados existentes</h2>
  ${table(['A/B en reporte', 'Libro IVA A/B', 'Diferencia', 'Listado comercial'], [[money(s.ab), money(d.conciliacion.libro_iva), money(d.conciliacion.diferencia_iva), money(d.conciliacion.comercial)]])}
  <p class="small">Libro IVA y listado comercial tienen distinto universo, fechas y bases. El listado comercial usa subtotal para A/B y total para otras letras. La pantalla contiene la conciliación de todos los comprobantes.</p>
  ${table(
    ['Vendedor · criterio comercial', 'Documentos', 'Importe comercial'],
    d.conciliacion.vendedores_comerciales.map((r) => [
      r.nombre,
      r.documentos,
      money(r.total),
    ])
  )}
  <h2>Excepciones de integridad (${warnings.length})</h2><p class="small">Se muestran hasta 50 alertas, priorizando las que requieren revisión. Diferencias de hasta $1 se señalan como informativas; no se alteran los importes. El detalle completo está disponible en pantalla.</p>
  ${table(
    ['Control', 'Cantidad'],
    d.alertas_resumen.map((r) => [r.descripcion, r.cantidad])
  )}
  ${table(
    ['Comprobante / ID', 'Control', 'Importe final', 'Ajuste líneas'],
    warnings
      .slice(0, 50)
      .map((r) => [
        `${r.numero} / ${r.documento_id}`,
        r.descripcion + ' · ' + r.nivel,
        money(r.importe),
        money(r.diferencia),
      ])
  )}
  <h2>Diferencias de alcance y fechas (${differences.length})</h2><p class="small">Primeros 50 comprobantes por ID; conciliación completa disponible en pantalla. Los documentos X aparecen por estar fuera del libro IVA, no necesariamente por un error.</p>
  ${table(
    ['Comprobante / ID', 'Reporte', 'Libro IVA', 'Comercial', 'Motivos'],
    differences
      .slice(0, 50)
      .map((r) => [
        `${r.numero} / ${r.id}`,
        money(r.reporte),
        money(r.libro),
        money(r.comercial),
        r.razones.join('; '),
      ])
  )}
  <div style="break-inside:avoid"><h2>Reglas y trazabilidad</h2><ol>${d.metodologia.map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
  <p class="small muted">Generado: ${esc(d.generado_en)} · Versión de cálculo ${esc(d.version)} · Identificador ${esc(d.snapshot_id)}. Este documento conserva la versión de datos vista en pantalla al solicitarlo.</p></div>
  </body></html>`;
}
async function renderPDF(data) {
  const puppeteer = require('puppeteer');
  const fs = require('fs');
  const paths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const executablePath = paths.find((p) => p && fs.existsSync(p));
  const browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) =>
      req.url().startsWith('about:') ? req.continue() : req.abort()
    );
    await page.setContent(htmlReport(data), { waitUntil: 'load' });
    return Buffer.from(
      await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font:8px Arial;width:100%;text-align:center;color:#607080">VERTIMAR · Reporte gerencial · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      })
    );
  } finally {
    await browser.close();
  }
}
module.exports = { htmlReport, renderPDF, money };
