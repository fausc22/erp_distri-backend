// routes/comprobantesRoutes.js

const express = require('express');
const router = express.Router();
const comprobantesController = require('../controllers/comprobantesController');
const { requireEmployee, requireManager } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');

// ===========================================
// RUTAS PRINCIPALES
// ===========================================

/**
 * Subir comprobante
 * POST /comprobantes/subir/:tipo/:id
 * Tipos: venta, compra, gasto
 */
router.post('/subir/:tipo/:id', 
    requireEmployee,
    middlewareAuditoria({ 
        accion: 'UPDATE', 
        tabla: 'comprobantes',
        incluirBody: false // No incluir body porque contiene archivo
    }),
    comprobantesController.subirComprobante
);

/**
 * Obtener/Descargar comprobante
 * GET /comprobantes/obtener/:tipo/:id
 */
router.get('/obtener/:tipo/:id', 
    
    middlewareAuditoria({ 
        accion: 'VIEW', 
        tabla: 'comprobantes'
    }),
    comprobantesController.obtenerComprobante
);

/**
 * Eliminar comprobante
 * DELETE /comprobantes/eliminar/:tipo/:id
 */
router.delete('/eliminar/:tipo/:id', 
    requireEmployee,
    middlewareAuditoria({ 
        accion: 'DELETE', 
        tabla: 'comprobantes'
    }),
    comprobantesController.eliminarComprobante
);

/**
 * Verificar si existe comprobante
 * GET /comprobantes/verificar/:tipo/:id
 */
router.get('/verificar/:tipo/:id', 
    requireEmployee,
    middlewareAuditoria({ 
        accion: 'VIEW', 
        tabla: 'comprobantes'
    }),
    comprobantesController.verificarComprobante
);

// ===========================================
// RUTAS ADMINISTRATIVAS
// ===========================================

/**
 * Listar comprobantes por tipo con paginación
 * GET /comprobantes/listar/:tipo
 * Query params: limite, pagina
 */
router.get('/listar/:tipo', 
    requireEmployee,
    middlewareAuditoria({ 
        accion: 'VIEW', 
        tabla: 'comprobantes',
        incluirQuery: true
    }),
    comprobantesController.listarComprobantes
);

/**
 * Obtener estadísticas generales de comprobantes
 * GET /comprobantes/estadisticas
 * Solo gerentes
 */
router.get('/estadisticas', 
    requireManager,
    middlewareAuditoria({ 
        accion: 'VIEW', 
        tabla: 'comprobantes'
    }),
    comprobantesController.obtenerEstadisticas
);

// ===========================================
// RUTAS DE CONVENIENCIA (ALIAS)
// ===========================================

/**
 * Rutas específicas por tipo para mayor claridad en el frontend
 */

// VENTAS
router.post('/venta/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'ventas' }),
    (req, res, next) => {
        req.params.tipo = 'venta';
        next();
    },
    comprobantesController.subirComprobante
);

router.get('/venta/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas' }),
    (req, res, next) => {
        req.params.tipo = 'venta';
        next();
    },
    comprobantesController.obtenerComprobante
);

router.delete('/venta/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'ventas' }),
    (req, res, next) => {
        req.params.tipo = 'venta';
        next();
    },
    comprobantesController.eliminarComprobante
);

// COMPRAS
router.post('/compra/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'compras' }),
    (req, res, next) => {
        req.params.tipo = 'compra';
        next();
    },
    comprobantesController.subirComprobante
);

router.get('/compra/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'compras' }),
    (req, res, next) => {
        req.params.tipo = 'compra';
        next();
    },
    comprobantesController.obtenerComprobante
);

router.delete('/compra/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'compras' }),
    (req, res, next) => {
        req.params.tipo = 'compra';
        next();
    },
    comprobantesController.eliminarComprobante
);

// GASTOS
router.post('/gasto/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'gastos' }),
    (req, res, next) => {
        req.params.tipo = 'gasto';
        next();
    },
    comprobantesController.subirComprobante
);

router.get('/gasto/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'gastos' }),
    (req, res, next) => {
        req.params.tipo = 'gasto';
        next();
    },
    comprobantesController.obtenerComprobante
);

router.delete('/gasto/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'gastos' }),
    (req, res, next) => {
        req.params.tipo = 'gasto';
        next();
    },
    comprobantesController.eliminarComprobante
);


router.post('/generar-link/venta/:id', 
    requireEmployee,
    middlewareAuditoria({ 
        accion: 'GENERATE_LINK', 
        tabla: 'ventas'
    }),
    comprobantesController.generarLinkPublico
);

/**
 * Verificar token público (SIN AUTENTICACIÓN)
 * GET /comprobantes/publico/verificar/:token
 */
router.get('/publico/verificar/:token', 
    // SIN requireEmployee - es público
    comprobantesController.verificarTokenPublico
);

/**
 * Subir comprobante usando token público (SIN AUTENTICACIÓN) 
 * POST /comprobantes/publico/subir/:token
 */
router.post('/publico/subir/:token', 
    // SIN requireEmployee - es público
    comprobantesController.subirComprobantePublico
);


router.post('/verificar-masivo/ventas', 
    requireEmployee,
    middlewareAuditoria({ 
        accion: 'VERIFY_BULK', 
        tabla: 'comprobantes',
        incluirBody: false 
    }),
    comprobantesController.verificarComprobantesMasivo
);

module.exports = router;