const express = require('express');
const rateLimit = require('express-rate-limit');
const productosController = require('../controllers/productosController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const { cacheMiddleware, invalidate } = require('../utils/cache');
const router = express.Router();

const searchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: 'Demasiadas búsquedas desde esta IP, por favor intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
});

router.post('/crear-producto', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'productos', incluirBody: true }),
    productosController.nuevoProducto
);

router.get('/buscar-producto', 
    requireEmployee,
    searchLimiter,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos', incluirQuery: true }),
    // Caché con key dinámica: paginación y filtros (Fase 1 Productos)
    (req, res, next) => {
        const searchTerm = req.query.search || '';
        const pagina = req.query.pagina || '1';
        const porPagina = req.query.porPagina || '50';
        const categoriaId = req.query.categoria_id || '';
        const unidadMedida = req.query.unidad_medida || '';
        const stock = req.query.stock || '';
        const cacheKey = `productos:buscar:${searchTerm}:${pagina}:${porPagina}:${categoriaId}:${unidadMedida}:${stock}`;
        return cacheMiddleware(cacheKey, 120)(req, res, next);
    },
    productosController.buscarProducto
);

router.put('/actualizar-producto/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'productos', incluirBody: true }),
    productosController.actualizarProducto
);

router.post('/nuevo-remito', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'remitos', incluirBody: true }),
    productosController.nuevoRemito
);

router.get('/obtener-remitos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'remitos', incluirQuery: true }),
    productosController.obtenerRemitos
);

router.get('/obtener-productos-remito/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'detalle_remitos' }),
    productosController.filtrarProductosRemito
);

router.post('/generarpdf-remito', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'remitos' }),
    productosController.generarPdfRemito
);

router.get('/categorias', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'categorias' }),
    // ✅ FASE 2: Caché para categorías (cambian poco, TTL más largo)
    cacheMiddleware('categorias:all', 300),
    productosController.obtenerCategorias
);

router.post('/generarpdf-remitos-multiples', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'remitos' }),
    productosController.generarPdfRemitosMultiples
);

router.get('/stock/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos' }),
    productosController.obtenerStock
);

/** Producto plantilla para fletes en Venta Directa: nombre exacto "FLETE DE HACIENDA". */
router.get('/producto-flete-hacienda',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos' }),
    productosController.getProductoFleteHacienda
);

router.get('/obtener-todos-productos',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos', incluirQuery: true }),
    // ✅ FASE 2: Caché con key dinámica
    (req, res, next) => {
        const searchTerm = req.query.search || '';
        const cacheKey = `productos:todos:${searchTerm}`;
        return cacheMiddleware(cacheKey, 120)(req, res, next);
    },
    productosController.obtenerTodosProductos
);

router.put('/actualizar-producto-basico/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'productos', incluirBody: true }),
    productosController.actualizarProductoBasico
);

router.delete('/eliminar-producto/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'productos' }),
    productosController.eliminarProducto
);

module.exports = router;