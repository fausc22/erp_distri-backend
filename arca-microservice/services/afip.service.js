import Afip from '@afipsdk/afip.js';
import afipConfig from '../config/afip.config.js';

/**
 * SERVICIO PRINCIPAL DE AFIP
 * 
 * Este servicio encapsula todas las interacciones con AfipSDK
 * Proporciona métodos de alto nivel para facturación electrónica
 */

class AfipService {
  constructor() {
    // Obtener configuración
    const config = afipConfig.getAfipSDKConfig();
    
    // Inicializar SDK
    try {
      this.afip = new Afip(config);
      this.config = afipConfig;
      
      // Log simplificado solo en desarrollo
      if (process.env.NODE_ENV === 'development') {
        const ambiente = config.production ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN';
        const cuit = config.CUIT || 'No configurado';
        console.log(`✅ ARCA SDK inicializado (${ambiente}, CUIT: ${cuit})`);
      }
    } catch (error) {
      console.error(`❌ Error al inicializar SDK de AFIP/ARCA: ${error.message}`);
      throw error;
    }
  }

  /**
   * OBTENER ÚLTIMO COMPROBANTE
   * 
   * Consulta cuál fue el último número de comprobante emitido
   * para un punto de venta y tipo de comprobante específico
   * 
   * @param {number} puntoVenta - Número del punto de venta (ej: 1)
   * @param {number} tipoComprobante - Código del tipo (ej: 6 para Factura B)
   * @returns {Promise<number>} Último número de comprobante
   */
  async obtenerUltimoComprobante(puntoVenta, tipoComprobante) {
    try {
      console.log(`📊 Consultando último comprobante - PV: ${puntoVenta}, Tipo: ${tipoComprobante}`);
      
      const ultimoNumero = await this.afip.ElectronicBilling.getLastVoucher(
        puntoVenta,
        tipoComprobante
      );
      
      console.log(`✓ Último comprobante: ${ultimoNumero}`);
      return ultimoNumero;
      
    } catch (error) {
      console.error('❌ Error al obtener último comprobante:', error);
      throw new Error(`Error al consultar último comprobante: ${error.message}`);
    }
  }

  /**
   * CREAR COMPROBANTE
   * 
   * Crea un comprobante y obtiene el CAE (Código de Autorización Electrónico)
   * Este es el método principal para emitir facturas
   * 
   * @param {Object} datosComprobante - Datos del comprobante a crear
   * @param {boolean} respuestaCompleta - Si devolver toda la respuesta del WS
   * @returns {Promise<Object>} CAE, fecha de vencimiento y datos adicionales
   */
  async crearComprobante(datosComprobante, respuestaCompleta = false) {
    try {
      console.log('📝 Creando comprobante en ARCA...');
      
      const resultado = await this.afip.ElectronicBilling.createVoucher(
        datosComprobante,
        respuestaCompleta
      );
      
      console.log('✓ Comprobante creado exitosamente');
      console.log(`  CAE: ${resultado.CAE}`);
      console.log(`  Vencimiento CAE: ${resultado.CAEFchVto}`);
      
      return resultado;
      
    } catch (error) {
      console.error('❌ Error al crear comprobante:', error);
      
      // Si el error viene de ARCA, tiene información más detallada
      if (error.response?.data) {
        const errData = error.response.data;
        throw new Error(`Error de ARCA: ${errData.Errors || error.message}`);
      }
      
      throw new Error(`Error al crear comprobante: ${error.message}`);
    }
  }

  /**
   * CREAR SIGUIENTE COMPROBANTE
   * 
   * Crea automáticamente el siguiente comprobante en la secuencia
   * Consulta el último número y crea el próximo
   * 
   * @param {Object} datosComprobante - Datos del comprobante
   * @returns {Promise<Object>} CAE, fecha de vencimiento y número asignado
   */
  async crearSiguienteComprobante(datosComprobante) {
    try {
      console.log('📝 Creando siguiente comprobante...');
      
      const resultado = await this.afip.ElectronicBilling.createNextVoucher(
        datosComprobante
      );
      
      console.log('✓ Siguiente comprobante creado');
      console.log(`  Número: ${resultado.voucher_number}`);
      console.log(`  CAE: ${resultado.CAE}`);
      console.log(`  Vencimiento CAE: ${resultado.CAEFchVto}`);
      
      return resultado;
      
    } catch (error) {
      console.error('❌ Error al crear siguiente comprobante:', error);
      throw new Error(`Error al crear siguiente comprobante: ${error.message}`);
    }
  }

