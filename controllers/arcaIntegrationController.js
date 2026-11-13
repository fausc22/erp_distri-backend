const db = require('../db/legacyAdapter');
const { sincronizarNumeroAprobado } = require('../utils/numeracionARCA');
const { validarCuit } = require('../utils/validadoresCliente');
const { roundFacturacion, resolvePorcentajeIvaLinea, mapAlicuotaArca } = require('../utils/rounding');

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
  
  // Según FEParamGetCondicionIvaReceptor (ARCA/AFIP):
  // - Tipo A: Responsable Inscripto y Monotributo
  // - Tipo B: Exento y Consumidor Final
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

const getDbConnection = () => db.getConnection();

const executeWithConnection = async (connection, query, params = []) => {
  const [rows] = await connection.query(query, params);
  return rows;
};

/**
 * Evita que una promesa cuelgue la request indefinidamente (pool de conexiones
 * agotado, SOAP a AFIP sin respuesta, etc.). No cambia el resultado si la
 * promesa resuelve/rechaza a tiempo; solo pone un techo de espera.
 */
const withTimeout = (promise, ms, timeoutMessage) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Adquiere una conexión del pool con techo de espera.
 * Si el timeout gana la carrera, la conexión que llegue tarde se auto-libera
 * (Promise.race no cancela getDbConnection; sin esto se filtraría un slot del pool).
 */
const getDbConnectionWithTimeout = (ms, timeoutMessage) => {
  let timedOut = false;
  const guarded = getDbConnection().then((conn) => {
    if (timedOut) {
      try {
        conn.release();
      } catch (_) {
        /* ignore */
      }
      return null;
    }
    return conn;
  });
  return withTimeout(guarded, ms, timeoutMessage).finally(() => {
    timedOut = true;
  });
};

/** Techos de espera CAE: el lock se retiene durante crearFactura; la espera debe cubrirlo. */
const AFIP_CREATE_TIMEOUT_MS = 60000;
const CAE_LOCK_WAIT_SEC = 90;

/**
 * Adquiere GET_LOCK usando solo el timeout de MySQL (sin Promise.race).
 * Promise.race sobre GET_LOCK abandonaba la query en vuelo, devolvía la conexión
 * al pool y el lock podía quedar tomado para siempre (zombie) — una sola request
 * posterior fallaba aunque no hubiera concurrencia real.
 */
