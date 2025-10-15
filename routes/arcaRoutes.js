const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');

// ✅ Importar controlador de integración
const arcaIntegrationController = require('../controllers/arcaIntegrationController');

// Importar el controlador del microservicio ARCA
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
// ✅ RUTAS DE INTEGRACIÓN (PRINCIPALES)
// ============================================

/**
 * ✅ SOLICITAR CAE PARA UNA VENTA
 * POST /arca/solicitar-cae
 * 
 * Body: { ventaId: number }
 */
router.post('/solicitar-cae',
  authenticateToken,
  middlewareAuditoria({ accion: 'INSERT', tabla: 'ventas', incluirBody: true }),
  arcaIntegrationController.verificarARCA,
  arcaIntegrationController.solicitarCAE
);

/**
 * ✅ HEALTH CHECK DEL SERVICIO
 * GET /arca/health
 */
router.get('/health',
  arcaIntegrationController.healthCheck
);

// ============================================
// RUTAS DEL MICROSERVICIO ARCA (DIRECTAS)
// ============================================

/**
 * CREAR FACTURA CONSUMIDOR FINAL
 * POST /arca/facturas/consumidor-final
 */
router.post('/facturas/consumidor-final', 
  authenticateToken,
  verificarControlador, 
  (req, res) => billingController.crearFacturaConsumidorFinal(req, res)
);

/**
 * CREAR FACTURA A RESPONSABLE INSCRIPTO
 * POST /arca/facturas/responsable-inscripto
 */
router.post('/facturas/responsable-inscripto', 
  authenticateToken,
  verificarControlador, 
  (req, res) => billingController.crearFacturaResponsableInscripto(req, res)
);

/**
 * OBTENER TIPOS DE COMPROBANTES
 * GET /arca/tipos-comprobante
 */
router.get('/tipos-comprobante', 
  verificarControlador, 
  (req, res) => billingController.obtenerTiposComprobante(req, res)
);

/**
 * OBTENER ALÍCUOTAS DE IVA
 * GET /arca/alicuotas-iva
 */
router.get('/alicuotas-iva', 
  verificarControlador, 
  (req, res) => billingController.obtenerAlicuotasIVA(req, res)
);

/**
 * OBTENER CONDICIONES IVA
 * GET /arca/condiciones-iva
 */
router.get('/condiciones-iva', 
  verificarControlador, 
  (req, res) => billingController.obtenerCondicionesIVA(req, res)
);

/**
 * ✅ GENERAR QR PARA FACTURA ELECTRÓNICA
 * POST /arca/generar-qr
 */
router.post('/generar-qr', async (req, res) => {
  try {
    const datosQR = req.body; // Ya viene en el formato correcto desde pdfGenerator
    
    console.log('📱 Generando QR con datos:', JSON.stringify(datosQR, null, 2));

    // ✅ VALIDAR DATOS OBLIGATORIOS según especificación ARCA
    const camposRequeridos = ['ver', 'fecha', 'cuit', 'ptoVta', 'tipoCmp', 'nroCmp', 'importe', 'moneda', 'ctz', 'tipoCodAut', 'codAut'];
    const camposFaltantes = camposRequeridos.filter(campo => !datosQR.hasOwnProperty(campo));
    
    if (camposFaltantes.length > 0) {
      console.error('❌ Faltan campos obligatorios:', camposFaltantes);
      return res.status(400).json({
        success: false,
        error: `Faltan datos obligatorios: ${camposFaltantes.join(', ')}`
      });
    }

    // ✅ CONSTRUIR JSON según especificación ARCA (versión 1)
    const jsonComprobante = {
      ver: parseInt(datosQR.ver),                      // Versión del formato
      fecha: datosQR.fecha,                            // YYYY-MM-DD (RFC3339)
      cuit: parseInt(datosQR.cuit),                    // CUIT emisor (11 dígitos)
      ptoVta: parseInt(datosQR.ptoVta),                // Punto de venta (hasta 5 dígitos)
      tipoCmp: parseInt(datosQR.tipoCmp),              // Tipo comprobante (hasta 3 dígitos)
      nroCmp: parseInt(datosQR.nroCmp),                // Número comprobante (hasta 8 dígitos)
      importe: parseFloat(datosQR.importe),            // Importe total (decimal)
      moneda: datosQR.moneda,                          // Moneda (3 caracteres)
      ctz: parseFloat(datosQR.ctz),                    // Cotización
      tipoDocRec: parseInt(datosQR.tipoDocRec),        // Tipo doc receptor (hasta 2 dígitos)
      nroDocRec: parseInt(datosQR.nroDocRec),          // Número doc receptor (hasta 20 dígitos)
      tipoCodAut: datosQR.tipoCodAut,                  // Tipo autorización ("E" o "A")
      codAut: parseInt(datosQR.codAut)                 // CAE (14 dígitos)
    };

    console.log('📋 JSON construido:', JSON.stringify(jsonComprobante, null, 2));

    // ✅ CODIFICAR EN BASE64
    const jsonString = JSON.stringify(jsonComprobante);
    const base64Data = Buffer.from(jsonString, 'utf8').toString('base64');
    
    console.log('🔐 Datos codificados en Base64');
    
    // ✅ CONSTRUIR URL SEGÚN ESPECIFICACIÓN ARCA
    const qrUrl = `https://www.arca.gob.ar/fe/qr/?p=${base64Data}`;
    
    console.log('🔗 URL del QR:', qrUrl);
    
    // ✅ GENERAR IMAGEN QR
    const qrBase64 = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 200,
      margin: 1
    });

    console.log('✅ QR generado exitosamente');

    res.json({ 
      success: true, 
      qrBase64,
      qrUrl,
      qrData: jsonComprobante
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