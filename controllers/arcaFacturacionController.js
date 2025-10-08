// controllers/arcaFacturacionController.js
const db = require('./dbPromise');
const axios = require('axios');
const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');

// ✅ CONFIGURACIÓN DEL MICROSERVICIO ARCA
const ARCA_CONFIG = {
  baseURL: process.env.ARCA_MICROSERVICE_URL,
  timeout: parseInt(process.env.ARCA_TIMEOUT) || 30000,
  cuit: process.env.AFIP_CUIT || '20409378472', // CUIT de prueba
  puntoVenta: parseInt(process.env.AFIP_PUNTO_VENTA) || 4
};

// ============================================
// MAPEOS DE DATOS
// ============================================

// Mapeo de condición IVA (texto → código ARCA)
const CONDICION_IVA_MAP = {
  'Responsable Inscripto': 1,
  'Responsable Monotributo': 6,
  'Consumidor Final': 5,
  'Exento': 4,
  'Monotributo': 6
};

// Mapeo de tipo fiscal (A/B/C → código ARCA)
const TIPO_FISCAL_MAP = {
  'A': 1,  // Factura A
  'B': 6,  // Factura B
  'C': 11  // Factura C
};

// Mapeo de tipo de documento
const TIPO_DOCUMENTO_MAP = {
  'CUIT': 80,
  'CUIL': 86,
  'DNI': 96,
  'CONSUMIDOR_FINAL': 99
};

// ============================================
// VALIDACIONES
// ============================================

/**
 * Validar dígito verificador de CUIT
 */
function validarCUIT(cuit) {
  if (!cuit) return false;
  
  const cuitLimpio = cuit.toString().replace(/[-\s]/g, '');
  
  if (!/^\d{11}$/.test(cuitLimpio)) return false;
  
  const multiplicadores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digitos = cuitLimpio.split('').map(Number);
  
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    suma += digitos[i] * multiplicadores[i];
  }
  
  const verificador = 11 - (suma % 11);
  const digitoVerificador = verificador === 11 ? 0 : verificador === 10 ? 9 : verificador;
  
  return digitoVerificador === digitos[10];
}

/**
 * Validar datos antes de enviar a ARCA
 */
function validarDatosParaFacturacion(venta, productos) {
  const errores = [];
  
  // 1. Validar tipo fiscal y condición IVA son compatibles
  if (venta.tipo_f === 'A' && venta.cliente_condicion !== 'Responsable Inscripto') {
    errores.push('❌ Factura A solo para Responsables Inscriptos');
  }
  
  // 2. Validar CUIT si es Factura A
  if (venta.tipo_f === 'A' && !venta.cliente_cuit) {
    errores.push('❌ CUIT obligatorio para Factura A');
  }
  
  // 3. Validar CUIT si está presente
  if (venta.cliente_cuit && !validarCUIT(venta.cliente_cuit)) {
    errores.push('❌ CUIT con dígito verificador incorrecto');
  }
  
  // 4. Validar que haya productos
  if (!productos || productos.length === 0) {
    errores.push('❌ La venta debe tener al menos un producto');
  }
  
  // 5. Validar totales coherentes
  const subtotalCalculado = productos.reduce((acc, p) => 
    acc + parseFloat(p.subtotal || 0), 0
  );
  
  if (Math.abs(subtotalCalculado - parseFloat(venta.subtotal)) > 0.01) {
    errores.push(`❌ Totales no coinciden: Calculado $${subtotalCalculado.toFixed(2)} vs BD $${venta.subtotal}`);
  }
  
  return errores;
}

// ============================================
// TRANSFORMACIÓN DE DATOS
// ============================================

/**
 * Calcular alícuota de IVA desde porcentaje
 */
function obtenerAlicuotaIVA(porcentajeIVA) {
  const porcentaje = parseFloat(porcentajeIVA);
  
  if (porcentaje === 0) return 3;    // 0%
  if (porcentaje === 10.5) return 4; // 10.5%
  if (porcentaje === 21) return 5;   // 21%
  if (porcentaje === 27) return 6;   // 27%
  
  // Por defecto 21%
  return 5;
}

/**
 * Transformar venta del ERP al formato ARCA
 */
