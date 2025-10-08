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
      // En desarrollo, si usamos el CUIT de prueba no necesitamos certificados
      production: this.environment === 'prod'
    };

    // Si tenemos rutas de certificados configuradas, las cargamos
    if (process.env.AFIP_CERT_PATH && process.env.AFIP_KEY_PATH) {
      try {
        config.cert = fs.readFileSync(process.env.AFIP_CERT_PATH, { encoding: 'utf8' });
        config.key = fs.readFileSync(process.env.AFIP_KEY_PATH, { encoding: 'utf8' });
        console.log('✓ Certificados cargados correctamente');
      } catch (error) {
        // Si estamos en desarrollo con el CUIT de prueba, no es crítico
        if (this.CUIT !== '20409378472') {
          console.error('⚠ Error al cargar certificados:', error.message);
          console.error('Para usar tu propio CUIT necesitas certificados válidos');
        } else {
          console.log('ℹ Usando CUIT de prueba sin certificados');
        }
      }
    } else {
      console.log('ℹ No se configuraron rutas de certificados');
      if (this.CUIT !== '20409378472') {
        console.warn('⚠ Para tu CUIT debes configurar certificados');
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