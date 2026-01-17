#!/usr/bin/env node

/**
 * SCRIPT DE PRUEBA DE INTEGRACIÓN ARCA
 * 
 * Este script verifica que:
 * 1. Los módulos se importan correctamente
 * 2. La configuración de AFIP está bien
 * 3. Los servicios se inicializan sin errores
 */

import afipConfig from './config/afip.config.js';
import billingService from './services/billing.service.js';
import wsaaService from './services/wsaa.service.js';
import wsfev1Service from './services/wsfev1.service.js';

console.log('\n╔═══════════════════════════════════════════╗');
console.log('║  🧪 TEST DE INTEGRACIÓN ARCA/AFIP        ║');
console.log('╚═══════════════════════════════════════════╝\n');

async function runTests() {
  const tests = [];
  
  // TEST 1: Validar configuración
  console.log('📋 TEST 1: Validando configuración AFIP...');
  try {
    afipConfig.validate();
    tests.push({ name: 'Configuración AFIP', status: '✅ PASS' });
  } catch (error) {
    tests.push({ name: 'Configuración AFIP', status: '❌ FAIL', error: error.message });
  }
  
  // TEST 2: Mostrar información de configuración
  console.log('\n📋 TEST 2: Información de configuración...');
  try {
    afipConfig.showInfo();
    tests.push({ name: 'Mostrar info', status: '✅ PASS' });
  } catch (error) {
    tests.push({ name: 'Mostrar info', status: '❌ FAIL', error: error.message });
  }
  
  // TEST 3: Verificar servicios inicializados
  console.log('\n📋 TEST 3: Verificando servicios...');
  try {
    const serviciosOK = 
      billingService && 
      wsaaService && 
      wsfev1Service;
    
    if (serviciosOK) {
      console.log('  ✓ BillingService: Inicializado');
      console.log('  ✓ WSAAService: Inicializado');
      console.log('  ✓ WSFEv1Service: Inicializado');
      tests.push({ name: 'Servicios inicializados', status: '✅ PASS' });
    } else {
      throw new Error('Algún servicio no se inicializó correctamente');
    }
  } catch (error) {
    tests.push({ name: 'Servicios inicializados', status: '❌ FAIL', error: error.message });
  }
  
  // TEST 4: Health check del servicio
  console.log('\n📋 TEST 4: Health check del servicio...');
  try {
    const salud = await billingService.verificarSalud();
    
    if (salud.estado === 'OK') {
      console.log('  ✓ Estado del servidor AFIP:', salud.servidor.appserver);
      console.log('  ✓ Ambiente:', salud.ambiente);
      console.log('  ✓ CUIT:', salud.cuit);
      tests.push({ name: 'Health check', status: '✅ PASS' });
    } else {
      throw new Error(salud.error || 'Health check falló');
    }
  } catch (error) {
    tests.push({ name: 'Health check', status: '❌ FAIL', error: error.message });
  }
  
  // RESUMEN DE TESTS
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║          📊 RESUMEN DE TESTS              ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  
  tests.forEach((test, index) => {
    console.log(`${index + 1}. ${test.name}: ${test.status}`);
    if (test.error) {
      console.log(`   ⚠️  Error: ${test.error}`);
    }
  });
  
  const passed = tests.filter(t => t.status.includes('PASS')).length;
  const failed = tests.filter(t => t.status.includes('FAIL')).length;
  
  console.log('\n═══════════════════════════════════════════');
  console.log(`Resultado: ${passed}/${tests.length} tests pasaron`);
  
  if (failed > 0) {
    console.log('\n⚠️  Hay tests fallidos. Revisa la configuración.');
    console.log('💡 Consulta: backend/arca-microservice/CONFIGURACION_AFIP.md\n');
    process.exit(1);
  } else {
    console.log('\n✅ Todos los tests pasaron! El microservicio está listo.\n');
    process.exit(0);
  }
}

// Ejecutar tests
runTests().catch(error => {
  console.error('\n❌ Error ejecutando tests:', error);
  process.exit(1);
});

