/**
 * Genera PDFs de muestra ARCA para revisión visual de densidad.
 * Casos: 1, 8, 11, 30 ítems, nombre largo, descuento, nota de crédito.
 * Salida: output/pdf/muestra-*.pdf
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pdfGenerator = require('../utils/pdfGenerator');

const outDir = path.resolve(__dirname, '../../output/pdf');
fs.mkdirSync(outDir, { recursive: true });

function buildFooter() {
  return pdfGenerator.construirFooterFacturaARCA({
    observacionesHTML: '<p><strong>OBSERVACIONES:</strong></p><p>Muestra densidad ARCA</p>',
    subtotal: 10000,
    ivaTotal: 2100,
    total: 12100,
    qrBase64: 'data:image/svg+xml;base64,' + Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#111"/><text x="10" y="55" fill="#fff" font-size="14">QR</text></svg>'
    ).toString('base64'),
    logoARCABase64: pdfGenerator.obtenerLogoARCABase64(),
    cae: '71234567890123',
    fechaVencimientoCAE: '31/12/2026',
    esExento: false
  });
}

const common = {
  tipo_comprobante: 'A',
  codigo_comprobante: '1',
  punto_venta: '0004',
  numero_comprobante: '00008888',
  fecha: '20/11/2026',
  cuit_emisor: process.env.AFIP_CUIT || '30714525030',
  ingresos_brutos: '251491/4',
  fecha_inicio_actividades: '01/02/2016',
  telefono: '2302-651250',
  email: 'vertimar@hotmail.com',
  cliente_cuit: '20111111112',
  cliente_nombre: 'Cliente Muestra Densidad',
  cliente_condicion: 'Responsable Inscripto',
  cliente_direccion: 'Calle 31 N 1555',
  observaciones_html: '',
  factura_asociada_tipo: 'A',
  factura_asociada_punto_venta: '0004',
  factura_asociada_numero: '00000010',
  factura_asociada_fecha: '10/11/2026',
  factura_asociada_total: '5.000,00'
};

function rows(n, { longName = false, withDiscount = false, prefix = 'PROD' } = {}) {
  const baseName = longName
    ? 'ACEITE GIRASOL PREMIUM BOTELLA PET CON TAPA ANTIDERRAME PARA HOTELERIA Y GASTRONOMIA'
    : 'Producto muestra';
  return Array.from({ length: n }, (_, i) => {
    const precioFinal = 100 + i;
    const descuento = withDiscount && i % 3 === 0 ? 10 : 0;
    const precioOriginal = descuento > 0 ? precioFinal / (1 - descuento / 100) : null;
    return pdfGenerator.construirFilaItemARCA({
      cantidadFormateada: String((i % 5) + 1),
      nombre: `${prefix}-${String(i + 1).padStart(3, '0')} ${baseName}`,
      um: i % 2 === 0 ? 'Caja' : 'Unidad',
      precioFinal,
      precioOriginal,
      descuentoPorcentaje: descuento,
      totalLinea: precioFinal * ((i % 5) + 1),
      ocultarIvaDiscriminado: false,
      porcentajeIvaTexto: '21.00'
    });
  });
}

async function generar(nombreArchivo, templatePath, rowsByItem) {
  const { html, pageCount } = await pdfGenerator.construirHtmlMultipaginaARCA({
    templatePath,
    commonReplacements: common,
    rowsByItem,
    footerContent: buildFooter(),
    tableHeader: pdfGenerator.construirTableHeaderARCA({ ocultarIvaDiscriminado: false })
  });
  const buffer = await pdfGenerator.generatePdfFromHtml(html);
  const out = path.join(outDir, nombreArchivo);
  fs.writeFileSync(out, buffer);
  console.log(`✅ ${nombreArchivo} — ${rowsByItem.length} ítems, ${pageCount} página(s), ${buffer.length} bytes`);
}

async function main() {
  const factura = path.join(__dirname, '../resources/documents/factura_arca.html');
  const nc = path.join(__dirname, '../resources/documents/nota_credito_arca.html');

  await generar('muestra-factura-1.pdf', factura, rows(1));
  await generar('muestra-factura-8.pdf', factura, rows(8));
  await generar('muestra-factura-11.pdf', factura, rows(11));
  await generar('muestra-factura-30.pdf', factura, rows(30));
  await generar('muestra-factura-nombres-largos.pdf', factura, rows(15, { longName: true }));
  await generar('muestra-factura-descuento.pdf', factura, rows(12, { withDiscount: true }));
  await generar('muestra-nota-credito-20.pdf', nc, rows(20, { prefix: 'NC' }));

  console.log(`\n📁 Muestras en ${outDir}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
