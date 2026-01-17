import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener el directorio actual del módulo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
// Intentar cargar desde el directorio raíz del backend primero
const backendRoot = path.resolve(__dirname, '../../');
dotenv.config({ path: path.join(backendRoot, '.env') });
// También intentar cargar desde el directorio actual por si acaso
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * CONFIGURACIÓN DE AFIP/ARCA
 * 
 * Este archivo centraliza toda la configuración necesaria para
 * conectarse a los servicios de ARCA
 */

class AfipConfig {
  constructor() {
    // Determinar si estamos en desarrollo o producción
    // Prioridad: AFIP_PRODUCTION > NODE_ENV
    const afipProduction = process.env.AFIP_PRODUCTION === 'true' || process.env.AFIP_PRODUCTION === true;
    const nodeEnvProd = process.env.NODE_ENV === 'prod' || process.env.NODE_ENV === 'production';
    this.environment = (afipProduction || nodeEnvProd) ? 'prod' : 'dev';
    
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
      // En desarrollo, si usamos el CUIT de prueba no necesitamos certificados
      production: this.environment === 'prod'
    };

    // Log de qué variable determinó el ambiente
    const afipProduction = process.env.AFIP_PRODUCTION === 'true' || process.env.AFIP_PRODUCTION === true;
    const nodeEnvProd = process.env.NODE_ENV === 'prod' || process.env.NODE_ENV === 'production';
    if (afipProduction) {
      console.log(`   ℹ Ambiente: PRODUCCIÓN (determinado por AFIP_PRODUCTION=${process.env.AFIP_PRODUCTION})`);
    } else if (nodeEnvProd) {
      console.log(`   ℹ Ambiente: PRODUCCIÓN (determinado por NODE_ENV=${process.env.NODE_ENV})`);
    } else {
      console.log(`   ℹ Ambiente: DESARROLLO/TESTING (AFIP_PRODUCTION=${process.env.AFIP_PRODUCTION || 'no configurado'}, NODE_ENV=${process.env.NODE_ENV || 'no configurado'})`);
    }

    // Agregar access_token si está disponible
    if (process.env.AFIP_ACCESS_TOKEN) {
      config.access_token = process.env.AFIP_ACCESS_TOKEN;
      // Mostrar solo los primeros y últimos caracteres del token por seguridad
      const tokenPreview = process.env.AFIP_ACCESS_TOKEN.length > 20 
        ? `${process.env.AFIP_ACCESS_TOKEN.substring(0, 10)}...${process.env.AFIP_ACCESS_TOKEN.substring(process.env.AFIP_ACCESS_TOKEN.length - 10)}`
        : '***';
      console.log(`   ✓ Access token cargado: ${tokenPreview}`);
    } else {
      console.error('   ❌ AFIP_ACCESS_TOKEN no está configurado en .env');
      console.error('   ❌ Necesitas un access_token para usar ARCA. Obtén uno desde https://app.afipsdk.com/');
      console.error('   ❌ Asegúrate de que la variable AFIP_ACCESS_TOKEN esté definida en tu archivo .env');
    }

    // Si tenemos rutas de certificados configuradas, las cargamos
    if (process.env.AFIP_CERT_PATH && process.env.AFIP_KEY_PATH) {
      try {
        config.cert = fs.readFileSync(process.env.AFIP_CERT_PATH, { encoding: 'utf8' });
        config.key = fs.readFileSync(process.env.AFIP_KEY_PATH, { encoding: 'utf8' });
        console.log('   ✓ Certificados cargados correctamente');
      } catch (error) {
        // Si estamos en desarrollo con el CUIT de prueba, no es crítico
        if (this.CUIT !== '20409378472') {
          console.error('   ⚠ Error al cargar certificados:', error.message);
          console.error('   Para usar tu propio CUIT necesitas certificados válidos');
        } else {
          console.log('   ℹ Usando CUIT de prueba sin certificados');
        }
      }
    } else {
      console.log('   ℹ No se configuraron rutas de certificados (usando ARCA)');
      if (this.CUIT !== '20409378472') {
        console.warn('   ⚠ Para tu CUIT debes configurar certificados');
      }
    }

    return config;
  }

  /**
   * Validar que la configuración es correcta
   */
  validate() {
    const errors = [];

    if (!this.CUIT) {
      errors.push('AFIP_CUIT no está configurado en .env');
    }

    if (!process.env.AFIP_ACCESS_TOKEN) {
      errors.push('AFIP_ACCESS_TOKEN no está configurado en .env. Obtén uno desde https://app.afipsdk.com/');
    }

    if (this.environment === 'prod' && (!process.env.AFIP_CERT_PATH || !process.env.AFIP_KEY_PATH)) {
      errors.push('En producción debes configurar AFIP_CERT_PATH y AFIP_KEY_PATH');
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