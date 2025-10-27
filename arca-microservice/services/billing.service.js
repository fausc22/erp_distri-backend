import afipService from './afip.service.js';
import afipConfig from '../config/afip.config.js';
import { validarDatosEntrada, validarDatosComprobante } from '../utils/validators.js';
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
    console.log('✓ Servicio de Facturación inicializado');
  }

  /**
   * CREAR FACTURA
   * ✅ ACTUALIZADO: Maneja todos los casos (RI, Monotributo, CF, Exento)
   */
  async crearFactura(datosFactura) {
    try {
      console.log('\n╔══════════════════════════════════════════╗');
      console.log('║   INICIANDO CREACIÓN DE FACTURA          ║');
      console.log('╚══════════════════════════════════════════╝');
      
      // PASO 1: Validar datos de entrada
      console.log('\n📋 PASO 1: Validando datos...');
      const validacion = validarDatosEntrada(datosFactura);
      
      if (!validacion.valido) {
        console.error('❌ Errores de validación:', validacion.errores);
        throw new Error('Datos inválidos:\n' + validacion.errores.join('\n'));
      }
      
      const condicionIVA = datosFactura.cliente.condicionIVA;
      const esClienteExento = esExento(condicionIVA);
      
      console.log('✓ Datos válidos');
      console.log(`  - Condición IVA: ${condicionIVA} ${esClienteExento ? '(EXENTO)' : ''}`);
      
      // PASO 2: Obtener punto de venta
      const puntoVenta = datosFactura.puntoVenta || afipConfig.puntoVentaDefault;
      console.log(`\n📍 PASO 2: Punto de venta: ${puntoVenta}`);
      
      // PASO 3: Obtener siguiente número de comprobante
      console.log('\n🔢 PASO 3: Obteniendo número de comprobante...');
      const ultimoNumero = await afipService.obtenerUltimoComprobante(
        puntoVenta,
        datosFactura.tipoComprobante
      );
      
      const numeroComprobante = ultimoNumero + 1;
      console.log(`✓ Número de comprobante: ${numeroComprobante}`);
      console.log(`  Tipo: ${getNombreComprobante(datosFactura.tipoComprobante)}`);
      
      // PASO 4: Transformar datos al formato ARCA
      console.log('\n🔄 PASO 4: Transformando datos al formato ARCA...');
      const datosARCA = transformarAFormatoARCA(
        datosFactura,
        numeroComprobante,
        puntoVenta
      );
      
      console.log('✓ Datos transformados:');
      console.log(`  - Importe Neto: $${datosARCA.ImpNeto}`);
      console.log(`  - IVA: $${datosARCA.ImpIVA} ${esClienteExento ? '(EXENTO - Sin IVA)' : ''}`);
      console.log(`  - Total: $${datosARCA.ImpTotal}`);
      
      // PASO 5: Validar estructura final
      console.log('\n✅ PASO 5: Validación final de estructura...');
      const validacionFinal = validarDatosComprobante(datosARCA);
      
      if (!validacionFinal.valido) {
        console.error('❌ Errores en estructura ARCA:', validacionFinal.errores);
        throw new Error('Estructura ARCA inválida:\n' + validacionFinal.errores.join('\n'));
      }
      console.log('✓ Estructura validada correctamente');
      
      // PASO 6: Enviar a ARCA y obtener CAE
      console.log('\n📤 PASO 6: Enviando a ARCA...');
      const respuestaARCA = await afipService.crearComprobante(datosARCA, false);
      
      console.log('\n╔══════════════════════════════════════════╗');
      console.log('║   ✓ FACTURA CREADA EXITOSAMENTE          ║');
      console.log('╚══════════════════════════════════════════╝');
      console.log(`\n🎉 CAE: ${respuestaARCA.CAE}`);
      console.log(`📅 Vencimiento CAE: ${respuestaARCA.CAEFchVto}`);
      console.log(`📄 Comprobante: ${puntoVenta.toString().padStart(4, '0')}-${numeroComprobante.toString().padStart(8, '0')}\n`);
      
      // PASO 7: Formatear respuesta para el usuario
      const respuestaFormateada = formatearRespuestaARCA(
        { ...respuestaARCA, voucher_number: numeroComprobante },
        datosARCA
      );
      
      respuestaFormateada.items = datosFactura.items;
      respuestaFormateada.datosARCA = datosARCA;
      
      return respuestaFormateada;
      
    } catch (error) {
      console.error('\n❌ ERROR AL CREAR FACTURA:', error.message);
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
      console.log(`\n🔍 Consultando factura ${puntoVenta}-${numeroComprobante}...`);
      
      const info = await afipService.obtenerInfoComprobante(
        numeroComprobante,
        puntoVenta,
        tipoComprobante
      );
      
      if (!info) {
        return {
          encontrada: false,
          mensaje: 'Comprobante no encontrado'
        };
      }
      
      return {
        encontrada: true,
        datos: info
      };
      
    } catch (error) {
      console.error('❌ Error al consultar factura:', error.message);
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
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   CREANDO NOTA DE CRÉDITO A              ║');
    console.log('╚══════════════════════════════════════════╝');
    
    console.log(`📄 Factura asociada: ${facturaAsociada.puntoVenta}-${facturaAsociada.numero}`);
    
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
    
    console.log(`💰 Items: ${items.length} productos`);
    console.log(`📋 Condición IVA: ${datosNota.cliente.condicionIVA}`);
    
    const resultado = await this.crearFactura(datosNota);
    
    console.log('✅ Nota de Crédito A creada exitosamente\n');
    return resultado;
    
  } catch (error) {
    console.error('❌ Error creando Nota de Crédito A:', error.message);
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
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   CREANDO NOTA DE CRÉDITO B              ║');
    console.log('╚══════════════════════════════════════════╝');
    
    console.log(`📄 Factura asociada: ${facturaAsociada.puntoVenta}-${facturaAsociada.numero}`);
    
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
    
    console.log(`💰 Items: ${items.length} productos`);
    console.log(`📋 Condición IVA: ${datosNota.cliente.condicionIVA}`);
    
    const resultado = await this.crearFactura(datosNota);
    
    console.log('✅ Nota de Crédito B creada exitosamente\n');
    return resultado;
    
  } catch (error) {
    console.error('❌ Error creando Nota de Crédito B:', error.message);
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
    console.error('❌ Error creando Nota de Crédito:', error.message);
    throw error;
  }
}

  /**
   * VERIFICAR SALUD DEL SERVICIO
   */
  async verificarSalud() {
    try {
      console.log('\n🏥 Verificando salud del servicio...');
      
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