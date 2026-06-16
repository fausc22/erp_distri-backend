const db = require('./db.js');
const { sincronizarNumeroAprobado } = require('../utils/numeracionARCA');
const { validarCuit } = require('../utils/validadoresCliente');
const { roundFacturacion } = require('../utils/rounding');

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
  } catch (error) {
    console.error('❌ Error cargando microservicio ARCA:', error.message);
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
 * ✅ Determinar tipo de comprobante según condición IVA y tipo de documento
 */
const determinarTipoComprobante = (condicionIVA, tipoFiscalOriginal, tipoDoc) => {
  // ✅ Si es una nota, determinar el tipo según tipo_doc y tipo_f
  if (tipoDoc === 'NOTA_DEBITO' || tipoDoc === 'NOTA_CREDITO') {
    const esNotaDebito = tipoDoc === 'NOTA_DEBITO';
    
    if (tipoFiscalOriginal === 'A') {
      return esNotaDebito ? 2 : 3; // NOTA_DEBITO_A: 2, NOTA_CREDITO_A: 3
    } else if (tipoFiscalOriginal === 'B') {
      return esNotaDebito ? 7 : 8; // NOTA_DEBITO_B: 7, NOTA_CREDITO_B: 8
    } else {
      // Tipo X no requiere CAE, pero por si acaso
      return esNotaDebito ? 7 : 8; // Default a tipo B
    }
  }
  
  // ✅ Si es factura normal
  if (tipoFiscalOriginal && MAPEO_TIPOS_COMPROBANTE[tipoFiscalOriginal]) {
    return MAPEO_TIPOS_COMPROBANTE[tipoFiscalOriginal];
  }
  
  // ✅ CORREGIDO: 
  // - Tipo A: Solo Responsable Inscripto
  // - Tipo B: Exento, Consumidor Final, Monotributo
  switch (condicionIVA) {
    case 'Responsable Inscripto':
      return 1; // Factura A
    case 'Consumidor Final':
    case 'Exento':
    case 'Monotributo':
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
 * Fecha actual en formato ARCA (YYYYMMDD)
 */
const obtenerFechaActualARCA = () => {
  // Forzar zona horaria Argentina para evitar que en servidores UTC una factura emitida
  // después de las 21hs de Buenos Aires use el día siguiente como fecha.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const anio = partes.find(p => p.type === 'year').value;
  const mes  = partes.find(p => p.type === 'month').value;
  const dia  = partes.find(p => p.type === 'day').value;
  return parseInt(`${anio}${mes}${dia}`);
};

const arcaFechaToSqlDate = (fechaArca) => {
  const fechaStr = String(fechaArca || '');
  if (!/^\d{8}$/.test(fechaStr)) return null;
  return `${fechaStr.slice(0, 4)}-${fechaStr.slice(4, 6)}-${fechaStr.slice(6, 8)}`;
};

const getDbConnection = () => {
  return new Promise((resolve, reject) => {
    db.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });
};

const executeWithConnection = (connection, query, params = []) => {
  return new Promise((resolve, reject) => {
    connection.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

/**
 * ✅ SOLICITAR CAE PARA UNA VENTA
 * POST /arca/solicitar-cae
 */
const solicitarCAE = async (req, res) => {
  const { ventaId } = req.body;
  let lockName = null;
  let lockAcquired = false;
  let lockConnection = null;
  let intentoId = null;
  const inicioSolicitudMs = Date.now();
  
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
        id, fecha, fecha_fiscal, cliente_nombre, cliente_cuit, cliente_condicion,
        tipo_f, tipo_doc, subtotal, iva_total, exento, total, cae_id, numero_factura,
        venta_referencia_id
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
    
    let venta = ventaRows[0];
    
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

    // Fase 4: solo para factura A el cliente debe tener CUIT válido (ARCA lo exige).
    // Factura B (Consumidor Final) puede ir sin CUIT: se envía tipoDoc 99 y numeroDoc 0 como antes.
    if (venta.tipo_f === 'A') {
      const cuitVenta = (venta.cliente_cuit || '').toString().trim();
      if (!cuitVenta || cuitVenta.replace(/\D/g, '').length !== 11) {
        return res.status(400).json({
          success: false,
          message: 'Para facturas tipo A el cliente debe tener CUIT (11 dígitos). Actualizá el cliente con un CUIT válido o validalo con AFIP desde el formulario de cliente.'
        });
      }
      const resultadoCuit = validarCuit(venta.cliente_cuit);
      if (!resultadoCuit.valido) {
        return res.status(400).json({
          success: false,
          message: `El CUIT del cliente es inválido (${resultadoCuit.mensaje || 'dígito verificador incorrecto'}). Corregí los datos del cliente o validalo con AFIP.`
        });
      }
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
    // 1.5️⃣ VALIDAR NUMERACIÓN (SIN PRE-ASIGNAR EN BD)
    // ============================================
    // Para FACTURAS, ARCA define el número final al autorizar.
    // No se actualiza numero_factura antes del CAE para evitar duplicados.
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
    
    // ✅ Extraer punto de venta y número del formato local
    // Formato de factura: "A 0004-00000001"
    // Formato de nota: "0004-00001"
    let matchNumero;
    let tipoFiscalLocal, puntoVentaLocal, numeroLocal;
    
    // Intentar formato de factura primero
    matchNumero = venta.numero_factura.match(/([A-Z])\s+(\d{4})-(\d{8})/);
    if (matchNumero) {
      [, tipoFiscalLocal, puntoVentaLocal, numeroLocal] = matchNumero;
    } else {
      // Intentar formato de nota (sin tipo fiscal al inicio)
      matchNumero = venta.numero_factura.match(/(\d{4})-(\d{5})/);
      if (matchNumero) {
        puntoVentaLocal = matchNumero[1];
        numeroLocal = matchNumero[2];
        tipoFiscalLocal = venta.tipo_f || 'B'; // Usar tipo_f de la venta
      } else {
        console.error('❌ Formato de número inválido:', venta.numero_factura);
        return res.status(400).json({
          success: false,
          message: 'Formato de número inválido'
        });
      }
    }
    
    puntoVentaARCA = puntoVentaLocal;
    numeroARCA = parseInt(numeroLocal);
    numeroCompletoARCA = venta.numero_factura;

    // Serializar solicitudes por tipo fiscal + punto de venta.
    // Así el orden de envío queda alineado con el orden autorizado por ARCA.
    lockName = `arca_cae_${tipoFiscalLocal || venta.tipo_f || 'UNK'}_${puntoVentaLocal}`;
    lockConnection = await getDbConnection();
    const lockRows = await executeWithConnection(lockConnection, 'SELECT GET_LOCK(?, ?) AS lock_acquired', [lockName, 30]);
    if (!lockRows?.[0] || lockRows[0].lock_acquired !== 1) {
      throw new Error(`No se pudo obtener lock de numeración (${lockName}). Reintente en unos segundos.`);
    }
    lockAcquired = true;
    console.log(`🔒 Lock de numeración adquirido: ${lockName}`);

    // Revalidar estado de CAE dentro de la sección crítica para evitar doble emisión.
    const ventaRefrescadaRows = await executeWithConnection(
      lockConnection,
      'SELECT id, cae_id, numero_factura, fecha, fecha_fiscal, tipo_f, tipo_doc, cliente_cuit, cliente_condicion, exento, total, venta_referencia_id FROM ventas WHERE id = ? LIMIT 1',
      [ventaId]
    );
    if (!ventaRefrescadaRows || ventaRefrescadaRows.length === 0) {
      throw new Error('Venta no encontrada al revalidar estado bajo lock');
    }
    const ventaRefrescada = ventaRefrescadaRows[0];
    if (ventaRefrescada.cae_id) {
      console.log(`ℹ️ Venta ${ventaId} ya tenía CAE bajo lock: ${ventaRefrescada.cae_id}`);
      return res.json({
        success: true,
        message: 'La venta ya tenía CAE asignado',
        existing: true,
        data: {
          ventaId,
          autorizacion: {
            cae: ventaRefrescada.cae_id
          },
          comprobante: {
            numero: ventaRefrescada.numero_factura
          }
        }
      });
    }
    venta = { ...venta, ...ventaRefrescada };
    
    // ✅ Si es una NOTA, NO validar numeración con ARCA (las notas tienen numeración independiente)
    // Solo validar numeración para FACTURAS
    const esNota = venta.tipo_doc === 'NOTA_DEBITO' || venta.tipo_doc === 'NOTA_CREDITO';
    
    if (!esNota) {
      // En facturas, el número definitivo lo devuelve ARCA al aprobar.
      console.log('ℹ️ Factura detectada: numeración final definida por ARCA al autorizar.');
      usarNumeroLocal = false;
    } else {
      // ✅ Para notas, consultar ARCA para obtener el siguiente número del tipo correcto
      console.log(`📝 Es una ${venta.tipo_doc} - Consultando numeración en ARCA para este tipo de comprobante...`);
      
      try {
        // Importar servicio ARCA para consultar último comprobante del tipo de nota
        const afipServiceModule = await import('../arca-microservice/services/afip.service.js');
        const afipService = afipServiceModule.default;
        
        // Determinar tipo de comprobante ARCA para la nota
        const tipoComprobanteNota = determinarTipoComprobante(venta.cliente_condicion, venta.tipo_f, venta.tipo_doc);
        
        console.log(`🔢 Consultando último comprobante en ARCA para tipo ${tipoComprobanteNota} (${venta.tipo_doc})...`);
        
        const ultimoNumeroARCA = await afipService.obtenerUltimoComprobante(
          parseInt(puntoVentaLocal),
          tipoComprobanteNota
        );
        
        const siguienteNumeroARCA = ultimoNumeroARCA + 1;
        
        console.log(`✅ ARCA - Último autorizado para ${venta.tipo_doc}: ${ultimoNumeroARCA}`);
        console.log(`✅ ARCA - Siguiente número a usar: ${siguienteNumeroARCA}`);
        
        // Usar el número de ARCA (no el local)
        numeroARCA = siguienteNumeroARCA;
        numeroCompletoARCA = `${puntoVentaLocal}-${String(siguienteNumeroARCA).padStart(5, '0')}`;
        puntoVentaARCA = puntoVentaLocal;
        
        console.log(`✅ Usando número de ARCA: ${numeroCompletoARCA}`);
        
      } catch (error) {
        console.error('❌ Error consultando ARCA para nota:', error);
        // Si falla, usar el número local extraído
        console.warn('⚠️  Usando número local extraído. ARCA validará al crear el comprobante.');
        numeroARCA = parseInt(numeroLocal);
        numeroCompletoARCA = venta.numero_factura;
        puntoVentaARCA = puntoVentaLocal;
        usarNumeroLocal = true;
      }
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
    
    const tipoComprobante = determinarTipoComprobante(venta.cliente_condicion, venta.tipo_f, venta.tipo_doc);
    console.log(`  - Tipo Comprobante: ${venta.tipo_doc || 'FACTURA'} ${venta.tipo_f} → ${tipoComprobante}`);
    
    const tipoDocumento = determinarTipoDocumento(venta.cliente_cuit);
    const numeroDocumento = tipoDocumento === 99 ? 0 : (venta.cliente_cuit || '0').replace(/[.-]/g, '');
    
    console.log(`  - Documento: Tipo ${tipoDocumento}, Número ${numeroDocumento}`);
    
    const fechaFormateada = esNota
      ? (() => {
          const fechaVenta = new Date(venta.fecha);
          return parseInt(
            `${fechaVenta.getFullYear()}${String(fechaVenta.getMonth() + 1).padStart(2, '0')}${String(fechaVenta.getDate()).padStart(2, '0')}`
          );
        })()
      : obtenerFechaActualARCA();
    if (!esNota) {
      console.log(`📅 Fecha de emisión enviada a ARCA: ${fechaFormateada}`);
    }
    
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
    
    // ✅ Si es una NOTA, obtener la factura original asociada
    let comprobantesAsociados = [];
    if (esNota && venta.venta_referencia_id) {
      console.log(`\n📋 Obteniendo factura original asociada (ID: ${venta.venta_referencia_id})...`);
      
      const facturaOriginalQuery = `
        SELECT 
          numero_factura, tipo_f, cae_id, fecha
        FROM ventas
        WHERE id = ?
      `;
      
      const [facturaOriginalRows] = await db.execute(facturaOriginalQuery, [venta.venta_referencia_id]);
      
      if (facturaOriginalRows.length > 0) {
        const facturaOriginal = facturaOriginalRows[0];
        
        // Extraer punto de venta y número de la factura original
        let pvOriginal, numeroOriginal, tipoFiscalOriginal;
        
        // Intentar formato de factura: "A 0004-00000001"
        const matchFactura = facturaOriginal.numero_factura.match(/([A-Z])\s+(\d{4})-(\d{8})/);
        if (matchFactura) {
          [, tipoFiscalOriginal, pvOriginal, numeroOriginal] = matchFactura;
        } else {
          // Si no coincide, usar valores por defecto
          pvOriginal = '0004';
          numeroOriginal = facturaOriginal.numero_factura;
          tipoFiscalOriginal = facturaOriginal.tipo_f || 'B';
        }
        
        // Determinar tipo de comprobante ARCA de la factura original
        const tipoComprobanteOriginal = determinarTipoComprobante(
          venta.cliente_condicion, 
          tipoFiscalOriginal, 
          'FACTURA'
        );
        
        comprobantesAsociados = [{
          tipo: tipoComprobanteOriginal,
          puntoVenta: parseInt(pvOriginal),
          numero: parseInt(numeroOriginal)
        }];
        
        console.log(`✅ Factura original encontrada: ${facturaOriginal.numero_factura}`);
        console.log(`   Tipo ARCA: ${tipoComprobanteOriginal}, PV: ${pvOriginal}, Nro: ${numeroOriginal}`);
      } else {
        console.warn(`⚠️ No se encontró la factura original (ID: ${venta.venta_referencia_id})`);
      }
    }
    
    const subtotalDetalle = roundFacturacion(productosRows.reduce((acc, prod) => acc + (parseFloat(prod.subtotal) || 0), 0));
    const ivaDetalle = roundFacturacion(productosRows.reduce((acc, prod) => acc + (parseFloat(prod.iva) || 0), 0));

    const subtotalVenta = Number.isFinite(parseFloat(venta.subtotal))
      ? roundFacturacion(parseFloat(venta.subtotal))
      : subtotalDetalle;
    const ivaVenta = Number.isFinite(parseFloat(venta.iva_total))
      ? roundFacturacion(parseFloat(venta.iva_total))
      : ivaDetalle;
    const exentoVentaCabecera = Number.isFinite(parseFloat(venta.exento))
      ? roundFacturacion(parseFloat(venta.exento))
      : 0;

    const divergeCabeceraDetalle =
      Math.abs(subtotalDetalle - subtotalVenta) > 1 ||
      Math.abs(ivaDetalle - ivaVenta) > 1;

    const subtotalFinal =
      Math.abs(subtotalDetalle - subtotalVenta) > 1 ? subtotalDetalle : subtotalVenta;
    const ivaFinal =
      Math.abs(ivaDetalle - ivaVenta) > 1 ? ivaDetalle : ivaVenta;

    if (subtotalFinal !== subtotalVenta || ivaFinal !== ivaVenta) {
      console.warn(
        `⚠️ [ARCA] Divergencia corregida en venta ${ventaId}: usando suma de detalle. ` +
          `cabecera(subtotal=${subtotalVenta}, iva=${ivaVenta}) → detalle(subtotal=${subtotalFinal}, iva=${ivaFinal})`
      );
    }

    const impOpExExento = clienteEsExento
      ? (exentoVentaCabecera > 0 ? exentoVentaCabecera : ivaFinal)
      : 0;
    const totalVenta = roundFacturacion(
      subtotalFinal + (clienteEsExento ? impOpExExento : ivaFinal)
    );

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
      // ✅ Importes reconciliados (detalle si cabecera diverge > $1)
      // Exento: todo el total en impNeto (alícuota 0%), impOpEx=0 — compatible con SDK @arcasdk/core
      impNeto: clienteEsExento ? totalVenta : subtotalFinal,
      impIVA: clienteEsExento ? 0 : ivaFinal,
      impOpEx: 0,
      impTotal: totalVenta,
      // ✅ Usar el número obtenido desde ARCA (no el de la BD)
      puntoVenta: parseInt(puntoVentaARCA) || 1,
      // ✅ Agregar comprobantes asociados si es una nota
      comprobantesAsociados: comprobantesAsociados,
      // ✅ Para notas, pasar el número de comprobante que ya tenemos (no que lo obtenga ARCA)
      numeroComprobante: esNota ? numeroARCA : undefined
    };

    const [intentoInsertResult] = await db.execute(
      `
      INSERT INTO arca_solicitudes_log
        (venta_id, request_data, estado)
      VALUES
        (?, ?, ?)
      `,
      [ventaId, JSON.stringify(datosFactura), 'EN_PROCESO']
    );
    intentoId = intentoInsertResult?.insertId || null;
    
    console.log('✅ Datos preparados para ARCA');
    if (esNota && comprobantesAsociados.length > 0) {
      console.log(`   Comprobantes asociados: ${comprobantesAsociados.length}`);
    }
    
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

    if (intentoId) {
      const tiempoRespuesta = Date.now() - inicioSolicitudMs;
      await db.execute(
        `
        UPDATE arca_solicitudes_log
        SET response_data = ?, estado = ?, tiempo_respuesta = ?
        WHERE id = ?
        `,
        [JSON.stringify(responseARCA), 'EXITOSO', tiempoRespuesta, intentoId]
      );
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

    const impTotalAfipRaw =
      datosRespuesta?.importes?.total ??
      datosRespuesta?.comprobante?.total ??
      datosRespuesta?.datosARCA?.ImpTotal;
    // Redondear a 2 decimales para evitar que la aritmética flotante del microservicio
    // (ej: 82989.120000001) genere un importe distinto al que AFIP registró.
    const impTotalAfip = Number.isFinite(parseFloat(impTotalAfipRaw))
      ? Math.round(parseFloat(impTotalAfipRaw) * 100) / 100
      : totalVenta;
    
    // ============================================
    // 6️⃣ GUARDAR CAE EN LA BASE DE DATOS
    // ============================================
    console.log('\n💾 Paso 6: Guardando CAE en la base de datos...');
    
    const fechaFiscalSql = arcaFechaToSqlDate(fechaFormateada);
    const updateQuery = `
      UPDATE ventas 
      SET 
        cae_id = ?,
        cae_fecha = ?,
        cae_resultado = ?,
        cae_solicitud_fecha = NOW(),
        fecha_fiscal = IF(? IS NOT NULL, ?, fecha_fiscal),
        importe_afip = ?
      WHERE id = ?
    `;
    
    await db.execute(updateQuery, [
      cae,
      caeVencimiento,
      caeResultado,
      fechaFiscalSql,
      fechaFiscalSql,
      impTotalAfip,
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
    let numeroAprobado = datosRespuesta?.comprobante?.numero ||
      datosRespuesta?.voucher_number ||
      numeroARCA;

    try {
      
      // ✅ Formatear número según tipo de documento
      let numeroCompletoAprobado;
      if (esNota) {
        // Para notas: "0004-00001" (sin tipo fiscal al inicio, 5 dígitos)
        numeroCompletoAprobado = datosRespuesta?.comprobante?.numero 
          ? `${puntoVentaARCA}-${String(datosRespuesta.comprobante.numero).padStart(5, '0')}`
          : numeroCompletoARCA;
      } else {
        // Para facturas: "A 0004-00000001" (con tipo fiscal al inicio, 8 dígitos)
        numeroCompletoAprobado = datosRespuesta?.comprobante?.numero 
          ? `${venta.tipo_f} ${puntoVentaARCA}-${String(datosRespuesta.comprobante.numero).padStart(8, '0')}`
          : numeroCompletoARCA;
      }
      
      console.log(`🔄 Actualizando número en BD: ${numeroCompletoAprobado}`);
      
      // Actualizar numero_factura en la venta con el número aprobado
      const updateNumeroQuery = `
        UPDATE ventas 
        SET numero_factura = ?
        WHERE id = ?
      `;
      await db.execute(updateNumeroQuery, [numeroCompletoAprobado, ventaId]);
      console.log(`✅ Número actualizado en venta: ${numeroCompletoAprobado}`);
      
      // Sincronizar tabla de control (solo para facturas, no para notas)
      if (numeroAprobado && venta.tipo_f && !esNota) {
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
      } else if (esNota) {
        console.log(`📝 Es una ${venta.tipo_doc} - No se sincroniza tabla de control (numeración independiente)`);
      }
    } catch (syncError) {
      console.warn('⚠️  Error sincronizando número (no crítico):', syncError.message);
      // No fallar la operación si la sincronización falla
    }

    // ============================================
    // 7.5️⃣ VALIDAR COHERENCIA QR vs DATOS ENVIADOS A AFIP
    // ============================================
    try {
      const discrepanciasQR = [];
      const nroDocEsperado = parseInt(String(numeroDocumento).replace(/\D/g, ''), 10) || 0;
      const importeEnviado = parseFloat(datosFactura?.impTotal);
      const importeCalculado = parseFloat(totalVenta);
      const importeAfipGuardado = parseFloat(impTotalAfip);

      if (Number.isFinite(importeEnviado) && Math.abs(importeEnviado - importeCalculado) > 0.01) {
        discrepanciasQR.push(
          `impTotal enviado (${importeEnviado}) != total calculado (${importeCalculado})`
        );
      }
      if (Number.isFinite(importeAfipGuardado) && Math.abs(importeAfipGuardado - importeCalculado) > 0.01) {
        discrepanciasQR.push(
          `ImpTotal AFIP (${importeAfipGuardado}) != total calculado (${importeCalculado})`
        );
      }
      if (Math.abs(parseFloat(venta.total || 0) - importeAfipGuardado) > 0.01) {
        discrepanciasQR.push(
          `venta.total (${venta.total}) != importe_afip (${importeAfipGuardado})`
        );
      }
      if (parseInt(datosFactura?.puntoVenta, 10) !== parseInt(puntoVentaARCA, 10)) {
        discrepanciasQR.push(
          `puntoVenta enviado (${datosFactura?.puntoVenta}) != aprobado (${puntoVentaARCA})`
        );
      }
      if (parseInt(datosFactura?.tipoComprobante, 10) !== parseInt(tipoComprobante, 10)) {
        discrepanciasQR.push(
          `tipoComprobante enviado (${datosFactura?.tipoComprobante}) != esperado (${tipoComprobante})`
        );
      }
      if (parseInt(datosFactura?.cliente?.tipoDocumento, 10) !== parseInt(tipoDocumento, 10)) {
        discrepanciasQR.push(
          `tipoDocumento enviado (${datosFactura?.cliente?.tipoDocumento}) != esperado (${tipoDocumento})`
        );
      }
      const docEnviado = parseInt(String(datosFactura?.cliente?.numeroDocumento || '').replace(/\D/g, ''), 10) || 0;
      if (docEnviado !== nroDocEsperado) {
        discrepanciasQR.push(
          `numeroDocumento enviado (${docEnviado}) != esperado (${nroDocEsperado})`
        );
      }
      if (!fechaFiscalSql) {
        discrepanciasQR.push('fecha_fiscal no pudo derivarse de la fecha enviada a ARCA');
      }
      if (!numeroAprobado) {
        discrepanciasQR.push('numero de comprobante aprobado no disponible para validar QR');
      }

      if (discrepanciasQR.length > 0) {
        const mensajeValidacion = `[Validación QR post-CAE] ${discrepanciasQR.join('; ')}`;
        console.warn(`⚠️ ${mensajeValidacion}`);
        await db.execute(
          'UPDATE ventas SET cae_observaciones = ? WHERE id = ?',
          [mensajeValidacion.substring(0, 65535), ventaId]
        );
      } else {
        console.log('✅ Validación post-CAE: datos QR coherentes con solicitud AFIP');
      }
    } catch (validacionError) {
      console.warn('⚠️ Error en validación post-CAE (no crítico):', validacionError.message);
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
          total: impTotalAfip,
          totalVenta: totalVenta,
          totalOriginal: venta.total
        },
        esExento: clienteEsExento
      }
    });
    
  } catch (error) {
    console.error('\n❌ ERROR SOLICITANDO CAE:', error);

    if (intentoId) {
      try {
        const tiempoRespuesta = Date.now() - inicioSolicitudMs;
        await db.execute(
          `
          UPDATE arca_solicitudes_log
          SET estado = ?, mensaje_error = ?, tiempo_respuesta = ?
          WHERE id = ?
          `,
          ['ERROR', (error.message || 'Error sin mensaje').substring(0, 65535), tiempoRespuesta, intentoId]
        );
      } catch (logError) {
        console.warn('⚠️  No se pudo registrar error en arca_solicitudes_log:', logError.message);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Error al solicitar CAE',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (lockAcquired && lockName) {
      try {
        const releaseRows = lockConnection
          ? await executeWithConnection(lockConnection, 'SELECT RELEASE_LOCK(?) AS released', [lockName])
          : [];
        const released = releaseRows?.[0]?.released;
        if (released === 1) {
          console.log(`🔓 Lock de numeración liberado: ${lockName}`);
        } else {
          console.warn(`⚠️  RELEASE_LOCK devolvió ${released} para ${lockName}`);
        }
      } catch (releaseError) {
        console.warn(`⚠️  No se pudo liberar lock ${lockName}:`, releaseError.message);
      }
    }
    if (lockConnection) {
      try {
        lockConnection.release();
      } catch (releaseConnError) {
        console.warn('⚠️  No se pudo liberar conexión de lock:', releaseConnError.message);
      }
    }
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