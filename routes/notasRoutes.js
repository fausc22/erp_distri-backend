const express = require('express');
const notasController = require('../controllers/notasController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

/**
 * ✅ CREAR NOTA DE DÉBITO O CRÉDITO
 * POST /notas/crear-nota
 */
router.post('/crear-nota',
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'ventas', incluirBody: true }),
    notasController.crearNota
);

/**
 * ✅ BUSCAR VENTAS PARA REFERENCIA
 * GET /notas/buscar-ventas?q=...
 */
router.get('/buscar-ventas',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas' }),
    notasController.buscarVentas
);

module.exports = router;

