import fs from 'fs';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

/**
 * CONFIGURACIÓN DE AFIP/ARCA
 * 
 * Este archivo centraliza toda la configuración necesaria para
 * conectarse a los servicios de ARCA
 */

class AfipConfig {
  constructor() {
    // Determinar si estamos en desarrollo o producción
    this.environment = process.env.NODE_ENV === 'prod' ? 'prod' : 'dev';
    
    // CUIT de la empresa
    this.CUIT = process.env.AFIP_CUIT;
    
    // Punto de venta por defecto
    this.puntoVentaDefault = parseInt(process.env.DEFAULT_PUNTO_VENTA) || 1;
    
    // Datos de la empresa
    this.empresa = {
      razonSocial: process.env.EMPRESA_RAZON_SOCIAL || 'Empresa de Prueba',
      domicilio: process.env.EMPRESA_DOMICILIO || 'Dirección de Prueba',
      condicionIVA: process.env.EMPRESA_CONDICION_IVA || 'Responsable Inscripto',
      inicioActividades: process.env.EMPRESA_INICIO_ACTIVIDADES || '01/01/2020'
    };
  }

  /**
   * Obtener configuración para inicializar AfipSDK
   * 
   * @returns {Object} Configuración para crear instancia de Afip
   */
  getAfipSDKConfig() {
    const config = {
      CUIT: this.CUIT,
      production: this.environment === 'prod'
    };

    const hasAccessToken = !!process.env.AFIP_ACCESS_TOKEN;
    const hasCertificates = !!(process.env.AFIP_CERT_PATH && process.env.AFIP_KEY_PATH);

    // ✅ CASO 1: AfipSDK con access_token + certificados (RECOMENDADO)
    if (hasAccessToken && hasCertificates) {
      try {
        config.access_token = process.env.AFIP_ACCESS_TOKEN;
        config.cert = fs.readFileSync(process.env.AFIP_CERT_PATH, { encoding: 'utf8' });
        config.key = fs.readFileSync(process.env.AFIP_KEY_PATH, { encoding: 'utf8' });
        
        console.log('✓ Usando AfipSDK con access_token + certificados');
        console.log(`  - CUIT: ${this.CUIT}`);
        console.log(`  - Access Token: ${process.env.AFIP_ACCESS_TOKEN.substring(0, 20)}...`);
        console.log(`  - Certificado: ${process.env.AFIP_CERT_PATH}`);
        console.log(`  - Key: ${process.env.AFIP_KEY_PATH}`);
        console.log(`  - Ambiente: ${this.environment === 'prod' ? '🚀 PRODUCCIÓN' : '🧪 TESTING'}`);
        console.log(`  - Flujo: Tu App → AfipSDK.com → AFIP`);
        
        return config;
      } catch (error) {
          console.error('⚠ Error al cargar certificados:', error.message);
        console.error('Rutas configuradas:');
        console.error(`  - AFIP_CERT_PATH: ${process.env.AFIP_CERT_PATH}`);
        console.error(`  - AFIP_KEY_PATH: ${process.env.AFIP_KEY_PATH}`);
        throw new Error(`No se pudieron cargar los certificados: ${error.message}`);
      }
    }

    // ✅ CASO 2: Solo certificados (conexión directa con AFIP, sin AfipSDK)
    if (!hasAccessToken && hasCertificates) {
      try {
        config.cert = fs.readFileSync(process.env.AFIP_CERT_PATH, { encoding: 'utf8' });
        config.key = fs.readFileSync(process.env.AFIP_KEY_PATH, { encoding: 'utf8' });
        
        console.log('✓ Conexión directa con AFIP (sin AfipSDK)');
        console.log(`  - CUIT: ${this.CUIT}`);
        console.log(`  - Certificado: ${process.env.AFIP_CERT_PATH}`);
        console.log(`  - Key: ${process.env.AFIP_KEY_PATH}`);
        console.log(`  - Ambiente: ${this.environment === 'prod' ? '🚀 PRODUCCIÓN' : '🧪 TESTING'}`);
        console.log(`  - Flujo: Tu App → AFIP (directo)`);
        
        return config;
      } catch (error) {
        console.error('⚠ Error al cargar certificados:', error.message);
        throw new Error(`No se pudieron cargar los certificados: ${error.message}`);
      }
    }

    // ✅ CASO 3: Solo access_token (ERROR - AfipSDK necesita certificados)
    if (hasAccessToken && !hasCertificates) {
      console.error('❌ ERROR: AfipSDK requiere AMBOS: access_token Y certificados');
      console.error('');
      console.error('Configuraste AFIP_ACCESS_TOKEN pero faltan los certificados.');
      console.error('AfipSDK usa el access_token para autenticar con su servicio,');
      console.error('pero TAMBIÉN necesita tus certificados AFIP para funcionar.');
      console.error('');
      console.error('Agrega a tu .env:');
      console.error('  AFIP_CERT_PATH=./arca-microservice/certs/cert_homologacion.crt');
      console.error('  AFIP_KEY_PATH=./arca-microservice/certs/cert_homologacion.key');
      console.error('');
      throw new Error('AfipSDK requiere access_token Y certificados juntos');
    }

    // ✅ Si no hay access_token ni certificados
    console.error('❌ CONFIGURACIÓN AFIP INCOMPLETA');
    console.error('');
    console.error('Necesitas configurar UNA de estas opciones en tu .env:');
    console.error('');
    console.error('OPCIÓN 1 (Recomendada - Más fácil):');
    console.error('  AFIP_ACCESS_TOKEN=tu_token_de_afipsdk');
    console.error('  Obtén tu token en: https://app.afipsdk.com/');
    console.error('');
    console.error('OPCIÓN 2 (Avanzada - Certificados propios):');
    console.error('  AFIP_CERT_PATH=./cert/certificado.crt');
    console.error('  AFIP_KEY_PATH=./cert/clave.key');
    console.error('');
    
    throw new Error('Configuración AFIP incompleta. Configura AFIP_ACCESS_TOKEN o certificados.');
  }