  /**
   * OBTENER INFORMACIÓN DE COMPROBANTE
   * 
   * Consulta los datos de un comprobante ya emitido
   * Útil para verificar o reimprimir comprobantes
   * 
   * @param {number} numeroComprobante - Número del comprobante
   * @param {number} puntoVenta - Punto de venta
   * @param {number} tipoComprobante - Tipo de comprobante
   * @returns {Promise<Object|null>} Datos del comprobante o null si no existe
   */
  async obtenerInfoComprobante(numeroComprobante, puntoVenta, tipoComprobante) {
    try {
      console.log(`🔍 Consultando comprobante ${numeroComprobante}...`);
      
      const info = await this.afip.ElectronicBilling.getVoucherInfo(
        numeroComprobante,
        puntoVenta,
        tipoComprobante
      );
      
      if (info === null) {
        console.log('ℹ Comprobante no encontrado');
        return null;
      }
      
      console.log('✓ Información del comprobante obtenida');
      return info;
      
    } catch (error) {
      console.error('❌ Error al obtener información:', error);
      throw new Error(`Error al consultar comprobante: ${error.message}`);
    }
  }

  /**
   * OBTENER TIPOS DE COMPROBANTES DISPONIBLES
   * 
   * Consulta todos los tipos de comprobantes que puedes emitir
   * según tu configuración en ARCA
   * 
   * @returns {Promise<Array>} Lista de tipos de comprobantes
   */
  async obtenerTiposComprobantes() {
    try {
      const tipos = await this.afip.ElectronicBilling.getVoucherTypes();
      return tipos;
    } catch (error) {
      console.error('❌ Error al obtener tipos de comprobantes:', error);
      throw error;
    }
  }

  /**
   * OBTENER TIPOS DE DOCUMENTOS
   * 
   * @returns {Promise<Array>} Lista de tipos de documentos
   */
  async obtenerTiposDocumentos() {
    try {
      const tipos = await this.afip.ElectronicBilling.getDocumentTypes();
      return tipos;
    } catch (error) {
      console.error('❌ Error al obtener tipos de documentos:', error);
      throw error;
    }
  }

  /**
   * OBTENER TIPOS DE IVA
   * 
   * @returns {Promise<Array>} Lista de alícuotas de IVA
   */
  async obtenerTiposIVA() {
    try {
      const tipos = await this.afip.ElectronicBilling.getAliquotTypes();
      return tipos;
    } catch (error) {
      console.error('❌ Error al obtener tipos de IVA:', error);
      throw error;
    }
  }

  /**
   * OBTENER PUNTOS DE VENTA
   * 
   * Consulta los puntos de venta habilitados
   * (En testing normalmente solo existe el punto de venta 1)
   * 
   * @returns {Promise<Array>} Lista de puntos de venta
   */
  async obtenerPuntosVenta() {
    try {
      const puntos = await this.afip.ElectronicBilling.getSalesPoints();
      return puntos;
    } catch (error) {
      // En testing es normal que falle porque no hay puntos configurados
      if (afipConfig.environment === 'dev') {
        console.log('ℹ En testing, usar punto de venta 1 por defecto');
        return [{ PtoVta: 1 }];
      }
      throw error;
    }
  }

  /**
   * VERIFICAR ESTADO DEL SERVIDOR
   * 
   * Verifica si los servicios de ARCA están operativos
   * (Nota: ARCA casi siempre responde "ok" incluso con problemas)
   * 
   * @returns {Promise<Object>} Estado del servidor
   */
  async verificarEstadoServidor() {
    try {
      const estado = await this.afip.ElectronicBilling.getServerStatus();
      console.log('Estado del servidor ARCA:', estado);
      return estado;
    } catch (error) {
      console.error('❌ Error al verificar servidor:', error);
      throw error;
    }
  }

  /**
   * OBTENER COTIZACIÓN DE MONEDA
   * 
   * Consulta el tipo de cambio oficial de una moneda
   * 
   * @param {string} monedaId - ID de la moneda (ej: 'DOL' para dólares)
   * @param {string} fecha - Fecha en formato YYYYMMDD
   * @returns {Promise<Object>} Cotización de la moneda
   */
  async obtenerCotizacionMoneda(monedaId, fecha) {
    try {
      const cotizacion = await this.afip.ElectronicBilling.executeRequest(
        'FEParamGetCotizacion',
        {
          MonId: monedaId,
          FchCotiz: fecha
        }
      );
      return cotizacion;
    } catch (error) {
      console.error('❌ Error al obtener cotización:', error);
      throw error;
    }
  }
}

// Exportar instancia única (singleton)
const afipService = new AfipService();
export default afipService;