function transformarVentaAFormatoARCA(venta, productos) {
  console.log('🔄 Transformando venta al formato ARCA...');
  
  // Determinar tipo de documento
  let tipoDocumento = TIPO_DOCUMENTO_MAP.CONSUMIDOR_FINAL;
  let numeroDocumento = 0;
  
  if (venta.cliente_cuit) {
    tipoDocumento = TIPO_DOCUMENTO_MAP.CUIT;
    numeroDocumento = venta.cliente_cuit.replace(/[-\s]/g, '');
  }
  
  // Obtener código de condición IVA
  const condicionIVA = CONDICION_IVA_MAP[venta.cliente_condicion] || 5;
  
  // Obtener tipo de comprobante
  const tipoComprobante = TIPO_FISCAL_MAP[venta.tipo_f] || 6;
  
  // Transformar productos al formato ARCA
  const items = productos.map(p => {
    const precioUnitario = parseFloat(p.precio || 0);
    const cantidad = parseFloat(p.cantidad || 0);
    const ivaProducto = parseFloat(p.IVA || p.iva || 0);
    
    // Calcular alícuota basada en el IVA del producto
    const porcentajeIVA = precioUnitario > 0 
      ? ((ivaProducto / cantidad) / precioUnitario) * 100 
      : 21;
    
    return {
      descripcion: p.producto_nombre || 'Producto sin nombre',
      cantidad: cantidad,
      precioUnitario: precioUnitario, // PRECIO SIN IVA
      alicuotaIVA: obtenerAlicuotaIVA(porcentajeIVA)
    };
  });
  
  // Construir objeto para ARCA
  const datosARCA = {
    tipoComprobante: tipoComprobante,
    concepto: 1, // 1 = Productos
    cliente: {
      tipoDocumento: tipoDocumento,
      numeroDocumento: parseInt(numeroDocumento) || 0,
      condicionIVA: condicionIVA
    },
    items: items
  };
  
  console.log('✅ Datos transformados:', {
    tipoComprobante: datosARCA.tipoComprobante,
    condicionIVA: datosARCA.cliente.condicionIVA,
    itemsCount: items.length
  });
  
  return datosARCA;
}

// ============================================
// FUNCIÓN PRINCIPAL: SOLICITAR CAE
// ============================================

/**
 * Solicitar CAE para una venta
 */
