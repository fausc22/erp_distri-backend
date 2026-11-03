const {
  absorverPendienteResumen,
  absorverPendienteGrupo,
  padMesesAnuales,
  topClientes,
  etiquetaMes,
} = require('./presentacion');

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

const STYLES = `
    *{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#172638;margin:0;line-height:1.5}
    h1{font-size:26px;line-height:1.2;margin:8px 0}h2{font-size:17px;margin:22px 0 9px;color:#124d5a;break-after:avoid}h3{font-size:12px;margin:14px 0 5px;break-after:avoid}
    .brand{font-size:10px;letter-spacing:2px;color:#207686;font-weight:bold}.muted{color:#536677}.lead{font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.metric{padding:15px;border:1px solid #c9dbe1;border-radius:8px;background:#f3f8fa;break-inside:avoid}.metric strong{display:block;font-size:22px;margin-top:5px}.metric span{font-size:10px;text-transform:uppercase;letter-spacing:.5px}.page{break-before:page}
    table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:9px;table-layout:auto}th{background:#183e4a;color:white;text-align:left;font-size:9px}td,th{padding:7px 6px;border-bottom:1px solid #dce5e9;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}tbody tr:nth-child(even){background:#f4f7f8}.small{font-size:9px;overflow-wrap:anywhere}
`;

