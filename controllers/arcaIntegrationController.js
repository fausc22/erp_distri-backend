const db = require('./db.js');
const { sincronizarNumeroAprobado, obtenerSiguienteNumeroFacturaDesdeARCA } = require('../utils/numeracionARCA');

/**
 * CONTROLADOR DE INTEGRACIÓN ARCA
 * Conecta las ventas de la BD con el microservicio ARCA
 */

// Importar dinámicamente el microservicio ARCA (ESM)
let billingController;
let afipConfig;
let billingTypes;

(async () => {
  try {
    const billingModule = await import('../arca-microservice/controllers/billing.controller.js');
    const configModule = await import('../arca-microservice/config/afip.config.js');
    const typesModule = await import('../arca-microservice/types/billing.types.js');
    
    billingController = billingModule.default;
    afipConfig = configModule.default;
    billingTypes = typesModule;
    
    // Mostrar información de configuración AFIP
    const ambienteAFIP = afipConfig.environment === 'prod' ? '🚀 PRODUCCIÓN' : '🧪 HOMOLOGACIÓN/TESTING';
    const cuit = afipConfig.CUIT || 'No configurado';
    const puntoVenta = afipConfig.puntoVentaDefault || 1;
    const tieneCertificados = !!(process.env.AFIP_CERT_PATH && process.env.AFIP_KEY_PATH);
    
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   ✅ MICROSERVICIO ARCA CARGADO          ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`📋 Configuración AFIP:`);
    console.log(`   - Ambiente: ${ambienteAFIP}`);
    console.log(`   - CUIT: ${cuit}`);
    console.log(`   - Punto de Venta: ${puntoVenta}`);
    console.log(`   - Certificados: ${tieneCertificados ? '✅ Configurados' : '❌ No configurados'}`);
    if (tieneCertificados) {
      console.log(`     • Certificado: ${process.env.AFIP_CERT_PATH || 'N/A'}`);
      console.log(`     • Clave: ${process.env.AFIP_KEY_PATH || 'N/A'}`);
    }
    console.log(`   - Método: SOAP Nativo (sin SDK paga)`);
    console.log(`   - WSAA: ${afipConfig.urls?.wsaa || 'N/A'}`);
    console.log(`   - WSFEv1: ${afipConfig.urls?.wsfev1 || 'N/A'}`);
    console.log(``);
  } catch (error) {
    console.error('❌ Error cargando microservicio ARCA:', error);
    console.error('   Detalles:', error.message);
    console.error('   Stack:', error.stack);
  }
})();

// Middleware para verificar que ARCA esté cargado
const verificarARCA = (req, res, next) => {
  if (!billingController) {
    return res.status(503).json({
      success: false,
      message: 'Servicio ARCA no disponible. Intente nuevamente en unos segundos.'
    });
  }
  next();
};

/**
 * ✅ MAPEO DE CONDICIONES IVA
 */
const MAPEO_CONDICIONES_IVA = {
  'Responsable Inscripto': 1,
  'Responsable No Inscripto': 2,
  'Exento': 4,
  'Consumidor Final': 5,
  'Monotributo': 6,
  'No Categorizado': 7,
  'Proveedor Exterior': 8
};

/**
 * ✅ MAPEO DE TIPOS FISCALES
 */
const MAPEO_TIPOS_COMPROBANTE = {
  'A': 1,  // Factura A
  'B': 6,  // Factura B
  'C': 11  // Factura C
};

/**
 * ✅ Determinar tipo de comprobante según condición IVA
 */
const determinarTipoComprobante = (condicionIVA, tipoFiscalOriginal) => {
  if (tipoFiscalOriginal && MAPEO_TIPOS_COMPROBANTE[tipoFiscalOriginal]) {
    return MAPEO_TIPOS_COMPROBANTE[tipoFiscalOriginal];
  }
  
  switch (condicionIVA) {
    case 'Responsable Inscripto':
    case 'Monotributo':
      return 1; // Factura A
    case 'Consumidor Final':
    case 'Exento':
      return 6; // Factura B
    default:
      return 6;
  }
};

