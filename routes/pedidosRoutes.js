const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidosController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');

// Rutas de búsqueda
router.get('/filtrar-cliente', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'clientes', incluirQuery: true }),
    pedidosController.buscarCliente
);

router.get('/filtrar-producto', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'productos', incluirQuery: true }),
    pedidosController.buscarProducto
);

// Rutas de pedidos
router.post('/registrar-pedido', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'pedidos', incluirBody: true }),
    pedidosController.nuevoPedido
);

router.get('/obtener-pedidos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'pedidos', incluirQuery: true }),
    pedidosController.obtenerPedidos
);

router.get('/detalle-pedido/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'pedidos' }),
    pedidosController.obtenerDetallePedido
);

router.put('/actualizar-estado/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'pedidos', incluirBody: true }),
    pedidosController.actualizarEstadoPedido
);

router.delete('/eliminar-pedido/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'pedidos' }),
    pedidosController.eliminarPedido
);

router.get('/productos/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'pedidos_cont' }),
    pedidosController.obtenerProductosPedido
);

router.get('/filtrar/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'pedidos' }),
    pedidosController.filtrarPedido
);

// Rutas para editar pedidos
router.post('/agregar-producto/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'pedidos_cont', incluirBody: true }),
    pedidosController.agregarProductoPedidoExistente
);

router.put('/actualizar-producto/:productId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'pedidos_cont', incluirBody: true }),
    pedidosController.actualizarProductoPedido
);

router.delete('/eliminar-producto/:productId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'DELETE', tabla: 'pedidos_cont' }),
    pedidosController.eliminarProductoPedido
);

router.put('/actualizar-totales/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'pedidos', incluirBody: true }),
    pedidosController.actualizarTotalesPedido
);

router.put('/actualizar-observaciones/:pedidoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'pedidos', incluirBody: true }),
    pedidosController.actualizarObservacionesPedido
);

router.post('/generarpdf-notapedido', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'pedidos' }),
    pedidosController.generarPdfNotaPedido
);

router.post('/generarpdf-notaspedidos-multiples', 
    requireEmployee, 
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'pedidos' }), 
    pedidosController.generarPdfNotasPedidoMultiples
);

router.get('/datos-filtros', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'pedidos', incluirQuery: true }),
    pedidosController.obtenerDatosFiltros
);

router.get('/catalogo-completo', 
    requireEmployee,
    middlewareAuditoria({ accion: 'EXPORT', tabla: 'catalogo_completo' }),
    pedidosController.obtenerCatalogoCompleto
);

router.get('/verificar-version-catalogo', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'catalogo_version', incluirQuery: true }),
    pedidosController.verificarVersionCatalogo
);

module.exports = router;