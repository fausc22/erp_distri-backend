const express = require('express');
const personasController = require('../controllers/personasController');
const router = express.Router();


router.post('/crear-cliente', personasController.nuevoCliente);

router.get('/buscar-cliente', personasController.buscarCliente);

router.put('/actualizar-cliente/:id', personasController.actualizarCliente);

router.post('/crear-proveedor', personasController.nuevoProveedor);

router.get('/buscar-proveedor', personasController.buscarProveedor);

router.put('/actualizar-proveedor/:id', personasController.actualizarProveedor);






module.exports = router;