const express = require('express');
const rateLimit = require('express-rate-limit');
const productosController = require('../controllers/productosController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const { cacheMiddleware, invalidate } = require('../utils/cache');
const router = express.Router();

// ✅ FASE 3: Rate limiting para búsquedas (protección contra scraping)
const searchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 búsquedas por IP cada 15 minutos
    message: 'Demasiadas búsquedas desde esta IP, por favor intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/crear-producto', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'productos', incluirBody: true }),
    productosController.nuevoProducto
);

router.get('/buscar-producto', 
    requireEmployee,
    searchLimiter, // ✅ FASE 3: Rate limiting para búsquedas
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos', incluirQuery: true }),
    // ✅ FASE 2: Caché con key dinámica basada en query params
    (req, res, next) => {
        const searchTerm = req.query.search || '';
        const limit = req.query.limit || '100';
        const offset = req.query.offset || '0';
        const cacheKey = `productos:buscar:${searchTerm}:${limit}:${offset}`;
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

module.exports = router;