async function solicitarCAE(req, res) {
  const { ventaId } = req.body;
  
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  🧾 INICIANDO SOLICITUD DE CAE                 ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`📋 Venta ID: ${ventaId}`);
  
  const startTime = Date.now();
  
  try {
    // ============================================
    // PASO 1: OBTENER DATOS DE LA VENTA
    // ============================================
    console.log('\n📦 PASO 1: Obteniendo datos de la venta...');
    
    const [ventaResult] = await db.execute(
      'SELECT * FROM ventas WHERE id = ?',
      [ventaId]
    );
    
    if (ventaResult.length === 0) {
      console.log('❌ Venta no encontrada');
      return res.status(404).json({
        success: false,
        message: 'Venta no encontrada'
      });
    }
    
    const venta = ventaResult[0];
    console.log(`✅ Venta obtenida: Cliente ${venta.cliente_nombre}`);
    
    // Verificar si ya tiene CAE
    if (venta.cae_id) {
      console.log(`⚠️ La venta ya tiene CAE asignado: ${venta.cae_id}`);
      return res.status(400).json({
        success: false,
        message: 'Esta venta ya tiene un CAE asignado',
        data: {
          cae: venta.cae_id,
          fechaVencimiento: venta.cae_fecha
        }
      });
    }
    
    // ============================================
    // PASO 2: OBTENER PRODUCTOS DE LA VENTA
    // ============================================
    console.log('\n📦 PASO 2: Obteniendo productos...');
    
    const [productos] = await db.execute(
      'SELECT * FROM ventas_cont WHERE venta_id = ?',
      [ventaId]
    );
    
    if (productos.length === 0) {
      console.log('❌ No se encontraron productos');
      return res.status(400).json({
        success: false,
        message: 'La venta no tiene productos asociados'
      });
    }
    
    console.log(`✅ ${productos.length} productos encontrados`);
    
    // ============================================
    // PASO 3: VALIDAR DATOS
    // ============================================
    console.log('\n✅ PASO 3: Validando datos...');
    
    const erroresValidacion = validarDatosParaFacturacion(venta, productos);
    
    if (erroresValidacion.length > 0) {
      console.log('❌ Errores de validación:');
      erroresValidacion.forEach(err => console.log(err));
      
      return res.status(400).json({
        success: false,
        message: 'Errores de validación',
        errores: erroresValidacion
      });
    }
    
    console.log('✅ Validación exitosa');
    
    // ============================================
    // PASO 4: TRANSFORMAR DATOS AL FORMATO ARCA
    // ============================================
    console.log('\n🔄 PASO 4: Transformando datos...');
    
    const datosARCA = transformarVentaAFormatoARCA(venta, productos);
    
    console.log('✅ Datos transformados correctamente');
    
    // ============================================
    // PASO 5: ENVIAR A MICROSERVICIO ARCA
    // ============================================
    console.log('\n📤 PASO 5: Enviando a microservicio ARCA...');
    console.log(`🌐 URL: ${ARCA_CONFIG.baseURL}/facturas`);
    
    const arcaResponse = await axios.post(
      `${ARCA_CONFIG.baseURL}/facturas`,
      datosARCA,
      {
        timeout: ARCA_CONFIG.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    const tiempoRespuesta = Date.now() - startTime;
    console.log(`✅ Respuesta de ARCA recibida en ${tiempoRespuesta}ms`);
    
    if (!arcaResponse.data.success) {
      throw new Error(arcaResponse.data.message || 'Error desconocido de ARCA');
    }
    
    const { cae, fechaVencimiento } = arcaResponse.data.data.autorizacion;
    const { numero, puntoVenta } = arcaResponse.data.data.comprobante;
    
    console.log(`🎉 CAE OBTENIDO: ${cae}`);
    console.log(`📅 Vencimiento: ${fechaVencimiento}`);
    console.log(`📄 Número: ${puntoVenta}-${numero}`);
    
    // ============================================
    // PASO 6: ACTUALIZAR VENTA EN BD
    // ============================================
    console.log('\n💾 PASO 6: Actualizando venta en BD...');
    
    await db.execute(
      `UPDATE ventas 
       SET cae_id = ?, 
           cae_fecha = ?, 
           cae_resultado = 'A',
           cae_solicitud_fecha = NOW()
       WHERE id = ?`,
      [cae, fechaVencimiento, ventaId]
    );
    
    console.log('✅ Venta actualizada en BD');
    
    // ============================================
    // PASO 7: REGISTRAR EN LOG (OPCIONAL)
    // ============================================
    try {
      await db.execute(
        `INSERT INTO arca_solicitudes_log 
         (venta_id, request_data, response_data, estado, tiempo_respuesta)
         VALUES (?, ?, ?, 'EXITOSO', ?)`,
        [
          ventaId,
          JSON.stringify(datosARCA),
          JSON.stringify(arcaResponse.data),
          tiempoRespuesta
        ]
      );
    } catch (logError) {
      console.warn('⚠️ Error registrando en log (no crítico):', logError.message);
    }
    
    // ============================================
    // PASO 8: AUDITAR OPERACIÓN
    // ============================================
    await auditarOperacion(req, {
      accion: 'UPDATE',
      tabla: 'ventas',
      registroId: ventaId,
      datosNuevos: {
        cae_id: cae,
        cae_fecha: fechaVencimiento,
        cae_resultado: 'A'
      },
      detallesAdicionales: `CAE obtenido exitosamente - Venta #${ventaId} - Cliente: ${venta.cliente_nombre} - CAE: ${cae} - Tiempo: ${tiempoRespuesta}ms`
    });
    
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✅ CAE OBTENIDO EXITOSAMENTE                  ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    // ============================================
    // RESPUESTA EXITOSA
    // ============================================
    res.json({
      success: true,
      message: 'CAE obtenido exitosamente',
      data: {
        ventaId: ventaId,
        cae: cae,
        fechaVencimiento: fechaVencimiento,
        numeroComprobante: numero,
        puntoVenta: puntoVenta,
        tipoComprobante: datosARCA.tipoComprobante,
        cliente: venta.cliente_nombre,
        total: venta.total,
        tiempoRespuesta: `${tiempoRespuesta}ms`
      }
    });
    
  } catch (error) {
    const tiempoRespuesta = Date.now() - startTime;
    console.error('\n❌ ERROR EN SOLICITUD DE CAE:', error.message);
    
    // Registrar error en log
    try {
      await db.execute(
        `INSERT INTO arca_solicitudes_log 
         (venta_id, estado, mensaje_error, tiempo_respuesta)
         VALUES (?, 'ERROR', ?, ?)`,
        [ventaId, error.message, tiempoRespuesta]
      );
    } catch (logError) {
      console.warn('⚠️ Error registrando error en log:', logError.message);
    }
    
    // Auditar error
    await auditarOperacion(req, {
      accion: 'UPDATE',
      tabla: 'ventas',
      registroId: ventaId,
      detallesAdicionales: `Error solicitando CAE - Venta #${ventaId} - Error: ${error.message}`
    });
    
    // Respuesta de error
    res.status(500).json({
      success: false,
      message: 'Error al solicitar CAE',
      error: error.response?.data?.message || error.message,
      detalles: error.response?.data?.error || null
    });
  }
}

// ============================================
// EXPORTAR FUNCIONES
// ============================================

module.exports = {
  solicitarCAE,
  validarCUIT,
  transformarVentaAFormatoARCA
};