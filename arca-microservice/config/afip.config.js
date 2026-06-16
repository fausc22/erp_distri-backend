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


    // Agregar access_token si está disponible
    if (process.env.AFIP_ACCESS_TOKEN) {
      config.access_token = process.env.AFIP_ACCESS_TOKEN;
    }

    // Si tenemos rutas de certificados configuradas, las cargamos
    if (process.env.AFIP_CERT_PATH && process.env.AFIP_KEY_PATH) {
      try {
        config.cert = fs.readFileSync(process.env.AFIP_CERT_PATH, { encoding: 'utf8' });
        config.key = fs.readFileSync(process.env.AFIP_KEY_PATH, { encoding: 'utf8' });
      } catch (error) {
        // Si estamos en desarrollo con el CUIT de prueba, no es crítico
        if (this.CUIT !== '20409378472') {
          throw new Error(`Error al cargar certificados: ${error.message}`);
        }
      }
    }

    return config;
  }

  /**
   * Configuración para @arcasdk/core (conexión directa a ARCA, sin app.afipsdk.com).
   * Requiere certificado y clave PEM; crea directorio de tickets WSAA bajo backend/storage/arca-tickets.
   *
   * @returns {{ cuit: number, cert: string, key: string, production: boolean, useHttpsAgent: boolean, ticketPath: string }}
   */
  getArcaSDKConfig() {
    const production = this.environment === 'prod';
    const cuitStr = String(this.CUIT || '').replace(/\D/g, '');
    const cuitNum = parseInt(cuitStr, 10);
    if (!cuitStr || cuitStr.length !== 11 || Number.isNaN(cuitNum)) {
      throw new Error('AFIP_CUIT debe ser un CUIT válido de 11 dígitos para @arcasdk/core');
    }

    if (!process.env.AFIP_CERT_PATH || !process.env.AFIP_KEY_PATH) {
      throw new Error('AFIP_CERT_PATH y AFIP_KEY_PATH son obligatorios para @arcasdk/core');
    }

    const certPath = path.resolve(backendRoot, process.env.AFIP_CERT_PATH.replace(/^\.\//, ''));
    const keyPath = path.resolve(backendRoot, process.env.AFIP_KEY_PATH.replace(/^\.\//, ''));

    let cert;
    let key;
    try {
      cert = fs.readFileSync(certPath, { encoding: 'utf8' });
      key = fs.readFileSync(keyPath, { encoding: 'utf8' });
    } catch (error) {
      throw new Error(`Error al cargar certificados para @arcasdk/core: ${error.message}`);
    }

    const ticketPath = path.join(backendRoot, 'storage', 'arca-tickets');
    fs.mkdirSync(ticketPath, { recursive: true });

    return {
      cuit: cuitNum,
      cert,
      key,
      production,
      useHttpsAgent: true,
      ticketPath
    };
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

    // Configuración validada silenciosamente
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