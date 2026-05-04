const express = require('express');
const rateLimit = require('express-rate-limit');
const personasController = require('../controllers/personasController');
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

// Fase 5: límite más estricto para consulta AFIP (llamadas externas a Afip SDK / ARCA)
const consultaAfipLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: 'Demasiadas consultas a AFIP. Esperá unos minutos antes de intentar de nuevo.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
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
        const pagina = req.query.pagina || '1';
        const porPagina = req.query.porPagina || '0';
        const sortBy = req.query.sortBy || 'nombre';
        const sortOrder = req.query.sortOrder || 'asc';
        const cacheKey = `clientes:buscar:${searchTerm}:${pagina}:${porPagina}:${sortBy}:${sortOrder}`;
        return cacheMiddleware(cacheKey, 120)(req, res, next);
    },
    personasController.buscarCliente
);

router.put('/actualizar-cliente/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'clientes', incluirBody: true }),
    personasController.actualizarCliente
);

// Consulta AFIP por DNI o CUIT (Padrón Alcance 13 + Constancia de Inscripción)
router.post('/consulta-afip',
    requireEmployee,
    consultaAfipLimiter,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'clientes', incluirBody: true }),
    personasController.consultaAfip
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