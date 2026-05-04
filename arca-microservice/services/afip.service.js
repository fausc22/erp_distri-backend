import Afip from '@afipsdk/afip.js';
import { createRequire } from 'module';
import afipConfig from '../config/afip.config.js';

const require = createRequire(import.meta.url);
const discordLogger = require('../../utils/discordLogger.js');

/** Envía log a consola y a Discord (canal ARCA/AFIP). */
function arcaLog(msg, ctx = {}) {
  console.log(msg);
  discordLogger.sendArcaAfip(msg, ctx);
}
function arcaErr(msg, ctx = {}) {
  console.error(msg);
  discordLogger.sendArcaAfip(msg, ctx);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHttpStatus(error) {
  return error?.response?.status || error?.status || null;
}

function esErrorTransitorio(error) {
  const status = getHttpStatus(error);
  if (status && status >= 500) return true;

  const code = error?.code;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('socket hang up');
}

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
        arcaLog(`✅ ARCA SDK inicializado (${ambiente}, CUIT: ${cuit})`);
      }
    } catch (error) {
      arcaErr(`❌ Error al inicializar SDK de AFIP/ARCA: ${error.message}`);
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
    const maxIntentos = 3;
    const esperaBaseMs = 700;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        arcaLog(
          `📊 Consultando último comprobante - PV: ${puntoVenta}, Tipo: ${tipoComprobante} (intento ${intento}/${maxIntentos})`
        );

        const ultimoNumero = await this.afip.ElectronicBilling.getLastVoucher(
          puntoVenta,
          tipoComprobante
        );

        arcaLog(`✓ Último comprobante: ${ultimoNumero}`);
        return ultimoNumero;
      } catch (error) {
        const status = getHttpStatus(error);
        const esTransitorio = esErrorTransitorio(error);
        const ultimoIntento = intento === maxIntentos;
        const detalle = `status=${status || 'N/A'} code=${error?.code || 'N/A'} msg=${error.message}`;

        if (!esTransitorio || ultimoIntento) {
          arcaErr(`❌ Error al obtener último comprobante (${detalle})`);
          throw new Error(`Error al consultar último comprobante: ${error.message}`);
        }

        const esperaMs = esperaBaseMs * (2 ** (intento - 1));
        arcaLog(`⚠️ Falla transitoria consultando último comprobante (${detalle}). Reintentando en ${esperaMs}ms...`);
        await sleep(esperaMs);
      }
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
    const maxIntentos = 3;
    const esperaBaseMs = 700;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        arcaLog(`📝 Creando comprobante en ARCA... (intento ${intento}/${maxIntentos})`);

        const resultado = await this.afip.ElectronicBilling.createVoucher(
          datosComprobante,
          respuestaCompleta
        );

        arcaLog(`✓ Comprobante creado exitosamente | CAE: ${resultado.CAE} | Vto: ${resultado.CAEFchVto}`);
        return resultado;
      } catch (error) {
        const status = getHttpStatus(error);
        const esTransitorio = esErrorTransitorio(error);
        const ultimoIntento = intento === maxIntentos;
        const detalle = `status=${status || 'N/A'} code=${error?.code || 'N/A'} msg=${error.message}`;

        if (!esTransitorio || ultimoIntento) {
          arcaErr('❌ Error al crear comprobante: ' + (error.response?.data?.Errors || error.message));

          // Si el error viene de ARCA, tiene información más detallada
          if (error.response?.data) {
            const errData = error.response.data;
            throw new Error(`Error de ARCA: ${errData.Errors || error.message}`);
          }

          throw new Error(`Error al crear comprobante: ${error.message}`);
        }

        const esperaMs = esperaBaseMs * (2 ** (intento - 1));
        arcaLog(`⚠️ Falla transitoria creando comprobante (${detalle}). Reintentando en ${esperaMs}ms...`);
        await sleep(esperaMs);
      }
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
      arcaLog('📝 Creando siguiente comprobante...');
      
      const resultado = await this.afip.ElectronicBilling.createNextVoucher(
        datosComprobante
      );
      
      arcaLog(`✓ Siguiente comprobante creado | Nº: ${resultado.voucher_number} | CAE: ${resultado.CAE}`);
      
      return resultado;
      
    } catch (error) {
      arcaErr('❌ Error al crear siguiente comprobante: ' + error.message);
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
      arcaLog(`🔍 Consultando comprobante ${numeroComprobante}...`);
      
      const info = await this.afip.ElectronicBilling.getVoucherInfo(
        numeroComprobante,
        puntoVenta,
        tipoComprobante
      );
      
      if (info === null) {
        arcaLog('ℹ Comprobante no encontrado');
        return null;
      }
      
      arcaLog('✓ Información del comprobante obtenida');
      return info;
      
    } catch (error) {
      arcaErr('❌ Error al obtener información: ' + error.message);
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
      arcaErr('❌ Error al obtener tipos de comprobantes: ' + error.message);
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
      arcaErr('❌ Error al obtener tipos de documentos: ' + error.message);
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
      arcaErr('❌ Error al obtener tipos de IVA: ' + error.message);
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
        arcaLog('ℹ En testing, usar punto de venta 1 por defecto');
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
      arcaLog('Estado del servidor ARCA: ' + JSON.stringify(estado));
      return estado;
    } catch (error) {
      arcaErr('❌ Error al verificar servidor: ' + error.message);
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
      arcaErr('❌ Error al obtener cotización: ' + error.message);
      throw error;
    }
  }

  // ─── PADRÓN / CONSTANCIA DE INSCRIPCIÓN (consulta contribuyentes) ───

  /**
   * Obtiene el CUIT asociado a un DNI (Padrón Alcance 13).
   * @param {string|number} dni - DNI 7 u 8 dígitos
   * @returns {Promise<string|null>} CUIT 11 dígitos o null
   */
  async getCuitPorDni(dni) {
    const dniStr = String(dni).replace(/\D/g, '');
    const dniNum = parseInt(dniStr, 10);
    if (isNaN(dniNum) || dniStr.length < 7 || dniStr.length > 8) {
      throw new Error('DNI debe tener 7 u 8 dígitos');
    }
    try {
      const idPersona = await this.afip.RegisterScopeThirteen.getTaxIDByDocument(dniNum);
      if (idPersona == null) return null;
      const cuit = Array.isArray(idPersona) ? idPersona[0] : idPersona;
      const cuitStr = String(cuit).replace(/\D/g, '');
      return cuitStr.length === 11 ? cuitStr : null;
    } catch (error) {
      arcaErr('❌ Error Padrón A13 (CUIT por DNI): ' + error.message);
      throw error;
    }
  }

  /**
   * Obtiene datos del contribuyente por CUIT (Constancia de Inscripción).
   * @param {string|number} cuit - CUIT 11 dígitos
   * @returns {Promise<Object|null>} personaReturn o null
   */
  async getDatosConstancia(cuit) {
    const cuitStr = String(cuit).replace(/\D/g, '');
    if (cuitStr.length !== 11) throw new Error('CUIT debe tener 11 dígitos');
    const idPersona = parseInt(cuitStr, 10);
    try {
      const personaReturn = await this.afip.RegisterInscriptionProof.getTaxpayerDetails(idPersona);
      return personaReturn || null;
    } catch (error) {
      arcaErr('❌ Error Constancia de Inscripción: ' + error.message);
      throw error;
    }
  }

  /**
   * Mapea respuesta de Constancia de Inscripción al formato cliente del ERP.
   * @param {Object} personaReturn - Respuesta getPersona_v2
   * @param {string} [dniOpcional] - DNI ingresado (Consumidor Final por DNI)
   * @returns {Object} { nombre, cuit, dni, condicion_iva, direccion, ciudad, provincia }
   */
  mapConstanciaToCliente(personaReturn, dniOpcional) {
    const dg = personaReturn.datosGenerales || {};
    const domicilio = dg.domicilioFiscal || {};
    const monotributo = personaReturn.datosMonotributo;
    const regimenGeneral = personaReturn.datosRegimenGeneral;

    let condicion_iva = 'Consumidor Final';
    const tieneMonotributo = monotributo && (
      (monotributo.categoriaMonotributo && typeof monotributo.categoriaMonotributo === 'object') ||
      (Array.isArray(monotributo.impuesto) && monotributo.impuesto.length > 0) ||
      (monotributo.actividadMonotributista && typeof monotributo.actividadMonotributista === 'object')
    );
    const tieneRegimenGeneral = regimenGeneral && (
      (Array.isArray(regimenGeneral.impuesto) && regimenGeneral.impuesto.length > 0) ||
      (Array.isArray(regimenGeneral.regimen) && regimenGeneral.regimen.length > 0)
    );
    if (tieneMonotributo) condicion_iva = 'Monotributo';
    else if (tieneRegimenGeneral) condicion_iva = 'Responsable Inscripto';

    const idPersona = dg.idPersona != null ? String(dg.idPersona).replace(/\D/g, '') : '';
    const cuitFormateado = idPersona.length === 11
      ? `${idPersona.slice(0, 2)}-${idPersona.slice(2, 10)}-${idPersona.slice(10)}`
      : '';

    let nombre = '';
    if (dg.razonSocial) nombre = dg.razonSocial.trim();
    else if (dg.apellido || dg.nombre) nombre = [dg.apellido, dg.nombre].filter(Boolean).join(' ').trim();

    const direccion = (domicilio.direccion || '').trim();
    const ciudad = (domicilio.localidad || '').trim();
    const provincia = (domicilio.descripcionProvincia || '').trim();

    const dni = dniOpcional != null && String(dniOpcional).trim() !== ''
      ? String(dniOpcional).replace(/\D/g, '')
      : (idPersona.length === 11 ? idPersona.slice(2, 10).replace(/^0+/, '') || idPersona.slice(2, 10) : '');

    return {
      nombre,
      cuit: cuitFormateado || idPersona,
      dni: dni || '',
      condicion_iva,
      direccion,
      ciudad,
      provincia
    };
  }
}

// Exportar instancia única (singleton)
const afipService = new AfipService();
export default afipService;