/**
 * ✅ Determinar tipo de documento según CUIT/DNI
 */
const determinarTipoDocumento = (documento) => {
  if (!documento || documento === '0' || documento === '') {
    return 99;
  }
  
  const docLimpio = documento.toString().replace(/[.-]/g, '');
  
  if (docLimpio.length === 11) {
    return 80; // CUIT
  }
  
  if (docLimpio.length >= 7 && docLimpio.length <= 8) {
    return 96; // DNI
  }
  
  return 99;
};

/**
 * ✅ Verificar si el cliente está exento de IVA
 */
const esExento = (condicionIVA) => {
  return condicionIVA === 'Exento' || condicionIVA === 4;
};

/**
 * ✅ SOLICITAR CAE PARA UNA VENTA
 * POST /arca/solicitar-cae
 */
const solicitarCAE = async (req, res) => {
  const { ventaId } = req.body;
  
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  📋 Solicitando CAE para venta ${ventaId}      ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  
  if (!ventaId) {
    return res.status(400).json({
      success: false,
      message: 'ID de venta es requerido'
    });
  }

  try {
    // ============================================
    // 1️⃣ OBTENER DATOS DE LA VENTA
    // ============================================
    console.log('\n📄 Paso 1: Obteniendo datos de la venta...');
    
    const ventaQuery = `
      SELECT 
        id, fecha, cliente_nombre, cliente_cuit, cliente_condicion,
        tipo_f, subtotal, iva_total, total, cae_id, numero_factura
      FROM ventas 
      WHERE id = ?
    `;
    
    const [ventaRows] = await db.execute(ventaQuery, [ventaId]);
    
    if (ventaRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Venta no encontrada'
      });
    }
    
    const venta = ventaRows[0];
    
    if (venta.cae_id) {
      console.log(`⚠️ Venta ${ventaId} ya tiene CAE: ${venta.cae_id}`);
      return res.status(400).json({
        success: false,
        message: 'Esta venta ya tiene un CAE asignado',
        cae: venta.cae_id
      });
    }
    
    // ✅ Validar que no sea factura X (en negro - no requiere CAE)
    if (venta.tipo_f === 'X') {
      console.log(`⚠️ Venta ${ventaId} es tipo X (en negro) - No requiere CAE`);
      return res.status(400).json({
        success: false,
        message: 'Las facturas tipo X (en negro) no requieren CAE',
        tipo: venta.tipo_f
      });
    }
    
    console.log('✅ Venta obtenida:', {
      id: venta.id,
      cliente: venta.cliente_nombre,
      condicion: venta.cliente_condicion,
      tipo: venta.tipo_f,
      total: venta.total,
      numero_factura_actual: venta.numero_factura
    });
    
    // ============================================
    // 1.5️⃣ VALIDAR NUMERACIÓN CON ARCA (OPCIONAL)
    // ============================================
    // Intentamos validar con ARCA, pero si falla usamos el número local
    // ARCA validará definitivamente al crear el comprobante
    console.log('\n🔢 Intentando validar numeración con ARCA...');
    console.log(`   Número local actual: ${venta.numero_factura || 'N/A'}`);
    
    let numeroARCA = null;
    let numeroCompletoARCA = null;
    let puntoVentaARCA = null;
    let usarNumeroLocal = false;
    
    // Validar que tenga número local
    if (!venta.numero_factura) {
      console.error('❌ La venta no tiene número de factura asignado');
      return res.status(400).json({
        success: false,
        message: 'La venta no tiene número de factura asignado. Debe facturarse primero.'
      });
    }
    
    // Extraer punto de venta y número del formato local
    const matchNumero = venta.numero_factura.match(/([A-Z])\s+(\d{4})-(\d{8})/);
    if (!matchNumero) {
      console.error('❌ Formato de número de factura inválido:', venta.numero_factura);
      return res.status(400).json({
        success: false,
        message: 'Formato de número de factura inválido'
      });
    }
    
    const [, tipoFiscalLocal, puntoVentaLocal, numeroLocal] = matchNumero;
    puntoVentaARCA = puntoVentaLocal;
    numeroARCA = parseInt(numeroLocal);
    numeroCompletoARCA = venta.numero_factura;
    
    // Intentar consultar ARCA para validar (pero no es crítico si falla)
    try {
      const connection = await new Promise((resolve, reject) => {
        db.getConnection((err, conn) => {
          if (err) reject(err);
          else resolve(conn);
        });
      });
      
      try {
        const numeracion = await obtenerSiguienteNumeroFacturaDesdeARCA(
          connection, 
          venta.tipo_f
        );
        
        const numeroARCAObtenido = numeracion.numeroFactura;
        const numeroCompletoARCAObtenido = numeracion.numeroCompleto;
        
        console.log(`✅ Número desde ARCA: ${numeroCompletoARCAObtenido}`);
        
        // Si hay diferencia, actualizar
        if (venta.numero_factura !== numeroCompletoARCAObtenido) {
          console.log(`⚠️  Desincronización detectada:`);
          console.log(`   Local: ${venta.numero_factura}`);
          console.log(`   ARCA: ${numeroCompletoARCAObtenido}`);
          console.log(`   Actualizando venta con número de ARCA...`);
          
          const updateNumeroQuery = `
            UPDATE ventas 
            SET numero_factura = ?
            WHERE id = ?
          `;
          await db.execute(updateNumeroQuery, [numeroCompletoARCAObtenido, ventaId]);
          console.log(`✅ Número actualizado en BD: ${numeroCompletoARCAObtenido}`);
          
          // Actualizar variables para usar el número de ARCA
          numeroARCA = numeracion.numeroFactura;
          numeroCompletoARCA = numeroCompletoARCAObtenido;
          puntoVentaARCA = numeracion.puntoVenta;
        }
        
      } finally {
        connection.release();
      }
    } catch (error) {
      // ⚠️ Si falla la consulta a ARCA, usar el número local
      // ARCA validará definitivamente al crear el comprobante
      console.warn('⚠️  No se pudo consultar ARCA para validar numeración:', error.message);
      console.warn('   Usando número local. ARCA validará al crear el comprobante.');
      usarNumeroLocal = true;
      
      // El número ya está extraído del formato local, continuar con ese
    }
    
    // Usar el número (de ARCA si se obtuvo, o local si falló la consulta)
    if (!numeroARCA || !numeroCompletoARCA) {
      // Si no se pudo obtener de ARCA, usar el local extraído
      numeroARCA = parseInt(numeroLocal);
      numeroCompletoARCA = venta.numero_factura;
      puntoVentaARCA = puntoVentaLocal;
    }
    
    console.log(`📄 Usando número: ${numeroCompletoARCA} ${usarNumeroLocal ? '(local - ARCA validará al crear)' : '(validado con ARCA)'}`);
    
    // ============================================
    // 2️⃣ OBTENER PRODUCTOS DE LA VENTA
    // ============================================
    console.log('\n📦 Paso 2: Obteniendo productos...');
    
    const productosQuery = `
      SELECT 
        producto_nombre, 
        cantidad, 
        precio, 
        IVA as iva,
        subtotal
      FROM ventas_cont
      WHERE venta_id = ?
    `;
    
    const [productosRows] = await db.execute(productosQuery, [ventaId]);
    
    if (productosRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontraron productos para esta venta'
      });
    }
    
    console.log(`✅ ${productosRows.length} productos obtenidos`);
    
    // ============================================
    // 3️⃣ TRANSFORMAR DATOS AL FORMATO ARCA
    // ============================================
    console.log('\n🔄 Paso 3: Transformando datos al formato ARCA...');
    
    const condicionIVA = MAPEO_CONDICIONES_IVA[venta.cliente_condicion] || 5;
    const clienteEsExento = esExento(venta.cliente_condicion);
    
    console.log(`  - Condición IVA: ${venta.cliente_condicion} → ${condicionIVA} ${clienteEsExento ? '(EXENTO)' : ''}`);
    
    const tipoComprobante = determinarTipoComprobante(venta.cliente_condicion, venta.tipo_f);
    console.log(`  - Tipo Comprobante: ${venta.tipo_f} → ${tipoComprobante}`);
    
    const tipoDocumento = determinarTipoDocumento(venta.cliente_cuit);
    const numeroDocumento = tipoDocumento === 99 ? 0 : (venta.cliente_cuit || '0').replace(/[.-]/g, '');
    
    console.log(`  - Documento: Tipo ${tipoDocumento}, Número ${numeroDocumento}`);
    
    const fechaVenta = new Date(venta.fecha);
    const fechaFormateada = parseInt(
      `${fechaVenta.getFullYear()}${String(fechaVenta.getMonth() + 1).padStart(2, '0')}${String(fechaVenta.getDate()).padStart(2, '0')}`
    );
    
    const items = productosRows.map(prod => {
      const cantidad = parseFloat(prod.cantidad) || 0;
      const precioUnitario = parseFloat(prod.precio) || 0;
      const alicuotaIVA = clienteEsExento ? 3 : 5;
      
      return {
        descripcion: prod.producto_nombre,
        cantidad: cantidad,
        precioUnitario: precioUnitario,
        alicuotaIVA: alicuotaIVA
      };
    });
    
    console.log(`✅ Items preparados: ${items.length} productos`);
    console.log(`  - Alícuota IVA aplicada: ${clienteEsExento ? '0% (EXENTO)' : '21%'}`);
    
    const datosFactura = {
      tipoComprobante: tipoComprobante,
      concepto: 1,
      cliente: {
        tipoDocumento: tipoDocumento,
        numeroDocumento: numeroDocumento,
        condicionIVA: condicionIVA
      },
      items: items,
      fecha: fechaFormateada,
      moneda: 'PES',
      cotizacionMoneda: 1,
      // ✅ Usar el número obtenido desde ARCA (no el de la BD)
      puntoVenta: parseInt(puntoVentaARCA) || 1
    };
    
    console.log('✅ Datos preparados para ARCA');
    
    // ============================================
    // 4️⃣ LLAMAR AL MICROSERVICIO ARCA
    // ============================================
    console.log('\n📤 Paso 4: Enviando solicitud a ARCA/AFIP...');
    
    const mockReq = {
      body: datosFactura,
      user: req.user
    };
    
    const mockRes = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.jsonData = data;
        return this;
      },
      statusCode: 200,
      jsonData: null
    };
    
    await billingController.crearFactura(mockReq, mockRes);
    
    const responseARCA = mockRes.jsonData;
    
    if (!responseARCA || !responseARCA.success) {
      throw new Error(responseARCA?.message || 'Error desconocido de ARCA');
    }
    
    console.log('✅ Respuesta de ARCA recibida');
    console.log('🔍 Estructura respuesta:', JSON.stringify(responseARCA.data, null, 2));
    
    // ============================================
    // 5️⃣ EXTRAER CAE CON MANEJO ROBUSTO
    // ============================================
    console.log('\n🔍 Paso 5: Extrayendo datos del CAE...');
    
    const datosRespuesta = responseARCA.data;
    
    // ✅ CORRECCIÓN: Intentar múltiples rutas para encontrar el CAE
    const cae = datosRespuesta?.autorizacion?.cae || 
                datosRespuesta?.autorizacion?.CAE ||
                datosRespuesta?.cae ||
                datosRespuesta?.CAE;
                
    const caeVencimiento = datosRespuesta?.autorizacion?.fechaVencimiento ||
                          datosRespuesta?.autorizacion?.CAEFchVto ||
                          datosRespuesta?.fechaVencimiento ||
                          datosRespuesta?.CAEFchVto;
                          
    const caeResultado = datosRespuesta?.autorizacion?.resultado || 
                        datosRespuesta?.Resultado || 
                        'A';
    
    // ✅ Validar que obtuvimos el CAE
    if (!cae) {
      console.error('❌ No se pudo extraer CAE de la respuesta');
      console.error('Estructura recibida:', datosRespuesta);
      throw new Error('Respuesta de ARCA sin CAE válido');
    }
    
    console.log('✅ CAE extraído exitosamente:', cae);
    console.log('📅 Vencimiento:', caeVencimiento);
    
    // ============================================
    // 6️⃣ GUARDAR CAE EN LA BASE DE DATOS
    // ============================================
    console.log('\n💾 Paso 6: Guardando CAE en la base de datos...');
    
    const updateQuery = `
      UPDATE ventas 
      SET 
        cae_id = ?,
        cae_fecha = ?,
        cae_resultado = ?,
        cae_solicitud_fecha = NOW()
      WHERE id = ?
    `;
    
    await db.execute(updateQuery, [
      cae,
      caeVencimiento,
      caeResultado,
      ventaId
    ]);
    
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  ✅ CAE OBTENIDO Y GUARDADO EXITOSAMENTE  ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`🎉 CAE: ${cae}`);
    console.log(`📅 Vencimiento: ${caeVencimiento}`);
    console.log(`📄 Venta: ${ventaId}`);
    console.log(`${clienteEsExento ? '🔖 Cliente EXENTO (sin IVA)' : '💰 Cliente con IVA'}\n`);
    
    // ============================================
    // 7️⃣ ACTUALIZAR NÚMERO EN BD Y SINCRONIZAR
    // ============================================
    try {
      const numeroAprobado = datosRespuesta?.comprobante?.numero || 
                            datosRespuesta?.voucher_number ||
                            numeroARCA; // Usar el número que obtuvimos de ARCA
      
      const numeroCompletoAprobado = datosRespuesta?.comprobante?.numero 
        ? `${venta.tipo_f} ${puntoVentaARCA}-${String(datosRespuesta.comprobante.numero).padStart(8, '0')}`
        : numeroCompletoARCA;
      
      console.log(`🔄 Actualizando número en BD: ${numeroCompletoAprobado}`);
      
      // Actualizar numero_factura en la venta con el número aprobado
      const updateNumeroQuery = `
        UPDATE ventas 
        SET numero_factura = ?
        WHERE id = ?
      `;
      await db.execute(updateNumeroQuery, [numeroCompletoAprobado, ventaId]);
      console.log(`✅ Número actualizado en venta: ${numeroCompletoAprobado}`);
      
      // Sincronizar tabla de control
      if (numeroAprobado && venta.tipo_f) {
        console.log(`🔄 Sincronizando tabla local con número aprobado: ${numeroAprobado}`);
        
        const connection = await new Promise((resolve, reject) => {
          db.getConnection((err, conn) => {
            if (err) reject(err);
            else resolve(conn);
          });
        });
        
        try {
          await sincronizarNumeroAprobado(connection, venta.tipo_f, numeroAprobado);
        } finally {
          connection.release();
        }
      }
    } catch (syncError) {
      console.warn('⚠️  Error sincronizando número (no crítico):', syncError.message);
      // No fallar la operación si la sincronización falla
    }
    
    // ============================================
    // 8️⃣ RESPONDER AL CLIENTE CON ESTRUCTURA CORRECTA
    // ============================================
    res.json({
      success: true,
      message: 'CAE obtenido y guardado exitosamente',
      data: {
        ventaId: ventaId,
        // ✅ Estructura que espera el frontend
        autorizacion: {
          cae: cae,
          fechaVencimiento: caeVencimiento,
          resultado: caeResultado
        },
        comprobante: datosRespuesta?.comprobante || {
          numero: ventaId,
          puntoVenta: 1,
          tipo: tipoComprobante
        },
        importes: {
          total: venta.total
        },
        esExento: clienteEsExento
      }
    });
    
  } catch (error) {
    console.error('\n❌ ERROR SOLICITANDO CAE:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error al solicitar CAE',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * ✅ SOLICITAR CAE EN BATCH (MÚLTIPLES VENTAS)
 * POST /arca/solicitar-cae-batch
 * 
 * Solicita CAE para múltiples ventas de forma secuencial.
 * Maneja correctamente la numeración incluso si hay rechazos.
 * 
 * IMPORTANTE: Cada solicitud consulta ARCA para obtener el siguiente número,
 * por lo que si una venta es rechazada, las siguientes usan el número correcto.
 */
const solicitarCAEBatch = async (req, res) => {
  const { ventasIds } = req.body;
  
  if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Debe proporcionar un array de IDs de ventas'
    });
  }
  
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  📋 Solicitando CAE en BATCH             ║`);
  console.log(`║  Cantidad: ${ventasIds.length} ventas              ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  
  const resultados = [];
  const errores = [];
  
  // Procesar ventas SECUENCIALMENTE (no en paralelo)
  // Esto asegura que cada una consulte ARCA en orden
  for (let i = 0; i < ventasIds.length; i++) {
    const ventaId = ventasIds[i];
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📄 Procesando venta ${i + 1}/${ventasIds.length}: ${ventaId}`);
    console.log(`${'='.repeat(50)}`);
    
    try {
      // Crear un request simulado para reutilizar la lógica de solicitarCAE
      const mockReq = {
        body: { ventaId },
        user: req.user
      };
      
      const mockRes = {
        status: function(code) {
          this.statusCode = code;
          return this;
        },
        json: function(data) {
          this.jsonData = data;
          return this;
        },
        statusCode: 200,
        jsonData: null
      };
      
      // Llamar a la función de solicitar CAE individual
      await solicitarCAE(mockReq, mockRes);
      
      if (mockRes.statusCode === 200 && mockRes.jsonData?.success) {
        resultados.push({
          ventaId,
          success: true,
          data: mockRes.jsonData.data
        });
        console.log(`✅ Venta ${ventaId}: CAE obtenido exitosamente`);
      } else {
        errores.push({
          ventaId,
          success: false,
          error: mockRes.jsonData?.message || 'Error desconocido'
        });
        console.error(`❌ Venta ${ventaId}: ${mockRes.jsonData?.message || 'Error desconocido'}`);
      }
      
      // Pequeña pausa entre solicitudes para no saturar ARCA
      if (i < ventasIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms entre solicitudes
      }
      
    } catch (error) {
      errores.push({
        ventaId,
        success: false,
        error: error.message
      });
      console.error(`❌ Error procesando venta ${ventaId}:`, error.message);
    }
  }
  
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  📊 RESUMEN BATCH                        ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`✅ Exitosas: ${resultados.length}`);
  console.log(`❌ Errores: ${errores.length}`);
  console.log(`📊 Total: ${ventasIds.length}\n`);
  
  res.json({
    success: errores.length === 0,
    message: `Procesadas ${ventasIds.length} ventas: ${resultados.length} exitosas, ${errores.length} con errores`,
    data: {
      exitosas: resultados,
      errores: errores,
      total: ventasIds.length,
      exitosasCount: resultados.length,
      erroresCount: errores.length
    }
  });
};

/**
 * ✅ HEALTH CHECK DEL SERVICIO ARCA
 * GET /arca/health
 */
const healthCheck = async (req, res) => {
  try {
    if (!billingController) {
      return res.status(503).json({
        success: false,
        message: 'Servicio ARCA no disponible'
      });
    }
    
    const mockReq = { user: req.user };
    const mockRes = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.jsonData = data;
        return this;
      },
      statusCode: 200,
      jsonData: null
    };
    
    await billingController.verificarSalud(mockReq, mockRes);
    
    res.json({
      success: true,
      message: 'Servicio ARCA operativo',
      data: mockRes.jsonData,
      mapeos: {
        condicionesIVA: MAPEO_CONDICIONES_IVA,
        tiposComprobante: MAPEO_TIPOS_COMPROBANTE
      }
    });
    
  } catch (error) {
    console.error('❌ Error en health check:', error);
    res.status(503).json({
      success: false,
      message: 'Error verificando servicio ARCA',
      error: error.message
    });
  }
};

module.exports = {
  verificarARCA,
  solicitarCAE,
  solicitarCAEBatch,
  healthCheck
};