  /**
   * Validar que la configuración es correcta
   */
  validate() {
    const errors = [];

    if (!this.CUIT) {
      errors.push('AFIP_CUIT no está configurado en .env');
    }

    // Validar que al menos tengamos access_token O certificados
    const tieneAccessToken = !!process.env.AFIP_ACCESS_TOKEN;
    const tieneCertificados = !!(process.env.AFIP_CERT_PATH && process.env.AFIP_KEY_PATH);

    if (!tieneAccessToken && !tieneCertificados) {
      errors.push('');
      errors.push('❌ CONFIGURACIÓN AFIP INCOMPLETA');
      errors.push('');
      errors.push('Necesitas configurar UNA de estas opciones en tu .env:');
      errors.push('');
      errors.push('OPCIÓN 1 (Recomendada):');
      errors.push('  AFIP_ACCESS_TOKEN=tu_token_de_afipsdk');
      errors.push('  Obtén tu token en: https://app.afipsdk.com/');
      errors.push('');
      errors.push('OPCIÓN 2 (Avanzada):');
      errors.push('  AFIP_CERT_PATH=./cert/certificado.crt');
      errors.push('  AFIP_KEY_PATH=./cert/clave.key');
      errors.push('');
      errors.push('📖 Lee CONFIGURAR-AFIP.md para instrucciones detalladas');
      errors.push('');
    }

    if (this.environment === 'prod' && !tieneAccessToken && !tieneCertificados) {
      errors.push('En producción DEBES configurar AFIP_ACCESS_TOKEN o certificados');
    }

    if (errors.length > 0) {
      throw new Error('Errores en configuración de AFIP:\n' + errors.join('\n'));
    }

    console.log('✓ Configuración de AFIP validada correctamente');
  }

  /**
   * Mostrar información de la configuración actual
   */
  showInfo() {
    console.log('\n═══════════════════════════════════════════');
    console.log('📋 CONFIGURACIÓN DE FACTURACIÓN ELECTRÓNICA');
    console.log('═══════════════════════════════════════════');
    console.log(`Entorno: ${this.environment === 'dev' ? '🔧 Desarrollo/Testing' : '🚀 Producción'}`);
    console.log(`CUIT: ${this.CUIT}`);
    console.log(`Punto de Venta: ${this.puntoVentaDefault}`);
    console.log(`Empresa: ${this.empresa.razonSocial}`);
    console.log('═══════════════════════════════════════════\n');
  }
}

// Exportar instancia única (singleton)
const afipConfig = new AfipConfig();
export default afipConfig;