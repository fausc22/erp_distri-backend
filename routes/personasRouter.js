const express = require('express');
const personasController = require('../controllers/personasController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

router.post('/crear-cliente', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'clientes', incluirBody: true }),
    personasController.nuevoCliente
);

router.get('/buscar-cliente', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'clientes', incluirQuery: true }),
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

module.exports = router;