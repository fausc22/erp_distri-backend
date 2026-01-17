const express = require('express');
const rateLimit = require('express-rate-limit');
const personasController = require('../controllers/personasController');
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

router.post('/crear-cliente', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'clientes', incluirBody: true }),
    personasController.nuevoCliente
);

router.get('/buscar-cliente', 
    requireEmployee,
    searchLimiter, // ✅ FASE 3: Rate limiting para búsquedas
    middlewareAuditoria({ accion: 'VIEW', tabla: 'clientes', incluirQuery: true }),
    // ✅ FASE 2: Caché con key dinámica basada en query params
    (req, res, next) => {
        const searchTerm = req.query.q || req.query.search || '';
        const limit = req.query.limit || '100';
        const offset = req.query.offset || '0';
        const cacheKey = `clientes:buscar:${searchTerm}:${limit}:${offset}`;
        return cacheMiddleware(cacheKey, 120)(req, res, next);
    },
    personasController.buscarCliente
);

router.put('/actualizar-cliente/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'clientes', incluirBody: true }),
    personasController.actualizarCliente
);

router.post('/crear-proveedor', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'proveedores', incluirBody: true }),
    personasController.nuevoProveedor
);

router.get('/buscar-proveedor', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'proveedores', incluirQuery: true }),
    personasController.buscarProveedor
);

router.put('/actualizar-proveedor/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'proveedores', incluirBody: true }),
    personasController.actualizarProveedor
);

// Obtener cliente por ID
router.get('/cliente/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'clientes' }),
    personasController.obtenerClientePorId
);

// Eliminar cliente
router.delete('/eliminar-cliente/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'clientes' }),
    personasController.eliminarCliente
);


router.get('/obtener-todos-proveedores',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'proveedores' }),
    personasController.obtenerTodosProveedores
);

// Obtener proveedor por ID
router.get('/proveedor/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'proveedores' }),
    personasController.obtenerProveedorPorId
);

// Eliminar proveedor
router.delete('/eliminar-proveedor/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'proveedores' }),
    personasController.eliminarProveedor
);

module.exports = router;