// routes/auditoriaRoutes.js - VERSIÓN FINAL
const express = require('express');
const router = express.Router();
const auditoriaController = require('../controllers/auditoriaController');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const { authenticateToken, authorizeRole } = require('../middlewares/authMiddleware');

// ✅ Middleware para solo gerentes
const soloGerentes = authorizeRole(['GERENTE']);

// ✅ RUTA DE PRUEBA ULTRA SIMPLE (para testing)
router.get('/test-simple', 
    authenticateToken,
    soloGerentes,
    auditoriaController.obtenerAuditoriaSimple
);

// ✅ RUTAS PRINCIPALES

// Obtener registros de auditoría con filtros y paginación
router.get('/', 
    authenticateToken,
    soloGerentes,
    middlewareAuditoria({ accion: 'VIEW_AUDITORIA', tabla: 'auditoria' }),
    auditoriaController.obtenerAuditoria
);

// Obtener detalle completo de un registro específico
router.get('/detalle/:id',
    authenticateToken,
    soloGerentes,
    middlewareAuditoria({ accion: 'VIEW_AUDITORIA_DETALLE', tabla: 'auditoria' }),
    auditoriaController.obtenerDetalleAuditoria
);

// Obtener datos únicos para filtros
router.get('/datos-filtros',
    authenticateToken,
    soloGerentes,
    middlewareAuditoria({ accion: 'VIEW_AUDITORIA_FILTROS', tabla: 'auditoria' }),
    auditoriaController.obtenerDatosFiltros
);

// Obtener estadísticas simples
router.get('/estadisticas',
    authenticateToken,
    soloGerentes,
    middlewareAuditoria({ accion: 'VIEW_AUDITORIA_STATS', tabla: 'auditoria' }),
    auditoriaController.obtenerEstadisticasSimples
);

// ✅ RUTA DE DEBUG (solo en desarrollo)
if (process.env.NODE_ENV === 'development') {
    router.get('/debug',
        authenticateToken,
        soloGerentes,
        async (req, res) => {
            try {
                const dbStatus = require('../controllers/dbPromise').getStatus();
                const poolStats = await require('../controllers/dbPromise').getPoolStats();
                
                res.json({
                    success: true,
                    message: 'Debug de auditoría',
                    user: req.user,
                    database: {
                        status: dbStatus,
                        poolStats: poolStats
                    },
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: 'Error en debug',
                    error: error.message
                });
            }
        }
    );
}

module.exports = router;