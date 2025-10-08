import afipService from './afip.service.js';
import afipConfig from '../config/afip.config.js';
import { validarDatosEntrada, validarDatosComprobante } from '../utils/validators.js';
import { transformarAFormatoARCA, formatearRespuestaARCA } from '../utils/formatters.js';
import { getNombreComprobante } from '../types/billing.types.js';

/**
 * SERVICIO DE FACTURACIÓN
 * 
 * Este servicio proporciona la lógica de negocio para
 * crear facturas electrónicas de forma simple
 */

class BillingService {
  constructor() {
    console.log('✓ Servicio de Facturación inicializado');
  }

  /**
   * CREAR FACTURA
   * 
   * Método principal para crear una factura electrónica
   * Maneja toda la lógica: validación, numeración, envío a ARCA
   * 
   * @param {Object} datosFactura - Datos de la factura en formato amigable
   * @returns {Promise<Object>} Resultado de la factura creada
   * 
   * FORMATO DE datosFactura:
   * {
   *   tipoComprobante: 6,          // 6 = Factura B (ver TIPOS_COMPROBANTE)
   *   concepto: 1,                 // 1 = Productos, 2 = Servicios, 3 = Ambos
   *   puntoVenta: 1,               // Punto de venta (opcional, usa default)
   *   cliente: {
   *     tipoDocumento: 99,         // 99 = Consumidor Final, 80 = CUIT, 96 = DNI
   *     numeroDocumento: 0,        // 0 para consumidor final
   *     condicionIVA: 5            // 5 = Consumidor Final, 1 = Responsable Inscripto
   *   },
   *   items: [
   *     {
   *       descripcion: "Producto 1",
   *       cantidad: 2,
   *       precioUnitario: 100,     // Precio SIN IVA
   *       alicuotaIVA: 5           // 5 = 21% (ver ALICUOTAS_IVA)
   *     }
   *   ],
   *   fecha: 20250930,             // Opcional, usa fecha actual si no se especifica
   *   moneda: 'PES',               // Opcional, por defecto PES (pesos)
   *   cotizacionMoneda: 1          // Opcional, por defecto 1
   * }
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
      console.log('✓ Datos válidos');
      
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
      console.log(`  - IVA: $${datosARCA.ImpIVA}`);
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
      
      // Agregar información adicional
      respuestaFormateada.items = datosFactura.items;
      respuestaFormateada.datosARCA = datosARCA; // Para debugging
      
      return respuestaFormateada;
      
    } catch (error) {
      console.error('\n❌ ERROR AL CREAR FACTURA:', error.message);
      throw error;
    }
  }

  /**
   * CREAR NOTA DE CRÉDITO
   * 
   * Crea una nota de crédito asociada a una factura
   * 
   * @param {Object} datosNota - Similar a datosFactura pero para nota de crédito
   * @returns {Promise<Object>} Resultado de la nota creada
   */
  async crearNotaCredito(datosNota) {
    // Las notas de crédito siguen el mismo proceso que las facturas
    // pero con tipo de comprobante diferente:
    // - Nota Crédito A: 3
    // - Nota Crédito B: 8
    // - Nota Crédito C: 13
    
    return await this.crearFactura(datosNota);
  }

  /**
   * CREAR NOTA DE DÉBITO
   * 
   * Crea una nota de débito asociada a una factura
   * 
   * @param {Object} datosNota - Similar a datosFactura pero para nota de débito
   * @returns {Promise<Object>} Resultado de la nota creada
   */
  async crearNotaDebito(datosNota) {
    // Las notas de débito siguen el mismo proceso que las facturas
    // pero con tipo de comprobante diferente:
    // - Nota Débito A: 2
    // - Nota Débito B: 7
    // - Nota Débito C: 12
    
    return await this.crearFactura(datosNota);
  }

  /**
   * CONSULTAR FACTURA
   * 
   * Consulta una factura ya emitida por su número
   * 
   * @param {number} numeroComprobante - Número del comprobante
   * @param {number} puntoVenta - Punto de venta
   * @param {number} tipoComprobante - Tipo de comprobante
   * @returns {Promise<Object>} Información de la factura
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
   * 
   * Consulta el último número de comprobante emitido
   * 
   * @param {number} tipoComprobante - Tipo de comprobante
   * @param {number} puntoVenta - Punto de venta (opcional)
   * @returns {Promise<number>} Último número
   */
  async obtenerUltimoNumero(tipoComprobante, puntoVenta = null) {
    const pv = puntoVenta || afipConfig.puntoVentaDefault;
    return await afipService.obtenerUltimoComprobante(pv, tipoComprobante);
  }

  /**
   * CREAR FACTURA PARA CONSUMIDOR FINAL
   * 
   * Método helper para crear rápidamente una Factura B a consumidor final
   * Este es el caso de uso más común
   * 
   * @param {Array} items - Array de items a facturar
   * @param {Object} opciones - Opciones adicionales (opcional)
   * @returns {Promise<Object>} Resultado de la factura
   */
  async crearFacturaConsumidorFinal(items, opciones = {}) {
    const datosFactura = {
      tipoComprobante: 6, // Factura B
      concepto: opciones.concepto || 1, // Productos
      cliente: {
        tipoDocumento: 99, // Consumidor Final
        numeroDocumento: 0,
        condicionIVA: 5 // Consumidor Final
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * CREAR FACTURA A RESPONSABLE INSCRIPTO
   * 
   * Método helper para crear una Factura A a un responsable inscripto
   * 
   * @param {string} cuit - CUIT del cliente
   * @param {Array} items - Array de items a facturar
   * @param {Object} opciones - Opciones adicionales (opcional)
   * @returns {Promise<Object>} Resultado de la factura
   */
  async crearFacturaResponsableInscripto(cuit, items, opciones = {}) {
    const datosFactura = {
      tipoComprobante: 1, // Factura A
      concepto: opciones.concepto || 1, // Productos
      cliente: {
        tipoDocumento: 80, // CUIT
        numeroDocumento: cuit,
        condicionIVA: 1 // Responsable Inscripto
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * CREAR FACTURA A MONOTRIBUTISTA
   * 
   * Método helper para crear una Factura B a un monotributista
   * 
   * @param {string} cuit - CUIT del monotributista
   * @param {Array} items - Array de items a facturar
   * @param {Object} opciones - Opciones adicionales (opcional)
   * @returns {Promise<Object>} Resultado de la factura
   */
  async crearFacturaMonotributista(cuit, items, opciones = {}) {
    const datosFactura = {
      tipoComprobante: 6, // Factura B
      concepto: opciones.concepto || 1, // Productos
      cliente: {
        tipoDocumento: 80, // CUIT
        numeroDocumento: cuit,
        condicionIVA: 6 // Monotributo
      },
      items: items,
      ...opciones
    };
    
    return await this.crearFactura(datosFactura);
  }

  /**
   * VERIFICAR SALUD DEL SERVICIO
   * 
   * Verifica que todo esté configurado y funcionando
   * 
   * @returns {Promise<Object>} Estado del servicio
   */
  async verificarSalud() {
    try {
      console.log('\n🏥 Verificando salud del servicio...');
      
      // Verificar estado del servidor de ARCA
      const estadoServidor = await afipService.verificarEstadoServidor();
      
      // Intentar obtener último comprobante de prueba
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

// Exportar instancia única (singleton)
const billingService = new BillingService();
export default billingService;