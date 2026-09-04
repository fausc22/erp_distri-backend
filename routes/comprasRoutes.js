const express = require('express');
const comprasController = require('../controllers/comprasController');
const { requireEmployee, authorizeRole } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

// Rutas para gastos
router.get('/obtener-gastos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'gastos' }),
    comprasController.obtenerGastos
);

router.get('/obtener-gasto/:gastoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'gastos' }),
    comprasController.obtenerGasto
);

router.post('/nuevo-gasto', 
    requireEmployee,
    authorizeRole(['GERENTE']),
    middlewareAuditoria({ accion: 'INSERT', tabla: 'gastos', incluirBody: true }),
    comprasController.nuevoGasto
);

router.put('/actualizar-gasto/:gastoId',
    requireEmployee,
    authorizeRole(['GERENTE']),
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'gastos', incluirBody: true }),
    comprasController.actualizarGasto
);

router.delete('/eliminar-gasto/:gastoId',
    requireEmployee,
    authorizeRole(['GERENTE']),
    middlewareAuditoria({ accion: 'DELETE', tabla: 'gastos' }),
    comprasController.eliminarGasto
);

// Rutas para compras
router.get('/obtener-compras', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'compras' }),
    comprasController.obtenerCompras
);

router.get('/obtener-productos-compra/:compraId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'compras_cont' }),
    comprasController.obtenerProductosCompra
);

router.post('/registrarCompra', 
    requireEmployee,
    authorizeRole(['GERENTE']),
    middlewareAuditoria({ accion: 'INSERT', tabla: 'compras', incluirBody: true }),
    comprasController.registrarCompraConStock
);

router.put('/:compraId/anular',
    requireEmployee,
    authorizeRole(['GERENTE']),
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'compras' }),
    comprasController.anularCompra
);

module.exports = router;