const acquireCaeLock = async (connection, name, waitSec) => {
  const metaRows = await executeWithConnection(
    connection,
    'SELECT IS_USED_LOCK(?) AS holder_id, CONNECTION_ID() AS my_id',
    [name]
  );
  const holderId = metaRows?.[0]?.holder_id ?? null;
  const myId = metaRows?.[0]?.my_id ?? null;

  if (holderId != null) {
    console.warn(
      `⚠️ Lock ${name} ya retenido por conexión MySQL id=${holderId} ` +
        `(esta request usa id=${myId}). Esperando hasta ${waitSec}s...`
    );
  } else {
    console.log(`🔗 Lock ${name} libre; adquiriendo (conn id=${myId}, wait=${waitSec}s)...`);
  }

  const lockRows = await executeWithConnection(
    connection,
    'SELECT GET_LOCK(?, ?) AS lock_acquired',
    [name, waitSec]
  );
  return lockRows?.[0]?.lock_acquired === 1;
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
  let serieClaveActiva = null;
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

    // Contención E1: bloquear reintentos con intento EN_PROCESO
    const [intentosAbiertos] = await db.execute(
      `
      SELECT id, estado, fecha_solicitud
      FROM arca_solicitudes_log
      WHERE venta_id = ? AND estado = 'EN_PROCESO'
      ORDER BY id DESC
      LIMIT 1
      `,
      [ventaId]
    );
    if (intentosAbiertos.length > 0) {
      const intento = intentosAbiertos[0];
      const edadMs = Date.now() - new Date(intento.fecha_solicitud).getTime();
      if (edadMs <= 65000) {
        return res.status(409).json({
          success: false,
          error: 'IN_PROGRESS',
          message: 'Ya hay una solicitud de CAE en curso para esta venta',
          intentoId: intento.id
        });
      }
      await db.execute(
        `UPDATE arca_solicitudes_log SET estado = 'DESCONOCIDO', mensaje_error = ? WHERE id = ?`,
        [
          'Marcado DESCONOCIDO por reintento tras EN_PROCESO > 65s (resultado no confirmado; requiere recuperación)',
          intento.id
        ]
      );
      return res.status(409).json({
        success: false,
        error: 'RECOVERY_REQUIRED',
        requiere_recuperacion: true,
        message: 'Existe un intento previo con resultado desconocido. Se requiere recuperación antes de reemitir.',
        intentoId: intento.id
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
    console.log(`🔗 Obteniendo conexión de BD para lock ${lockName}...`);
    lockConnection = await getDbConnectionWithTimeout(
      10000,
      `Timeout (10s) obteniendo conexión de BD para lock de numeración (${lockName}). Pool de conexiones posiblemente agotado.`
    );
    const gotLock = await acquireCaeLock(lockConnection, lockName, CAE_LOCK_WAIT_SEC);
    if (!gotLock) {
      throw new Error(
        `No se pudo obtener lock de numeración (${lockName}) tras ${CAE_LOCK_WAIT_SEC}s. ` +
          `Otra conexión MySQL lo retiene (proceso zombie o API vieja). Reiniciá PM2 o hacé KILL de esa conexión.`
      );
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
        porcentaje_iva,
        subtotal,
        descuento_porcentaje
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
      const subtotalLinea = parseFloat(prod.subtotal) || 0;
      // Neto unitario ya descontado. `precio` es el de lista; ARCA debe recibir
      // el mismo neto que quedó en el subtotal de la venta.
      const precioUnitario = cantidad > 0 ? subtotalLinea / cantidad : 0;
      // La condición del receptor no cambia la alícuota. Exento, consumidor final
      // y responsable inscripto informan el IVA de la línea (21 % = id 5).
      const porcentajeLinea = resolvePorcentajeIvaLinea(prod);
      const alicuotaIVA = mapAlicuotaArca(porcentajeLinea);
      
      return {
        descripcion: prod.producto_nombre,
        cantidad: cantidad,
        precioUnitario: precioUnitario,
        alicuotaIVA: alicuotaIVA
      };
    });
    
    console.log(`✅ Items preparados: ${items.length} productos`);
    const resumenAlic = items.reduce((acc, it) => {
      acc[it.alicuotaIVA] = (acc[it.alicuotaIVA] || 0) + 1;
      return acc;
    }, {});
    console.log(`  - Alícuotas por ítem (Id AFIP): ${JSON.stringify(resumenAlic)}`);
    
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
    
    // Fuente única: cabecera persistida (incluye descuentos). No sustituir por suma de líneas.
    const subtotalDetalle = roundFacturacion(
      productosRows.reduce((acc, prod) => acc + (parseFloat(prod.subtotal) || 0), 0)
    );
    const ivaDetalle = roundFacturacion(
      productosRows.reduce((acc, prod) => acc + (parseFloat(prod.iva) || 0), 0)
    );

    const subtotalFinal = Number.isFinite(parseFloat(venta.subtotal))
      ? roundFacturacion(parseFloat(venta.subtotal))
      : subtotalDetalle;
    const ivaFinal = Number.isFinite(parseFloat(venta.iva_total))
      ? roundFacturacion(parseFloat(venta.iva_total))
      : ivaDetalle;

    if (
      Math.abs(subtotalDetalle - subtotalFinal) > 0.005 ||
      Math.abs(ivaDetalle - ivaFinal) > 0.005
    ) {
      console.warn(
        `⚠️ [ARCA] Cabecera ≠ suma de líneas (p.ej. dto global). Se envía cabecera. ` +
          `venta ${ventaId}: cabecera(subtotal=${subtotalFinal}, iva=${ivaFinal}) ` +
          `líneas(subtotal=${subtotalDetalle}, iva=${ivaDetalle})`
      );
    }

    // Total = ventas.total guardado. Si falta, neto gravado + débito fiscal.
    // ImpOpEx queda en 0: la condición "Exento" del cliente no es una operación exenta.
    let totalVenta = Number.isFinite(parseFloat(venta.total))
      ? roundFacturacion(parseFloat(venta.total))
      : roundFacturacion(subtotalFinal + ivaFinal);

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
      impNeto: subtotalFinal,
      impIVA: ivaFinal,
      impOpEx: 0,
      impTotal: totalVenta,
      puntoVenta: parseInt(puntoVentaARCA) || 1,
      comprobantesAsociados: comprobantesAsociados,
      numeroComprobante: esNota ? numeroARCA : undefined
    };

    let promesaArca = null;
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
    serieClaveActiva = null;
    
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

    promesaArca = billingController.crearFactura(mockReq, mockRes);
    const intentoIdCapturado = intentoId;
    // Respuesta tardía: solo actualizar log (sin fiscalV2 / series).
    promesaArca.then(async () => {
      if (!intentoIdCapturado || !mockRes.jsonData) return;
      try {
        const ok = Boolean(mockRes.jsonData.success);
        await db.execute(
          `UPDATE arca_solicitudes_log
           SET response_data = ?, estado = ?, mensaje_error = ?
           WHERE id = ? AND estado IN ('EN_PROCESO','DESCONOCIDO')`,
          [
            JSON.stringify(mockRes.jsonData),
            ok ? 'EXITOSO' : 'ERROR',
            ok ? null : (mockRes.jsonData.message || 'Respuesta tardía con error'),
            intentoIdCapturado
          ]
        );
      } catch (lateErr) {
        console.warn('⚠️ No se pudo persistir respuesta tardía ARCA:', lateErr.message);
      }
    }).catch(async (lateErr) => {
      try {
        if (!intentoIdCapturado) return;
        await db.execute(
          `UPDATE arca_solicitudes_log
           SET response_data = ?, estado = 'DESCONOCIDO', mensaje_error = ?
           WHERE id = ? AND estado IN ('EN_PROCESO','DESCONOCIDO')`,
          [
            JSON.stringify({ error: String(lateErr && lateErr.message) }),
            (lateErr && lateErr.message) || 'Error tardío',
            intentoIdCapturado
          ]
        );
      } catch (_) { /* ignore */ }
    });
    
    console.log(`⏳ Esperando respuesta de ARCA/AFIP (timeout ${AFIP_CREATE_TIMEOUT_MS / 1000}s)...`);
    await withTimeout(
      promesaArca,
      AFIP_CREATE_TIMEOUT_MS,
      `Timeout (${AFIP_CREATE_TIMEOUT_MS / 1000}s) esperando respuesta de ARCA/AFIP. Los servidores de AFIP no respondieron a tiempo; reintente en unos minutos.`
    );
    console.log('✅ Respuesta de ARCA/AFIP recibida');
    
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
    // NO liberar serie aquí: recién después de persistir CAE en ventas (paso 6).
    
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
    
    const fechaFiscalSql = arcaFechaToSqlDate(
      datosRespuesta?.datosARCA?.CbteFch || fechaFormateada
    );
    await db.execute(
      `
      UPDATE ventas
      SET
        cae_id = ?,
        cae_fecha = ?,
        cae_resultado = ?,
        cae_solicitud_fecha = NOW(),
        fecha_fiscal = IF(? IS NOT NULL, ?, fecha_fiscal),
        importe_afip = ?
      WHERE id = ?
      `,
      [
        cae,
        caeVencimiento,
        caeResultado,
        fechaFiscalSql,
        fechaFiscalSql,
        impTotalAfip,
        ventaId
      ]
    );

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  ✅ CAE OBTENIDO Y GUARDADO EXITOSAMENTE  ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`🎉 CAE: ${cae}`);
    console.log(`📅 Vencimiento: ${caeVencimiento}`);
    console.log(`📄 Venta: ${ventaId}`);
    console.log(`💰 IVA informado a ARCA: condición receptor ${condicionIVA}${clienteEsExento ? ' (sujeto exento, débito fiscal igual)' : ''}\n`);
    
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
        const esTimeout = error.code === 'RECOVERY_REQUIRED' || /timeout/i.test(error.message || '');
        const estadoLog = esTimeout ? 'DESCONOCIDO' : 'ERROR';
        // Preservar el mensaje real de ARCA/timeout (no reemplazar por genérico)
        const mensajeReal = (error.message || 'Error sin mensaje').substring(0, 65535);
        await db.execute(
          `
          UPDATE arca_solicitudes_log
          SET estado = ?, mensaje_error = ?, tiempo_respuesta = ?
          WHERE id = ?
          `,
          [estadoLog, mensajeReal, tiempoRespuesta, intentoId]
        );
      } catch (logError) {
        console.warn('⚠️  No se pudo registrar error en arca_solicitudes_log:', logError.message);
      }
    }

    if (error.code === 'RECOVERY_REQUIRED' || /timeout/i.test(error.message || '')) {
      return res.status(409).json({
        success: false,
        error: 'RECOVERY_REQUIRED',
        requiere_recuperacion: true,
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error al solicitar CAE',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    // Siempre intentar RELEASE_LOCK si hay conexión + nombre: cubre el caso en que
    // GET_LOCK terminó después de un abort JS y lockAcquired quedó en false.
    if (lockConnection && lockName) {
      try {
        const releaseRows = await executeWithConnection(
          lockConnection,
          'SELECT RELEASE_LOCK(?) AS released',
          [lockName]
        );
        const released = releaseRows?.[0]?.released;
        if (released === 1) {
          console.log(`🔓 Lock de numeración liberado: ${lockName}`);
        } else if (lockAcquired) {
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
 * Recuperación clásica: si el log ya tiene respuesta EXITOSA con CAE y la venta aún no,
 * aplica ese CAE sobre la cabecera. Sin tablas de migraciones / reserva de serie.
 * POST /arca/recuperar-cae  body: { ventaId }
 */
const recuperarCAE = async (req, res) => {
  const { ventaId } = req.body || {};
  if (!ventaId) {
    return res.status(400).json({ success: false, message: 'ventaId requerido' });
  }
  try {
    const [ventasRows] = await db.execute(
      'SELECT id, cae_id, total, numero_factura, tipo_f, tipo_doc FROM ventas WHERE id = ? LIMIT 1',
      [ventaId]
    );
    const venta = ventasRows?.[0];
    if (!venta) {
      return res.status(404).json({ success: false, message: 'Venta inexistente' });
    }
    if (venta.cae_id && String(venta.cae_id).trim() !== '') {
      return res.json({
        success: true,
        existing: true,
        message: 'La venta ya tiene CAE',
        data: { ventaId, cae: venta.cae_id, numero: venta.numero_factura }
      });
    }

    const [intentos] = await db.execute(
      `SELECT * FROM arca_solicitudes_log
       WHERE venta_id = ?
         AND estado IN ('EXITOSO', 'EN_PROCESO', 'DESCONOCIDO')
       ORDER BY id DESC LIMIT 1`,
      [ventaId]
    );
    if (!intentos.length) {
      return res.status(404).json({
        success: false,
        error: 'SIN_INTENTO_PENDIENTE',
        message: 'No hay intento en log para recuperar'
      });
    }
    const intento = intentos[0];
    const responseData = typeof intento.response_data === 'string'
      ? JSON.parse(intento.response_data || 'null')
      : (intento.response_data || null);
    const requestData = typeof intento.request_data === 'string'
      ? JSON.parse(intento.request_data || '{}')
      : (intento.request_data || {});

    const autorizacion = responseData?.data?.autorizacion || responseData?.autorizacion || {};
    const cae = autorizacion.cae || responseData?.data?.cae || responseData?.cae;
    const caeVencimiento = autorizacion.fechaVencimiento || autorizacion.caeFechaVto || null;
    const caeResultado = autorizacion.resultado || 'A';
    const impTotalAfipRaw =
      responseData?.data?.importes?.total ??
      responseData?.importes?.total ??
      requestData.impTotal;
    const impTotalAfip = Number.isFinite(parseFloat(impTotalAfipRaw))
      ? Math.round(parseFloat(impTotalAfipRaw) * 100) / 100
      : parseFloat(venta.total);

    if (!cae) {
      return res.status(409).json({
        success: false,
        error: 'SIN_CAE_EN_LOG',
        message: 'El intento no tiene CAE en response_data; no se puede recuperar sin reemitir',
        intentoId: intento.id,
        estado: intento.estado
      });
    }

    const fechaFiscalSql = arcaFechaToSqlDate(
      responseData?.data?.datosARCA?.CbteFch || requestData.fecha
    );
    const caeFechaSql = arcaFechaToSqlDate(caeVencimiento) || caeVencimiento;

    await db.execute(
      `UPDATE ventas
       SET cae_id = ?,
           cae_fecha = ?,
           cae_resultado = ?,
           cae_solicitud_fecha = NOW(),
           fecha_fiscal = IF(? IS NOT NULL, ?, fecha_fiscal),
           importe_afip = ?
       WHERE id = ? AND (cae_id IS NULL OR TRIM(cae_id) = '')`,
      [String(cae), caeFechaSql, caeResultado, fechaFiscalSql, fechaFiscalSql, impTotalAfip, ventaId]
    );
    await db.execute(
      `UPDATE arca_solicitudes_log SET estado = 'EXITOSO' WHERE id = ?`,
      [intento.id]
    );

    return res.json({
      success: true,
      message: 'CAE recuperado desde log y aplicado a la venta',
      data: {
        ventaId,
        cae: String(cae),
        intentoId: intento.id,
        importe_autorizado: impTotalAfip,
        importe_cabecera: parseFloat(venta.total)
      }
    });
  } catch (error) {
    console.error('❌ Error en recuperarCAE:', error);
    return res.status(500).json({ success: false, message: error.message });
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
  solicitarCAEBatch,
  recuperarCAE,
  healthCheck
};