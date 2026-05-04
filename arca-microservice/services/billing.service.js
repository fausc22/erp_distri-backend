import { createRequire } from 'module';
import afipService from './afip.service.js';
import afipConfig from '../config/afip.config.js';
import { validarDatosEntrada, validarDatosComprobante } from '../utils/validators.js';

const require = createRequire(import.meta.url);
const discordLogger = require('../../utils/discordLogger.js');

function arcaLog(msg, ctx = {}) {
  console.log(msg);
  discordLogger.sendArcaAfip(msg, ctx);
}
function arcaErr(msg, ctx = {}) {
  console.error(msg);
  discordLogger.sendArcaAfip(msg, ctx);
}
import { transformarAFormatoARCA, formatearRespuestaARCA } from '../utils/formatters.js';
import { 
  getNombreComprobante, 
  determinarTipoComprobante,
  determinarTipoDocumento,
  esExento,
  CONDICIONES_IVA,
  TIPOS_COMPROBANTE
} from '../types/billing.types.js';

/**
 * SERVICIO DE FACTURACIÓN
 */

class BillingService {
  constructor() {
    // Log silenciado - el servicio se inicializa junto con AfipService
  }

  /**
   * CREAR FACTURA
   * ✅ ACTUALIZADO: Maneja todos los casos (RI, Monotributo, CF, Exento)
   */
  async crearFactura(datosFactura) {
    try {
      arcaLog('INICIANDO CREACIÓN DE FACTURA');
      
      // PASO 1: Validar datos de entrada
      const validacion = validarDatosEntrada(datosFactura);
      
      if (!validacion.valido) {
        arcaErr('❌ Errores de validación: ' + validacion.errores.join('; '));
        throw new Error('Datos inválidos:\n' + validacion.errores.join('\n'));
      }
      
      const condicionIVA = datosFactura.cliente.condicionIVA;
      const esClienteExento = esExento(condicionIVA);
      
      arcaLog(`✓ Datos válidos | Condición IVA: ${condicionIVA} ${esClienteExento ? '(EXENTO)' : ''}`);
      
      // PASO 2: Obtener punto de venta
      const puntoVenta = datosFactura.puntoVenta || afipConfig.puntoVentaDefault;
      
      // PASO 3: Obtener siguiente número de comprobante
      let numeroComprobante;
      if (datosFactura.numeroComprobante !== undefined && datosFactura.numeroComprobante !== null) {
        numeroComprobante = parseInt(datosFactura.numeroComprobante);
        arcaLog(`✓ Número de comprobante proporcionado: ${numeroComprobante} | Tipo: ${getNombreComprobante(datosFactura.tipoComprobante)}`);
      } else {
        const ultimoNumero = await afipService.obtenerUltimoComprobante(
          puntoVenta,
          datosFactura.tipoComprobante
        );
        
        numeroComprobante = ultimoNumero + 1;
        arcaLog(`✓ Número de comprobante: ${numeroComprobante} | Tipo: ${getNombreComprobante(datosFactura.tipoComprobante)}`);
      }
      
      // PASO 4: Transformar datos al formato ARCA
      const datosARCA = transformarAFormatoARCA(
        datosFactura,
        numeroComprobante,
        puntoVenta
      );
      
      arcaLog(`✓ Datos transformados | Neto: $${datosARCA.ImpNeto} | IVA: $${datosARCA.ImpIVA} | Total: $${datosARCA.ImpTotal}`);
      
      // PASO 5: Validar estructura final
      const validacionFinal = validarDatosComprobante(datosARCA);
      
      if (!validacionFinal.valido) {
        arcaErr('❌ Errores en estructura ARCA: ' + validacionFinal.errores.join('; '));
        throw new Error('Estructura ARCA inválida:\n' + validacionFinal.errores.join('\n'));
      }
      
      // PASO 6: Enviar a ARCA y obtener CAE
      arcaLog('📤 Enviando a ARCA...');
      const respuestaARCA = await afipService.crearComprobante(datosARCA, false);
      
      arcaLog(`✓ FACTURA CREADA EXITOSAMENTE | CAE: ${respuestaARCA.CAE} | Vto CAE: ${respuestaARCA.CAEFchVto} | Comprobante: ${puntoVenta.toString().padStart(4, '0')}-${numeroComprobante.toString().padStart(8, '0')}`);
      
      // PASO 7: Formatear respuesta para el usuario
      const respuestaFormateada = formatearRespuestaARCA(
        { ...respuestaARCA, voucher_number: numeroComprobante },
        datosARCA
      );
      
      respuestaFormateada.items = datosFactura.items;
      respuestaFormateada.datosARCA = datosARCA;
      
      return respuestaFormateada;
      
    } catch (error) {
      arcaErr('❌ ERROR AL CREAR FACTURA: ' + error.message);
      throw error;
    }
  }

