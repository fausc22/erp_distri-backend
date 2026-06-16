/**
 * Humo homologación: FEDummy + último comprobante + puntos de venta.
 * Ejecutar desde la raíz del backend: `node arca-microservice/scripts/smoke-arca-homo.mjs`
 * Requiere .env con AFIP_CUIT, AFIP_CERT_PATH, AFIP_KEY_PATH, AFIP_PRODUCTION=false.
 */
import afipService from '../services/afip.service.js';
import afipConfig from '../config/afip.config.js';

const pv = afipConfig.puntoVentaDefault || 1;

console.log('--- ARCA @arcasdk/core smoke (homologación) ---');
console.log('CUIT:', afipConfig.CUIT, '| PV default:', pv, '| entorno config:', afipConfig.environment);

const estado = await afipService.verificarEstadoServidor();
console.log('\n1) FEDummy / getServerStatus:', JSON.stringify(estado, null, 2));

const ultB = await afipService.obtenerUltimoComprobante(pv, 6);
console.log('\n2) FECompUltimoAutorizado Factura B (6) PV', pv, '→', ultB);

const pvs = await afipService.obtenerPuntosVenta();
console.log('\n3) Puntos de venta (primeros 5):', JSON.stringify(pvs.slice(0, 5), null, 2));

if (process.env.TEST_DNI) {
  try {
    const cuitDni = await afipService.getCuitPorDni(process.env.TEST_DNI);
    console.log('\n4) Padrón DNI', process.env.TEST_DNI, '→', cuitDni ?? '(null)');
  } catch (e) {
    console.log('\n4) Padrón DNI (error esperable si el cert no tiene alcance A13):', e.message);
  }
}

try {
  const cuitConst = String(process.env.TEST_CUIT || afipConfig.CUIT || '').replace(/\D/g, '');
  if (cuitConst.length === 11) {
    const cons = await afipService.getDatosConstancia(cuitConst);
    console.log('\n5) Constancia CUIT', cuitConst, '→', cons ? 'OK (datosGenerales presentes)' : 'null');
  }
} catch (e) {
  console.log('\n5) Constancia (si falla: habilitar servicio en certificado / WSAA):', e.message);
}

console.log('\n--- Smoke WSFE OK. Completar emisión 4–10 manualmente según HOMOLOGACION_ARCA.md ---');
