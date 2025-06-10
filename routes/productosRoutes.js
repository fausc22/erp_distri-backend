const express = require('express');
const productosController = require('../controllers/productosController');
const router = express.Router();

router.post('/crear-producto', productosController.nuevoProducto);

router.get('/buscar-producto', productosController.buscarProducto);

router.put('/actualizar-producto/:id', productosController.actualizarProducto);

router.post('/nuevo-remito', productosController.nuevoRemito);

router.get('/obtener-remitos', productosController.obtenerRemitos);

router.get('/obtener-productos-remito/:id', productosController.filtrarProductosRemito);

router.post('/generarpdf-remito', productosController.generarPdfRemito);

router.get('/categorias', productosController.obtenerCategorias);

module.exports = router;