function shell(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLES}</style></head><body>
  <div class="brand">VERTIMAR / INFORMACIÓN PARA GERENCIA</div>
  ${body}
  </body></html>`;
}

function metricsGrid(cells) {
  return `<div class="grid">${cells
    .map(
      ([label, v]) =>
        `<div class="metric"><span>${esc(label)}</span><strong>${esc(money(v))}</strong></div>`
    )
    .join('')}</div>`;
}

function variationLine(comparison) {
  if (!comparison) return '';
  const pct =
    comparison.porcentaje == null
      ? comparison.comparable
        ? '—'
        : '—'
      : `${comparison.porcentaje}%`;
  return `<p>Período anterior (${esc(comparison.periodo.desde)} al ${esc(comparison.periodo.hasta)}): <b>${esc(money(comparison.resumen.total))}</b>
  · Diferencia: <b>${esc(money(comparison.diferencia))}</b>
  · Variación: <b>${esc(pct)}</b></p>`;
}

function seccionesComunes(d, s) {
  const meses = (d.meses || []).map(absorverPendienteGrupo);
  const vendedores = d.vendedores || [];
  return `
  ${table(['Facturas', 'Notas débito', 'Notas crédito', 'Ticket de factura'], [[s.facturas, s.notas_debito, s.notas_credito, money(s.ticket_factura)]])}
  ${table(['A/B · total final', 'X · total final', 'Otros tipos', 'Neto', 'IVA'], [[money(s.ab), money(s.x), money(s.otros), money(s.neto), money(s.iva)]])}
  ${meses.length > 1 ? `<h2>Evolución de la facturación</h2>${table(
    ['Mes', 'Total', 'Normales', 'Con flete', 'Facturas / ND / NC'],
    meses.map((r) => [
      r.nombre,
      money(r.total),
      money(r.normal),
      money(r.flete),
      `${r.facturas} / ${r.notas_debito} / ${r.notas_credito}`,
    ])
  )}` : ''}
  <h2>Vendedores</h2>
  ${table(
    ['Vendedor', 'Documentos', 'Total'],
    vendedores.map((r) => [r.nombre, r.documentos, money(r.total)])
  )}
  <h2>Ciudades · top 10</h2>
  ${table(
    ['Ciudad / provincia', 'Documentos', 'Clientes', 'Facturación'],
    (d.ciudades || [])
      .slice(0, 10)
      .map((r) => [r.nombre, r.documentos, r.clientes, money(r.total)])
  )}
  <h2>Productos · top 10 por cantidad</h2>
  ${table(
    ['Producto', 'Unidad', 'Cantidad', 'Neto', 'IVA'],
    (d.productos || [])
      .slice(0, 10)
      .map((r) => [r.nombre, r.unidad, r.cantidad, money(r.neto), money(r.iva)])
  )}
  <h2>Compras, gastos y fondos</h2>
  ${table(['Facturación', 'Compras', 'Gastos', 'Diferencia'], [[money(s.total), money(d.resultado.compras), money(d.resultado.gastos), money(d.resultado.diferencia)]])}
  ${table(
    ['Cuenta', 'Ingresos', 'Egresos', 'Transfer. entrada', 'Transfer. salida', 'Variación'],
    (d.caja?.cuentas || []).map((r) => [
      r.nombre,
      money(r.ingresos),
      money(r.egresos),
      money(r.transferencias_entrada),
      money(r.transferencias_salida),
      money(r.variacion),
    ])
  )}
  <p>Variación de fondos: <b>${esc(money(d.caja?.variacion))}</b></p>`;
}

/** PDF mensual / rango único (formato gerencial). */
function htmlReport(d) {
  const s = absorverPendienteResumen(d.resumen);
  const title = `VERTIMAR - Reporte gerencial ${d.periodo.desde} al ${d.periodo.hasta}`;
  const body = `
  <h1>Reporte financiero</h1>
  <div class="lead">${esc(d.periodo.desde)} al ${esc(d.periodo.hasta)} · Importes en pesos argentinos</div>
  ${metricsGrid([
    ['Facturación total', s.total],
    ['Documentos normales', s.normal],
    ['Documentos con flete', s.flete],
  ])}
  ${variationLine(d.comparacion)}
  ${seccionesComunes(d, s)}`;
  return shell(title, body);
}

/** PDF comparación de exactamente 3 meses. */
function htmlComparison(payload) {
  const periodos = payload.periodos || [];
  const labels = periodos.map((p) => etiquetaMes(p.periodo.mes || p.periodo.desde.slice(0, 7)));
  const resumenes = periodos.map((p) => absorverPendienteResumen(p.resumen));
  const title = `VERTIMAR - Comparación ${labels.join(' · ')}`;

  // Vendedores: unión por nombre
  const sellerNames = new Set();
  for (const p of periodos) {
    for (const v of p.vendedores || []) sellerNames.add(v.nombre);
  }
  const sellerRows = [...sellerNames]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((nombre) => [
      nombre,
      ...periodos.map((p) => {
        const hit = (p.vendedores || []).find((v) => v.nombre === nombre);
        return hit ? money(hit.total) : money('0.00');
      }),
    ]);

  // Productos: unión de top 10 por mes
  const productKeys = new Map();
  for (const p of periodos) {
    for (const prod of (p.productos || []).slice(0, 10)) {
      const key = `${prod.nombre}|${prod.unidad}`;
      if (!productKeys.has(key))
        productKeys.set(key, { nombre: prod.nombre, unidad: prod.unidad });
    }
  }
  const productRows = [...productKeys.values()].map((meta) => [
    `${meta.nombre} (${meta.unidad})`,
    ...periodos.map((p) => {
      const hit = (p.productos || []).find(
        (x) => x.nombre === meta.nombre && x.unidad === meta.unidad
      );
      return hit ? money(hit.neto) : money('0.00');
    }),
  ]);

  // Clientes top: merge de top 10 de cada período
  const clientNames = new Map();
  for (const p of periodos) {
    for (const c of topClientes(p.documentos, 10)) {
      if (!clientNames.has(c.nombre)) clientNames.set(c.nombre, c.nombre);
    }
  }
  const clientRows = [...clientNames.keys()]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((nombre) => [
      nombre,
      ...periodos.map((p) => {
        const hit = topClientes(p.documentos, 50).find((c) => c.nombre === nombre);
        return hit ? money(hit.total) : money('0.00');
      }),
    ]);

  const body = `
  <h1>Comparación de tres meses</h1>
  <div class="lead">${esc(labels.join(' · '))} · Importes en pesos argentinos</div>
  <h2>Indicadores</h2>
  ${table(
    ['Indicador', ...labels],
    [
      ['Facturación total', ...resumenes.map((s) => money(s.total))],
      ['A/B', ...resumenes.map((s) => money(s.ab))],
      ['X', ...resumenes.map((s) => money(s.x))],
      ['Notas de crédito (cant.)', ...resumenes.map((s) => String(s.notas_credito))],
      ['Ticket de factura', ...resumenes.map((s) => money(s.ticket_factura))],
      ['Documentos', ...resumenes.map((s) => String(s.documentos))],
    ]
  )}
  <div class="page"></div>
  <h2>Vendedores</h2>
  ${table(['Vendedor', ...labels], sellerRows)}
  <h2>Productos · neto (top por mes)</h2>
  ${table(['Producto', ...labels], productRows)}
  <h2>Clientes · top</h2>
  ${table(['Cliente', ...labels], clientRows)}`;
  return shell(title, body);
}

/** PDF cierre anual calendario. */
function htmlAnnual(d) {
  const anio = d.anio || d.periodo.desde.slice(0, 4);
  const s = absorverPendienteResumen(d.resumen);
  const meses = padMesesAnuales(d.meses, anio);
  const title = `VERTIMAR - Cierre anual ${anio}`;
  const body = `
  <h1>Cierre anual ${esc(anio)}</h1>
  <div class="lead">1 de enero al 31 de diciembre de ${esc(anio)} · Importes en pesos argentinos</div>
  ${metricsGrid([
    ['Facturación anual', s.total],
    ['Documentos normales', s.normal],
    ['Documentos con flete', s.flete],
    ['Ticket de factura', s.ticket_factura],
  ])}
  ${table(['Facturas', 'Notas débito', 'Notas crédito', 'A/B', 'X'], [[s.facturas, s.notas_debito, s.notas_credito, money(s.ab), money(s.x)]])}
  <h2>Facturación por mes</h2>
  ${table(
    ['Mes', 'Total', 'Normales', 'Con flete', 'Facturas / ND / NC'],
    meses.map((r) => [
      r.nombre,
      money(r.total),
      money(r.normal),
      money(r.flete),
      `${r.facturas} / ${r.notas_debito} / ${r.notas_credito}`,
    ])
  )}
  <div class="page"></div>
  <h2>Vendedores · año</h2>
  ${table(
    ['Vendedor', 'Documentos', 'Total'],
    (d.vendedores || []).map((r) => [r.nombre, r.documentos, money(r.total)])
  )}
  <h2>Ciudades · top 10</h2>
  ${table(
    ['Ciudad / provincia', 'Documentos', 'Facturación'],
    (d.ciudades || [])
      .slice(0, 10)
      .map((r) => [r.nombre, r.documentos, money(r.total)])
  )}
  <h2>Productos · top 10</h2>
  ${table(
    ['Producto', 'Unidad', 'Cantidad', 'Neto', 'IVA'],
    (d.productos || [])
      .slice(0, 10)
      .map((r) => [r.nombre, r.unidad, r.cantidad, money(r.neto), money(r.iva)])
  )}
  <h2>Compras, gastos y fondos</h2>
  ${table(['Facturación', 'Compras', 'Gastos', 'Diferencia'], [[money(s.total), money(d.resultado.compras), money(d.resultado.gastos), money(d.resultado.diferencia)]])}
  ${table(
    ['Cuenta', 'Ingresos', 'Egresos', 'Variación'],
    (d.caja?.cuentas || []).map((r) => [
      r.nombre,
      money(r.ingresos),
      money(r.egresos),
      money(r.variacion),
    ])
  )}
  <p>Variación de fondos: <b>${esc(money(d.caja?.variacion))}</b></p>`;
  return shell(title, body);
}

function htmlForPayload(data) {
  if (data?.tipo === 'comparacion') return htmlComparison(data);
  if (data?.tipo === 'anual') return htmlAnnual(data);
  return htmlReport(data);
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
    await page.setContent(htmlForPayload(data), { waitUntil: 'load' });
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

module.exports = {
  htmlReport,
  htmlComparison,
  htmlAnnual,
  htmlForPayload,
  renderPDF,
  money,
};
