const express = require('express');
const router = express.Router();
const empleadosController = require('../controllers/empleadosController');
const { requireEmployee, requireManager } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');

// Solo gerentes pueden crear y gestionar empleados
router.post('/crear-empleado', 
    requireManager, 
    middlewareAuditoria({ accion: 'INSERT', tabla: 'empleados', incluirBody: true }),
    empleadosController.crearEmpleado
);

router.put('/actualizar-empleado', 
    requireManager, 
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'empleados', incluirBody: true }),
    empleadosController.actualizarEmpleado
);

router.get('/buscar-empleado', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados', incluirQuery: true }),
    empleadosController.buscarEmpleado
);

router.get('/listar', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados' }),
    empleadosController.listarEmpleados
);

router.get('/:id', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados' }),
    empleadosController.obtenerEmpleado
);

router.delete('/:id', 
    requireManager, 
    middlewareAuditoria({ accion: 'DELETE', tabla: 'empleados' }),
    empleadosController.desactivarEmpleado
);

module.exports = router;