  /**
   * CREAR FACTURA PARA CONSUMIDOR FINAL
   * ✅ Puede incluir DNI del consumidor
   */
  async crearFacturaConsumidorFinal(items, opciones = {}) {
    const datosFactura = {
      tipoComprobante: TIPOS_COMPROBANTE.FACTURA_B,
      concepto: opciones.concepto || 1,
      cliente: {
        tipoDocumento: opciones.dni ? determinarTipoDocumento(opciones.dni) : 99,
        numeroDocumento: opciones.dni || 0,
        condicionIVA: CONDICIONES_IVA.CONSUMIDOR_FINAL
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * CREAR FACTURA A RESPONSABLE INSCRIPTO
   */
  async crearFacturaResponsableInscripto(cuit, items, opciones = {}) {
    const datosFactura = {
      tipoComprobante: TIPOS_COMPROBANTE.FACTURA_A,
      concepto: opciones.concepto || 1,
      cliente: {
        tipoDocumento: 80, // CUIT
        numeroDocumento: cuit,
        condicionIVA: CONDICIONES_IVA.RESPONSABLE_INSCRIPTO
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * CREAR FACTURA A MONOTRIBUTISTA
   */
  async crearFacturaMonotributista(cuit, items, opciones = {}) {
    const datosFactura = {
      tipoComprobante: TIPOS_COMPROBANTE.FACTURA_A,
      concepto: opciones.concepto || 1,
      cliente: {
        tipoDocumento: 80, // CUIT
        numeroDocumento: cuit,
        condicionIVA: CONDICIONES_IVA.MONOTRIBUTO
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * ✅ NUEVO: CREAR FACTURA A EXENTO
   */
  async crearFacturaExento(cuitODni, items, opciones = {}) {
    const tipoDoc = determinarTipoDocumento(cuitODni);
    
    const datosFactura = {
      tipoComprobante: TIPOS_COMPROBANTE.FACTURA_B,
      concepto: opciones.concepto || 1,
      cliente: {
        tipoDocumento: tipoDoc,
        numeroDocumento: cuitODni || 0,
        condicionIVA: CONDICIONES_IVA.EXENTO
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * CREAR NOTA DE CRÉDITO
   */
  async crearNotaCredito(datosNota) {
    return await this.crearFactura(datosNota);
  }

  /**
   * CONSULTAR FACTURA
   */
  async consultarFactura(numeroComprobante, puntoVenta, tipoComprobante) {
    try {
      arcaLog(`🔍 Consultando factura ${puntoVenta}-${numeroComprobante}...`);
      
      const info = await afipService.obtenerInfoComprobante(
        numeroComprobante,
        puntoVenta,
        tipoComprobante
      );
      
      if (!info) {
        arcaLog('ℹ Comprobante no encontrado');
        return {
          encontrada: false,
          mensaje: 'Comprobante no encontrado'
        };
      }
      
      arcaLog('✓ Factura consultada correctamente');
      return {
        encontrada: true,
        datos: info
      };
      
    } catch (error) {
      arcaErr('❌ Error al consultar factura: ' + error.message);
      throw error;
    }
  }

  /**
   * OBTENER ÚLTIMO NÚMERO
   */
  async obtenerUltimoNumero(tipoComprobante, puntoVenta = null) {
    const pv = puntoVenta || afipConfig.puntoVentaDefault;
    return await afipService.obtenerUltimoComprobante(pv, tipoComprobante);
  }



  /**
 * ✅ CREAR NOTA DE CRÉDITO A (Responsable Inscripto/Monotributo)
 * Anula total o parcialmente una Factura A
 */
async crearNotaCreditoA(
  facturaAsociada, // { tipo, puntoVenta, numero, cuit?, fecha? }
  clienteCuit,
  items,
  opciones = {}
) {
  try {
    arcaLog('CREANDO NOTA DE CRÉDITO A');
    arcaLog(`📄 Factura asociada: ${facturaAsociada.puntoVenta}-${facturaAsociada.numero}`);
    
    const datosNota = {
      tipoComprobante: TIPOS_COMPROBANTE.NOTA_CREDITO_A,
      concepto: opciones.concepto || 1,
      cliente: {
        tipoDocumento: 80, // CUIT
        numeroDocumento: clienteCuit,
        condicionIVA: opciones.condicionIVA || CONDICIONES_IVA.RESPONSABLE_INSCRIPTO
      },
      items: items,
      comprobantesAsociados: [facturaAsociada],
      ...opciones
    };
    
    arcaLog(`💰 Items: ${items.length} productos | Condición IVA: ${datosNota.cliente.condicionIVA}`);
    
    const resultado = await this.crearFactura(datosNota);
    
    arcaLog('✅ Nota de Crédito A creada exitosamente');
    return resultado;
    
  } catch (error) {
    arcaErr('❌ Error creando Nota de Crédito A: ' + error.message);
    throw error;
  }
}

/**
 * ✅ CREAR NOTA DE CRÉDITO B (Consumidor Final/Exento)
 * Anula total o parcialmente una Factura B
 */
async crearNotaCreditoB(
  facturaAsociada, // { tipo, puntoVenta, numero, fecha? }
  items,
  opciones = {}
) {
  try {
    arcaLog('CREANDO NOTA DE CRÉDITO B');
    arcaLog(`📄 Factura asociada: ${facturaAsociada.puntoVenta}-${facturaAsociada.numero}`);
    
    // Determinar documento del cliente
    const tipoDoc = opciones.dni ? determinarTipoDocumento(opciones.dni) : 99;
    const numeroDoc = opciones.dni || 0;
    
    const datosNota = {
      tipoComprobante: TIPOS_COMPROBANTE.NOTA_CREDITO_B,
      concepto: opciones.concepto || 1,
      cliente: {
        tipoDocumento: tipoDoc,
        numeroDocumento: numeroDoc,
        condicionIVA: opciones.condicionIVA || CONDICIONES_IVA.CONSUMIDOR_FINAL
      },
      items: items,
      comprobantesAsociados: [facturaAsociada],
      ...opciones
    };
    
    arcaLog(`💰 Items: ${items.length} productos | Condición IVA: ${datosNota.cliente.condicionIVA}`);
    
    const resultado = await this.crearFactura(datosNota);
    
    arcaLog('✅ Nota de Crédito B creada exitosamente');
    return resultado;
    
  } catch (error) {
    arcaErr('❌ Error creando Nota de Crédito B: ' + error.message);
    throw error;
  }
}

/**
 * ✅ CREAR NOTA DE CRÉDITO GENÉRICA (detecta automáticamente tipo A o B)
 * Wrapper que decide entre NC A o NC B según condición IVA
 */
async crearNotaCredito(
  facturaAsociada, // { tipo, puntoVenta, numero, cuit?, fecha? }
  datosCliente, // { cuit?, dni?, condicionIVA }
  items,
  opciones = {}
) {
  try {
    const condicionIVA = datosCliente.condicionIVA || CONDICIONES_IVA.CONSUMIDOR_FINAL;
    
    // ✅ Determinar tipo de NC según condición IVA
    if (condicionIVA === CONDICIONES_IVA.RESPONSABLE_INSCRIPTO || 
        condicionIVA === CONDICIONES_IVA.MONOTRIBUTO) {
      
      if (!datosCliente.cuit) {
        throw new Error('CUIT es obligatorio para Nota de Crédito A');
      }
      
      return await this.crearNotaCreditoA(
        facturaAsociada,
        datosCliente.cuit,
        items,
        { ...opciones, condicionIVA }
      );
      
    } else {
      // Consumidor Final o Exento
      return await this.crearNotaCreditoB(
        facturaAsociada,
        items,
        { ...opciones, dni: datosCliente.dni, condicionIVA }
      );
    }
    
  } catch (error) {
    arcaErr('❌ Error creando Nota de Crédito: ' + error.message);
    throw error;
  }
}

  /**
   * ✅ CREAR NOTA DE DÉBITO A (Responsable Inscripto/Monotributo)
   * Incrementa el importe de una Factura A
   */
  async crearNotaDebitoA(
    facturaAsociada, // { tipo, puntoVenta, numero, cuit?, fecha? }
    clienteCuit,
    items,
    opciones = {}
  ) {
    try {
      arcaLog('CREANDO NOTA DE DÉBITO A');
      arcaLog(`📄 Factura asociada: ${facturaAsociada.puntoVenta}-${facturaAsociada.numero}`);
      
      const datosNota = {
        tipoComprobante: TIPOS_COMPROBANTE.NOTA_DEBITO_A,
        concepto: opciones.concepto || 1,
        cliente: {
          tipoDocumento: 80, // CUIT
          numeroDocumento: clienteCuit,
          condicionIVA: opciones.condicionIVA || CONDICIONES_IVA.RESPONSABLE_INSCRIPTO
        },
        items: items,
        comprobantesAsociados: [facturaAsociada],
        ...opciones
      };
      
      arcaLog(`💰 Items: ${items.length} productos | Condición IVA: ${datosNota.cliente.condicionIVA}`);
      
      const resultado = await this.crearFactura(datosNota);
      
      arcaLog('✅ Nota de Débito A creada exitosamente');
      return resultado;
      
    } catch (error) {
      arcaErr('❌ Error creando Nota de Débito A: ' + error.message);
      throw error;
    }
  }

  /**
   * ✅ CREAR NOTA DE DÉBITO B (Consumidor Final/Exento)
   * Incrementa el importe de una Factura B
   */
  async crearNotaDebitoB(
    facturaAsociada, // { tipo, puntoVenta, numero, fecha? }
    items,
    opciones = {}
  ) {
    try {
      arcaLog('CREANDO NOTA DE DÉBITO B');
      arcaLog(`📄 Factura asociada: ${facturaAsociada.puntoVenta}-${facturaAsociada.numero}`);
      
      // Determinar documento del cliente
      const tipoDoc = opciones.dni ? determinarTipoDocumento(opciones.dni) : 99;
      const numeroDoc = opciones.dni || 0;
      
      const datosNota = {
        tipoComprobante: TIPOS_COMPROBANTE.NOTA_DEBITO_B,
        concepto: opciones.concepto || 1,
        cliente: {
          tipoDocumento: tipoDoc,
          numeroDocumento: numeroDoc,
          condicionIVA: opciones.condicionIVA || CONDICIONES_IVA.CONSUMIDOR_FINAL
        },
        items: items,
        comprobantesAsociados: [facturaAsociada],
        ...opciones
      };
      
      arcaLog(`💰 Items: ${items.length} productos | Condición IVA: ${datosNota.cliente.condicionIVA}`);
      
      const resultado = await this.crearFactura(datosNota);
      
      arcaLog('✅ Nota de Débito B creada exitosamente');
      return resultado;
      
    } catch (error) {
      arcaErr('❌ Error creando Nota de Débito B: ' + error.message);
      throw error;
    }
  }

  /**
   * ✅ CREAR NOTA DE DÉBITO GENÉRICA (detecta automáticamente tipo A o B)
   * Wrapper que decide entre ND A o ND B según condición IVA
   */
  async crearNotaDebito(
    facturaAsociada, // { tipo, puntoVenta, numero, cuit?, fecha? }
    datosCliente, // { cuit?, dni?, condicionIVA }
    items,
    opciones = {}
  ) {
    try {
      const condicionIVA = datosCliente.condicionIVA || CONDICIONES_IVA.CONSUMIDOR_FINAL;
      
      // ✅ Determinar tipo de ND según condición IVA
      if (condicionIVA === CONDICIONES_IVA.RESPONSABLE_INSCRIPTO || 
          condicionIVA === CONDICIONES_IVA.MONOTRIBUTO) {
        
        if (!datosCliente.cuit) {
          throw new Error('CUIT es obligatorio para Nota de Débito A');
        }
        
        return await this.crearNotaDebitoA(
          facturaAsociada,
          datosCliente.cuit,
          items,
          { ...opciones, condicionIVA }
        );
        
      } else {
        // Consumidor Final o Exento
        return await this.crearNotaDebitoB(
          facturaAsociada,
          items,
          { ...opciones, dni: datosCliente.dni, condicionIVA }
        );
      }
      
    } catch (error) {
      arcaErr('❌ Error creando Nota de Débito: ' + error.message);
      throw error;
    }
  }

  /**
   * VERIFICAR SALUD DEL SERVICIO
   */
  async verificarSalud() {
    try {
      arcaLog('🏥 Verificando salud del servicio...');
      
      const estadoServidor = await afipService.verificarEstadoServidor();
      const ultimoComprobante = await afipService.obtenerUltimoComprobante(1, 6);
      
      return {
        estado: 'OK',
        servidor: estadoServidor,
        ultimoComprobante: ultimoComprobante,
        ambiente: afipConfig.environment,
        cuit: afipConfig.CUIT,
        mensaje: 'Servicio de facturación operativo'
      };
      
    } catch (error) {
      arcaErr('❌ Error al verificar salud: ' + error.message);
      return {
        estado: 'ERROR',
        error: error.message,
        mensaje: 'Error al verificar el servicio'
      };
    }
  }
}






const billingService = new BillingService();
export default billingService;