const express = require('express');
const router = express.Router();
const empleadosController = require('../controllers/empleadosController');
const { requireManager, requireEmployee } = require('../middlewares/authMiddleware');

// Solo gerentes pueden crear y gestionar empleados
router.post('/crear-empleado', requireManager, empleadosController.crearEmpleado);
router.put('/actualizar-empleado', requireManager, empleadosController.actualizarEmpleado);
router.get('/buscar-empleado', requireManager, empleadosController.buscarEmpleado);
router.get('/listar', requireManager, empleadosController.listarEmpleados);
router.get('/:id', requireManager, empleadosController.obtenerEmpleado);
router.delete('/:id', requireManager, empleadosController.desactivarEmpleado);

module.exports = router;