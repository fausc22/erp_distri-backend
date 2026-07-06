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

// Ruta para generar PDF del Reporte de Fletes mensual
router.post('/generarpdf-reporte-fletes',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'ventas' }),
    listadosController.generarPdfReporteFletes
);

// Ruta para generar PDF de Lista de Precios (por categorías)
router.post('/generarpdf-lista-precios',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'productos' }),
    listadosController.generarPdfListaPrecios
);

// Ruta para generar PDF de Control de Stock por filtro (menor/mayor stock)
router.post('/generarpdf-control-stock-filtro',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'productos' }),
    listadosController.generarPdfControlStockFiltro
);

// Ruta para generar PDF de Control de Stock por selección manual
router.post('/generarpdf-control-stock-seleccion',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'productos' }),
    listadosController.generarPdfControlStockSeleccion
);

// Ruta para generar PDF de Listado de Vendedores
router.post('/generarpdf-listado-vendedores',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'ventas' }),
    listadosController.generarPdfListadoVendedores
);

// Ruta para generar PDF de Resumen de Cuenta
router.post('/generarpdf-resumen-cuenta',
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'ventas' }),
    listadosController.generarPdfResumenCuenta
);

module.exports = router;
