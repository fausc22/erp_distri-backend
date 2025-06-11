const express = require('express');
const finanzasController = require('../controllers/finanzasController');
const { requireEmployee, requireManager } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

// Rutas para las cuentas
router.get('/obtener-cuentas', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    finanzasController.obtenerCuentas
);

router.post('/cuentas', 
    requireManager,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'cuenta_fondos', incluirBody: true }),
    finanzasController.crearCuenta
);

router.get('/cuentas/:cuentaId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    finanzasController.obtenerCuenta
);

// Rutas para los movimientos
router.get('/movimientos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerMovimientos
);

router.post('/movimientos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.registrarMovimiento
);

// Ruta para transferencias
router.post('/transferencias', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.realizarTransferencia
);

// Rutas para historial de ingresos
router.get('/ingresos/historial', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerIngresos
);

router.get('/ingresos/cuentas', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    finanzasController.obtenerCuentasParaFiltro
);

router.post('/ingresos/registrar', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.registrarIngreso
);

// Rutas para historial de egresos
router.get('/egresos/historial', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerEgresos
);

router.post('/egresos/registrar', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.registrarEgreso
);

// Rutas para reportes financieros (solo gerentes para algunos)
router.get('/balance-general', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerBalanceGeneral
);

router.get('/balance-cuenta', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerBalancePorCuenta
);

router.get('/distribucion-ingresos', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerDistribucionIngresos
);

router.get('/gastos-categoria', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerGastosPorCategoria
);

router.get('/flujo-fondos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerFlujoDeFondos
);

router.get('/anios-disponibles', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos' }),
    finanzasController.obtenerAniosDisponibles
);

router.get('/ventas-vendedores', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    finanzasController.obtenerVentasPorVendedor
);

router.get('/ventas-productos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'detalle_ventas', incluirQuery: true }),
    finanzasController.obtenerProductosMasVendidos
);

module.exports = router;