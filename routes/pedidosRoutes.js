const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidosController');

// ========== RUTAS DE BÚSQUEDA ==========
// GET /api/pedidos/filtrar-cliente?q=nombre
router.get('/filtrar-cliente', pedidosController.buscarCliente);

// GET /api/pedidos/filtrar-producto?q=nombre  
router.get('/filtrar-producto', pedidosController.buscarProducto);

// ========== RUTAS DE PEDIDOS ==========
// POST /api/pedidos/registrar-pedido
router.post('/registrar-pedido', pedidosController.nuevoPedido);

// GET /api/pedidos/obtener-pedidos
router.get('/obtener-pedidos', pedidosController.obtenerPedidos);

// GET /api/pedidos/detalle-pedido/:pedidoId
router.get('/detalle-pedido/:pedidoId', pedidosController.obtenerDetallePedido);

// PUT /api/pedidos/actualizar-estado/:pedidoId
router.put('/actualizar-estado/:pedidoId', pedidosController.actualizarEstadoPedido);

// DELETE /api/pedidos/eliminar-pedido/:pedidoId
router.delete('/eliminar-pedido/:pedidoId', pedidosController.eliminarPedido);

// ========== RUTAS ADICIONALES ==========
// GET /api/pedidos/productos/:pedidoId - Obtener solo productos de un pedido
router.get('/productos/:pedidoId', pedidosController.obtenerProductosPedido);

// GET /api/pedidos/filtrar/:pedidoId - Obtener un pedido específico
router.get('/filtrar/:pedidoId', pedidosController.filtrarPedido);

// ========== RUTAS PARA EDITAR PEDIDOS ==========
// POST /api/pedidos/agregar-producto/:pedidoId - Agregar producto a pedido existente
router.post('/agregar-producto/:pedidoId', pedidosController.agregarProductoPedidoExistente);

// PUT /api/pedidos/actualizar-producto/:productId - Actualizar producto de pedido
router.put('/actualizar-producto/:productId', pedidosController.actualizarProductoPedido);

// DELETE /api/pedidos/eliminar-producto/:productId - Eliminar producto de pedido
router.delete('/eliminar-producto/:productId', pedidosController.eliminarProductoPedido);

// PUT /api/pedidos/actualizar-totales/:pedidoId - Actualizar totales del pedido
router.put('/actualizar-totales/:pedidoId', pedidosController.actualizarTotalesPedido);

// PUT /api/pedidos/actualizar-observaciones/:pedidoId - Actualizar observaciones
router.put('/actualizar-observaciones/:pedidoId', pedidosController.actualizarObservacionesPedido);

router.post('/generarpdf-notapedido', pedidosController.generarPdfNotaPedido);


module.exports = router;