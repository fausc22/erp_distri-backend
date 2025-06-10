
const express = require('express');
const router = express.Router();
const auditoriaController = require('../controllers/auditoriaController');
const { requireManager, requireEmployee, authenticateToken } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');


router.use(authenticateToken);

 //Obtener registros de auditoría con filtros
router.get('/', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    auditoriaController.obtenerAuditoria
);

// Obtener detalle de un registro específico
router.get('/detalle/:id',
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    auditoriaController.obtenerDetalleAuditoria
);

// Obtener estadísticas de auditoría
router.get('/estadisticas',
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    auditoriaController.obtenerEstadisticasAuditoria
);

// Exportar registros (JSON o CSV)
router.get('/exportar',
    requireManager,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'auditoria' }),
    auditoriaController.exportarAuditoria
);

// Limpiar registros antiguos (solo gerentes)
router.delete('/limpiar',
    requireManager,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'auditoria' }),
    auditoriaController.limpiarAuditoriaAntigua
);

// Ver actividad del usuario actual
router.get('/mi-actividad',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    async (req, res) => {
        // Filtrar solo por el usuario actual
        req.query.usuario_id = req.user.id;
        return auditoriaController.obtenerAuditoria(req, res);
    }
);

module.exports = router;






