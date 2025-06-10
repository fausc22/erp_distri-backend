const express = require('express');
const comprasController = require('../controllers/comprasController');
const router = express.Router();

// Rutas para gastos
router.get('/obtener-gastos', comprasController.obtenerGastos);
router.get('/obtener-gasto/:gastoId', comprasController.obtenerGasto);
router.post('/nuevo-gasto', comprasController.nuevoGasto);


// Rutas para compras
router.get('/obtener-compras', comprasController.obtenerCompras);
router.get('/obtener-productos-compra/:compraId', comprasController.obtenerProductosCompra);

router.post('/registrarCompra', comprasController.registrarCompraConStock);

module.exports = router;