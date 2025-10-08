const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

// Importar el controlador del microservicio ARCA
// Usa import() dinámico porque el microservicio está en ES modules
let billingController;

// Cargar el controlador de forma asíncrona
(async () => {
  const module = await import('../arca-microservice/controllers/billing.controller.js');
  billingController = module.default;
})();

// Middleware para verificar que el controlador esté cargado
const verificarControlador = (req, res, next) => {
  if (!billingController) {
    return res.status(503).json({
      success: false,
      error: 'Servicio ARCA no disponible. Intente nuevamente en unos segundos.'
    });
  }
  next();
};

// ============================================
// RUTAS DEL MICROSERVICIO ARCA
// ============================================

/**
 * HEALTH CHECK
 * GET /arca/health
 */
router.get('/health', verificarControlador, (req, res) => 
  billingController.verificarSalud(req, res)
);

/**
 * CREAR FACTURA (método general)
 * POST /arca/facturas
 */
router.post('/facturas', verificarControlador, (req, res) => 
  billingController.crearFactura(req, res)
);

/**
 * CREAR FACTURA CONSUMIDOR FINAL (método simplificado)
 * POST /arca/facturas/consumidor-final
 */
router.post('/facturas/consumidor-final', verificarControlador, (req, res) => 
  billingController.crearFacturaConsumidorFinal(req, res)
);

/**
 * CREAR FACTURA A RESPONSABLE INSCRIPTO
 * POST /arca/facturas/responsable-inscripto
 */
router.post('/facturas/responsable-inscripto', verificarControlador, (req, res) => 
  billingController.crearFacturaResponsableInscripto(req, res)
);

/**
 * CREAR NOTA DE CRÉDITO
 * POST /arca/notas-credito
 */
router.post('/notas-credito', verificarControlador, (req, res) => 
  billingController.crearNotaCredito(req, res)
);

/**
 * CONSULTAR FACTURA
 * GET /arca/facturas/:puntoVenta/:tipo/:numero
 */
router.get('/facturas/:puntoVenta/:tipo/:numero', verificarControlador, (req, res) => 
  billingController.consultarFactura(req, res)
);

/**
 * OBTENER ÚLTIMO NÚMERO
 * GET /arca/ultimo-numero/:tipo
 * GET /arca/ultimo-numero/:tipo/:puntoVenta
 */
router.get('/ultimo-numero/:tipo/:puntoVenta?', verificarControlador, (req, res) => 
  billingController.obtenerUltimoNumero(req, res)
);

/**
 * OBTENER TIPOS DE COMPROBANTES
 * GET /arca/tipos-comprobante
 */
router.get('/tipos-comprobante', verificarControlador, (req, res) => 
  billingController.obtenerTiposComprobante(req, res)
);

/**
 * OBTENER ALÍCUOTAS DE IVA
 * GET /arca/alicuotas-iva
 */
router.get('/alicuotas-iva', verificarControlador, (req, res) => 
  billingController.obtenerAlicuotasIVA(req, res)
);

/**
 * OBTENER CONDICIONES FRENTE AL IVA
 * GET /arca/condiciones-iva
 */
router.get('/condiciones-iva', verificarControlador, (req, res) => 
  billingController.obtenerCondicionesIVA(req, res)
);

/**
 * OBTENER TIPOS DE DOCUMENTO
 * GET /arca/tipos-documento
 */
router.get('/tipos-documento', verificarControlador, (req, res) => 
  billingController.obtenerTiposDocumento(req, res)
);

/**
 * OBTENER PUNTOS DE VENTA
 * GET /arca/puntos-venta
 */
router.get('/puntos-venta', verificarControlador, (req, res) => 
  billingController.obtenerPuntosVenta(req, res)
);

/**
 * GENERAR QR PARA FACTURA ELECTRÓNICA
 * POST /arca/generar-qr
 */
router.post('/generar-qr', async (req, res) => {
  try {
    const { 
      cae, 
      tipoComprobante, 
      puntoVenta, 
      numeroComprobante, 
      fechaEmision, 
      total, 
      cuitEmisor, 
      cuitReceptor, 
      tipoDocReceptor 
    } = req.body;

    console.log('📱 Generando QR para CAE:', cae);

    // Validar datos obligatorios
    if (!cae || !tipoComprobante || !puntoVenta || !numeroComprobante) {
      return res.status(400).json({
        success: false,
        error: 'Faltan datos obligatorios para generar QR'
      });
    }

    // Formatear fecha a YYYYMMDD
    const fecha = new Date(fechaEmision);
    const fechaFormateada = fecha.toISOString().split('T')[0].replace(/-/g, '');

    // Estructura de datos para el QR según especificación de AFIP
    const qrData = {
      ver: 1,
      fecha: fechaFormateada,
      cuit: parseInt(cuitEmisor),
      ptoVta: parseInt(puntoVenta),
      tipoCmp: parseInt(tipoComprobante),
      nroCmp: parseInt(numeroComprobante),
      importe: parseFloat(total),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: parseInt(tipoDocReceptor),
      nroDocRec: parseInt(cuitReceptor) || 0,
      tipoCodAut: 'E',
      codAut: parseInt(cae)
    };

    // Convertir a JSON y luego a base64
    const jsonString = JSON.stringify(qrData);
    const base64Data = Buffer.from(jsonString).toString('base64');
    
    // URL del QR de AFIP
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${base64Data}`;
    
    // Generar imagen QR en base64
    const qrBase64 = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 1
    });

    console.log('✅ QR generado exitosamente');

    res.json({ 
      success: true, 
      qrBase64,
      qrUrl,
      qrData
    });

  } catch (error) {
    console.error('❌ Error generando QR:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error generando código QR',
      details: error.message 
    });
  }
});

module.exports = router;