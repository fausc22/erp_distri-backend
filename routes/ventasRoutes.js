const express = require('express');
const ventasController = require('../controllers/ventasController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

router.get('/obtener-ventas', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas' }),
    ventasController.obtenerVentas
);

router.get('/obtener-venta/:ventaId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas' }),
    ventasController.filtrarVenta
);

router.get('/obtener-productos-venta/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas_cont' }),
    ventasController.filtrarProductosVenta
);

router.post('/generarpdf-listaprecio', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'productos' }),
    ventasController.generarPdfListaPrecio
);

router.post('/generarpdf-factura', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'ventas' }),
    ventasController.generarPdfFactura
);

router.post('/generarpdf-facturas-multiples', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'ventas' }),
    ventasController.generarPdfFacturasMultiples
);

router.get('/cuentas-fondos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    ventasController.obtenerCuentasFondos
);

router.post('/facturar-pedido', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'ventas', incluirBody: true }),
    ventasController.facturarPedido
);

router.get('/movimientos-cuenta/:cuentaId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos' }),
    ventasController.obtenerMovimientosCuenta
);

module.exports = router;