
const express = require('express');
const router = express.Router();
const auditoriaController = require('../controllers/auditoriaController');

const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');




 //Obtener registros de auditoría con filtros
router.get('/', 
    
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    auditoriaController.obtenerAuditoria
);

// Obtener detalle de un registro específico
router.get('/detalle/:id',
    
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    auditoriaController.obtenerDetalleAuditoria
);

// Obtener estadísticas de auditoría
router.get('/estadisticas',
    
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    auditoriaController.obtenerEstadisticasAuditoria
);

// Exportar registros (JSON o CSV)
router.get('/exportar',
    
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'auditoria' }),
    auditoriaController.exportarAuditoria
);

// Limpiar registros antiguos (solo gerentes)
router.delete('/limpiar',
    
    middlewareAuditoria({ accion: 'DELETE', tabla: 'auditoria' }),
    auditoriaController.limpiarAuditoriaAntigua
);

// Ver actividad del usuario actual
router.get('/mi-actividad',
    
    middlewareAuditoria({ accion: 'VIEW', tabla: 'auditoria' }),
    async (req, res) => {
        // Filtrar solo por el usuario actual
        req.query.usuario_id = req.user.id;
        return auditoriaController.obtenerAuditoria(req, res);
    }
);

module.exports = router;






