// routes/empleadosRoutes.js - REEMPLAZAR CON ESTO

const express = require('express');
const router = express.Router();
const empleadosController = require('../controllers/empleadosController');
const { requireEmployee, requireManager } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');

// Crear empleado
router.post('/crear-empleado', 
    requireManager, 
    middlewareAuditoria({ accion: 'INSERT', tabla: 'empleados', incluirBody: true }),
    empleadosController.crearEmpleado
);

// Actualizar empleado (ID en la URL)
router.put('/actualizar-empleado/:id', 
    requireManager, 
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'empleados', incluirBody: true }),
    empleadosController.actualizarEmpleado
);

// Buscar por query string
router.get('/buscar-empleado', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados', incluirQuery: true }),
    empleadosController.buscarEmpleado
);

// ✅ NUEVA RUTA: Listar TODOS (activos e inactivos)
router.get('/listar-todos', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados' }),
    empleadosController.listarTodosEmpleados
);

// Listar solo activos
router.get('/listar', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados' }),
    empleadosController.listarEmpleados
);

// Obtener uno por ID
router.get('/:id', 
    requireManager, 
    middlewareAuditoria({ accion: 'VIEW', tabla: 'empleados' }),
    empleadosController.obtenerEmpleado
);

// Eliminar (desactivar)
router.delete('/:id', 
    requireManager, 
    middlewareAuditoria({ accion: 'DELETE', tabla: 'empleados' }),
    empleadosController.desactivarEmpleado
);

router.put('/reactivar/:id', 
    requireManager, 
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'empleados' }),
    empleadosController.reactivarEmpleado
);

module.exports = router;