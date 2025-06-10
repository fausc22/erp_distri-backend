const express = require('express');
const finanzasController = require('../controllers/finanzasController');
const router = express.Router();

// Rutas para las cuentas
router.get('/cuentas', finanzasController.obtenerCuentas);
router.post('/cuentas', finanzasController.crearCuenta);
router.get('/cuentas/:cuentaId', finanzasController.obtenerCuenta);

// Rutas para los movimientos
router.get('/movimientos', finanzasController.obtenerMovimientos);
router.post('/movimientos', finanzasController.registrarMovimiento);

// Ruta para transferencias
router.post('/transferencias', finanzasController.realizarTransferencia);

// Rutas para historial de ingresos
router.get('/ingresos/historial', finanzasController.obtenerIngresos);
router.get('/ingresos/cuentas', finanzasController.obtenerCuentasParaFiltro);
router.post('/ingresos/registrar', finanzasController.registrarIngreso);
router.get('/ingresos/detalle-venta/:ventaId', finanzasController.obtenerDetalleVenta);
router.get('/ingresos/detalle-ingreso/:ingresoId', finanzasController.obtenerDetalleIngreso);

// Rutas para historial de egresos
router.get('/egresos/historial', finanzasController.obtenerEgresos);
router.post('/egresos/registrar', finanzasController.registrarEgreso);
router.get('/egresos/detalle-compra/:compraId', finanzasController.obtenerDetalleCompra);
router.get('/egresos/detalle-gasto/:gastoId', finanzasController.obtenerDetalleGasto);
router.get('/egresos/detalle-egreso/:egresoId', finanzasController.obtenerDetalleEgreso);

// Rutas para reportes financieros
router.get('/balance-general', finanzasController.obtenerBalanceGeneral);
router.get('/balance-cuenta', finanzasController.obtenerBalancePorCuenta);
router.get('/distribucion-ingresos', finanzasController.obtenerDistribucionIngresos);
router.get('/gastos-categoria', finanzasController.obtenerGastosPorCategoria);
router.get('/flujo-fondos', finanzasController.obtenerFlujoDeFondos);
router.get('/anios-disponibles', finanzasController.obtenerAniosDisponibles);
router.get('/ventas-vendedores', finanzasController.obtenerVentasPorVendedor);
router.get('/ventas-productos', finanzasController.obtenerProductosMasVendidos);

module.exports = router;