const express = require('express');
const productosController = require('../controllers/productosController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

router.post('/crear-producto', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'productos', incluirBody: true }),
    productosController.nuevoProducto
);

router.get('/buscar-producto', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos', incluirQuery: true }),
    productosController.buscarProducto
);

router.put('/actualizar-producto/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'productos', incluirBody: true }),
    productosController.actualizarProducto
);

router.post('/nuevo-remito', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'remitos', incluirBody: true }),
    productosController.nuevoRemito
);

router.get('/obtener-remitos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'remitos', incluirQuery: true }),
    productosController.obtenerRemitos
);

router.get('/obtener-productos-remito/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'detalle_remitos' }),
    productosController.filtrarProductosRemito
);

router.post('/generarpdf-remito', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'remitos' }),
    productosController.generarPdfRemito
);

router.get('/categorias', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'categorias' }),
    productosController.obtenerCategorias
);

router.post('/generarpdf-remitos-multiples', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'remitos' }),
    productosController.generarPdfRemitosMultiples
);

router.get('/stock/:id', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos' }),
    productosController.obtenerStock
);

router.get('/obtener-todos-productos',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos', incluirQuery: true }),
    productosController.obtenerTodosProductos
);

router.put('/actualizar-producto-basico/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'productos', incluirBody: true }),
    productosController.actualizarProductoBasico
);

module.exports = router;