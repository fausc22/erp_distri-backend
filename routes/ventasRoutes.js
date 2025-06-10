const express = require('express');
const ventasController = require('../controllers/ventasController');
const router = express.Router();





router.get('/obtener-ventas', ventasController.obtenerVentas);

router.get('/obtener-venta/:ventaId', ventasController.filtrarVenta);


router.get('/obtener-productos-venta/:id', ventasController.filtrarProductosVenta);




router.post('/generarpdf-listaprecio', ventasController.generarPdfListaPrecio);
router.post('/generarpdf-factura', ventasController.generarPdfFactura);
router.post('/generarpdf-facturas-multiples', ventasController.generarPdfFacturasMultiples);




router.get('/cuentas-fondos', ventasController.obtenerCuentasFondos);
router.post('/facturar-pedido', ventasController.facturarPedido);
router.get('/movimientos-cuenta/:cuentaId', ventasController.obtenerMovimientosCuenta);



module.exports = router;