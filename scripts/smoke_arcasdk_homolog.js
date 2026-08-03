/**
 * Smoke test homologación @arcasdk/core 2.0.0
 * Ejecutar desde backend/: node scripts/smoke_arcasdk_homolog.js
 *
 * Requiere AFIP_PRODUCTION=false y certificados de homologación en .env
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const { default: afipService } = await import('../arca-microservice/services/afip.service.js');

  console.log('=== Smoke test @arcasdk/core (homologación) ===');
  console.log('AFIP_PRODUCTION =', process.env.AFIP_PRODUCTION);
  console.log('versión instalada:', (await import('@arcasdk/core/package.json', { with: { type: 'json' } })).default.version);

  // 1) Dummy / server status
  console.log('\n[1] getServerStatus...');
  const estado = await afipService.verificarEstadoServidor();
  console.log('OK', estado);

  // 2) getLastVoucher (PV 1 homologación, Factura B = 6)
  console.log('\n[2] getLastVoucher PV=1 tipo=6...');
  const ultimo = await afipService.obtenerUltimoComprobante(1, 6);
  console.log('OK último =', ultimo);

  // 3) getVoucherInfo si hay algún comprobante
  if (ultimo > 0) {
    console.log(`\n[3] getVoucherInfo nro=${ultimo}...`);
    const info = await afipService.obtenerInfoComprobante(ultimo, 1, 6);
    console.log('OK info CAE =', info?.CodAutorizacion || info?.codAutorizacion || '(sin CAE en shape)');
  } else {
    console.log('\n[3] getVoucherInfo omitido (no hay comprobantes previos en PV 1 tipo 6)');
  }

  // 4) Padrón A13 (CUIT por DNI)
  console.log('\n[4] getTaxIDByDocument...');
  try {
    const cuit = await afipService.getCuitPorDni('30111222');
    console.log('OK cuit =', cuit);
  } catch (e) {
    console.log('WARN (esperado si padrón A13 no autorizado en homologación):', e.message);
  }

  // 5) createVoucher Factura B + A (homologación)
  console.log('\n[5] createVoucher Factura B y A...');
  const { default: billingService } = await import('../arca-microservice/services/billing.service.js');
  const items = [{ descripcion: 'Smoke test SDK 2.0.0', cantidad: 1, precioUnitario: 10, alicuotaIVA: 5 }];
  const facturaB = await billingService.crearFacturaConsumidorFinal(items, { puntoVenta: 1, concepto: 1 });
  console.log('OK Factura B CAE =', facturaB?.autorizacion?.cae);
  const facturaA = await billingService.crearFacturaResponsableInscripto('30714525030', items, { puntoVenta: 1, concepto: 1 });
  console.log('OK Factura A CAE =', facturaA?.autorizacion?.cae);

  console.log('\n=== Smoke test completado sin crash de SDK ===');
}

main().catch((err) => {
  console.error('\nFAIL:', err);
  process.exit(1);
});
