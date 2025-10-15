const db = require('./db.js');

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
    
    console.log('✅ Microservicio ARCA cargado correctamente');
  } catch (error) {
    console.error('❌ Error cargando microservicio ARCA:', error);
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
        tipo_f, subtotal, iva_total, total, cae_id
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
    
    console.log('✅ Venta obtenida:', {
      id: venta.id,
      cliente: venta.cliente_nombre,
      condicion: venta.cliente_condicion,
      tipo: venta.tipo_f,
      total: venta.total
    });
    
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
      cotizacionMoneda: 1
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
    // 7️⃣ RESPONDER AL CLIENTE CON ESTRUCTURA CORRECTA
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
  healthCheck
};