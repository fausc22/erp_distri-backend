const express = require('express');
const listadosController = require('../controllers/listadosController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

// Ruta para generar PDF del Libro IVA
router.post('/generarpdf-libro-iva',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'ventas' }),
    listadosController.generarPdfLibroIva
);

// Ruta para generar PDF de Lista de Precios (por categorías)
router.post('/generarpdf-lista-precios',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'productos' }),
    listadosController.generarPdfListaPrecios
);

module.exports = router;
