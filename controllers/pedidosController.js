const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const puppeteer = require("puppeteer");
const multer = require('multer');
const puppeteerManager = require('../utils/puppeteerConfig');
const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');




const formatearFecha = (fechaBD) => {
    if (!fechaBD) return 'Fecha no disponible';
    
    try {
        // Crear objeto Date desde string de BD (MySQL datetime format)
        const fecha = new Date(fechaBD);
        
        // Verificar que la fecha es válida
        if (isNaN(fecha.getTime())) {
            console.warn('Fecha inválida recibida:', fechaBD);
            return 'Fecha inválida';
        }
        
        // Formatear componentes
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0'); // +1 porque getMonth() empieza en 0
        const año = fecha.getFullYear();
        
        const horas = String(fecha.getHours()).padStart(2, '0');
        const minutos = String(fecha.getMinutes()).padStart(2, '0');
        const segundos = String(fecha.getSeconds()).padStart(2, '0');
        
        // Retornar formato deseado: DD/MM/AAAA - HH:mm:ss
        return `${dia}/${mes}/${año} - ${horas}:${minutos}:${segundos}`;
        
    } catch (error) {
        console.error('Error formateando fecha:', error, 'Fecha original:', fechaBD);
        return 'Error en fecha';
    }
};


const buscarCliente = (req, res) => {
    const rawSearch = req.query.q || req.query.search || '';
    const searchTerm = `%${rawSearch}%`;

    const query = `
        SELECT * FROM clientes
        WHERE nombre LIKE ?
        ORDER BY nombre ASC
        LIMIT 10;
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los clientes:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
        }
        res.json({ success: true, data: results });
    });
};

const buscarProducto = (req, res) => {
    const rawSearch = req.query.q || req.query.search || '';
    const searchTerm = `%${rawSearch}%`;

    const query = `
        SELECT * FROM productos
        WHERE nombre LIKE ?
        ORDER BY nombre ASC
        LIMIT 10;
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los productos:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los productos" });
        }
        res.json({ success: true, data: results });
    });
};

/**
 * Función genérica para actualizar stock de productos
 */
const actualizarStockProducto = (productoId, cantidadCambio, motivo = 'pedido') => {
    return new Promise((resolve, reject) => {
        // Primero verificar que el producto existe y obtener stock actual
        const queryVerificar = `SELECT id, stock_actual FROM productos WHERE id = ?`;
        
        db.query(queryVerificar, [productoId], (err, results) => {
            if (err) {
                console.error(`Error al verificar producto ${productoId}:`, err);
                return reject(err);
            }
            
            if (results.length === 0) {
                console.error(`Producto ${productoId} no encontrado`);
                return reject(new Error(`Producto ${productoId} no encontrado`));
            }
            
            const stockActual = results[0].stock_actual;
            const nuevoStock = stockActual + cantidadCambio;
            
            // Validar que el stock no quede negativo (solo para disminuciones)
            if (cantidadCambio < 0 && nuevoStock < 0) {
                console.error(`Stock insuficiente para producto ${productoId}. Stock actual: ${stockActual}, intentando restar: ${Math.abs(cantidadCambio)}`);
                return reject(new Error(`Stock insuficiente. Stock disponible: ${stockActual}`));
            }
            
            // Actualizar el stock
            const queryActualizar = `UPDATE productos SET stock_actual = ? WHERE id = ?`;
            
            db.query(queryActualizar, [nuevoStock, productoId], (err, result) => {
                if (err) {
                    console.error(`Error al actualizar stock del producto ${productoId}:`, err);
                    return reject(err);
                }
                
                console.log(`✅ Stock actualizado - Producto: ${productoId}, Cambio: ${cantidadCambio}, Stock anterior: ${stockActual}, Stock nuevo: ${nuevoStock}, Motivo: ${motivo}`);
                resolve(result);
            });
        });
    });
};

// Función para registrar un pedido en la tabla principal
const registrarPedido = (pedidoData, callback) => {
    const { 
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
        subtotal, iva_total, total, estado, empleado_id, empleado_nombre, observaciones 
    } = pedidoData;

    const registrarPedidoQuery = `
        INSERT INTO pedidos 
        (cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, 
         cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, total, 
         estado, observaciones, empleado_id, empleado_nombre)
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const pedidoValues = [
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
        subtotal, iva_total, total, estado, observaciones, empleado_id, empleado_nombre
    ];

    db.query(registrarPedidoQuery, pedidoValues, (err, result) => {
        if (err) {
            console.error('Error al insertar el pedido:', err);
            return callback(err);
        }
        callback(null, result.insertId);
    });
};

// Función para insertar los productos del pedido
const insertarProductosPedido = async (pedidoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        await Promise.all(productos.map(async producto => {
            const { id, nombre, unidad_medida, cantidad, precio, iva, subtotal } = producto;
            const productoValues = [pedidoId, id, nombre, unidad_medida, cantidad, precio, iva, subtotal];

            // 1. Insertar el producto en pedidos_cont
            await new Promise((resolve, reject) => {
                db.query(insertProductoQuery, productoValues, (err, result) => {
                    if (err) {
                        console.error('Error al insertar el producto del pedido en pedidos_cont:', err);
                        return reject(err);
                    }
                    resolve(result);
                });
            });

            // 2. Actualizar stock (restar cantidad porque es un pedido)
            await actualizarStockProducto(id, -cantidad, 'nuevo_pedido');
        }));
        return null;
    } catch (error) {
        return error;
    }
};

// Endpoint para registrar nuevo pedido
const nuevoPedido = async (req, res) => {
    const { 
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
        subtotal, iva_total, total, estado, empleado_id, empleado_nombre, 
        observaciones, productos 
    } = req.body;

    console.log('📋 Datos recibidos para nuevo pedido:', req.body);

    if (!productos || productos.length === 0) {
        return res.status(400).json({ success: false, message: 'Debe incluir al menos un producto' });
    }

    registrarPedido({
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
        subtotal, iva_total, total, estado: estado || 'Exportado', 
        empleado_id, empleado_nombre, observaciones: observaciones || 'sin observaciones'
    }, async (err, pedidoId) => {
        if (err) {
            // Auditar error en creación del pedido
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'pedidos',
                detallesAdicionales: `Error al crear pedido: ${err.message}`,
                datosNuevos: req.body
            });
            
            return res.status(500).json({ success: false, message: 'Error al insertar el pedido' });
        }

        const errorProductos = await insertarProductosPedido(pedidoId, productos);
        if (errorProductos) {
            // Auditar error en inserción de productos
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'pedidos_cont',
                detallesAdicionales: `Error al insertar productos del pedido ${pedidoId}: ${errorProductos.message}`,
                datosNuevos: { pedidoId, productos }
            });
            
            return res.status(500).json({ success: false, message: 'Error al insertar los productos del pedido' });
        }

        // Auditar creación exitosa del pedido
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosNuevos: { 
                id: pedidoId,
                ...req.body
            },
            detallesAdicionales: `Pedido creado para cliente: ${cliente_nombre} - Total: $${total} - ${productos.length} productos`
        });

        res.json({ success: true, message: 'Pedido y productos insertados correctamente', pedidoId });
    });
};

// Obtener todos los pedidos (con filtro opcional por empleado)
const obtenerPedidos = (req, res) => {
    const empleadoIdRaw = req.query.empleado_id;
    
    // VALIDACIÓN Y CONVERSIÓN CORRECTA
    let empleadoId = null;
    if (empleadoIdRaw && empleadoIdRaw !== 'null' && empleadoIdRaw !== 'undefined') {
        const num = parseInt(empleadoIdRaw, 10);
        if (!isNaN(num) && num > 0) {
            empleadoId = num;
        }
    }
    
    let query = `
        SELECT 
            id, fecha, 
            cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
            cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
            subtotal, iva_total, total, estado, observaciones, 
            empleado_id, empleado_nombre
        FROM pedidos 
    `;
    
    let queryParams = [];
    
    if (empleadoId !== null) {
        query += ` WHERE empleado_id = ?`;
        queryParams.push(empleadoId);
    }
    
    query += ` ORDER BY fecha DESC`;
    
    console.log(`📋 Consulta pedidos: ${empleadoId ? `empleado ${empleadoId}` : 'todos'} - filtro=${empleadoIdRaw} → ${empleadoId}`);
    
    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error('Error al obtener pedidos:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
        }
        
        console.log(`📋 Resultados: ${results.length} pedidos encontrados`);
        res.json({ success: true, data: results });
    });
};

// Obtener detalle de un pedido específico
const obtenerDetallePedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    
    const queryPedido = `SELECT * FROM pedidos WHERE id = ?`;
    const queryProductos = `
        SELECT id, pedido_id, producto_id, producto_nombre, producto_um, 
               cantidad, precio, iva, subtotal 
        FROM pedidos_cont
        WHERE pedido_id = ?
    `;
    
    db.query(queryPedido, [pedidoId], (err, pedidoResults) => {
        if (err) {
            console.error('Error al obtener el pedido:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener el pedido' });
        }
        
        if (pedidoResults.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }
        
        db.query(queryProductos, [pedidoId], (err, productosResults) => {
            if (err) {
                console.error('Error al obtener productos del pedido:', err);
                return res.status(500).json({ success: false, message: 'Error al obtener productos del pedido' });
            }
            
            const pedido = pedidoResults[0];
            const productos = productosResults;
            
            res.json({ 
                success: true, 
                data: {
                    pedido,
                    productos
                }
            });
        });
    });
};

// Actualizar estado de un pedido
const actualizarEstadoPedido = async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { estado } = req.body;
    
    const estadosValidos = ['Exportado', 'Facturado', 'Anulado'];
    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Estado inválido. Los estados permitidos son: Exportado, Facturado, Anulado' 
        });
    }
    
    try {
        // Obtener datos anteriores para auditoría
        const obtenerDatosAnterioresPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosAnteriores = await obtenerDatosAnterioresPromise();
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        const estadoActual = datosAnteriores.estado;

        // Actualizar el estado del pedido
        const queryActualizar = `UPDATE pedidos SET estado = ? WHERE id = ?`;
        const result = await new Promise((resolve, reject) => {
            db.query(queryActualizar, [estado, pedidoId], (err, result) => {
                if (err) {
                    console.error('Error al actualizar el estado del pedido:', err);
                    return reject(err);
                }
                resolve(result);
            });
        });

        // Manejar cambios de stock según el cambio de estado
        if (estadoActual !== 'Anulado' && estado === 'Anulado') {
            // Si se anula un pedido que no estaba anulado, restaurar stock
            const queryObtenerProductos = `
                SELECT producto_id, cantidad 
                FROM pedidos_cont 
                WHERE pedido_id = ?
            `;
            
            const productosDelPedido = await new Promise((resolve, reject) => {
                db.query(queryObtenerProductos, [pedidoId], (err, results) => {
                    if (err) {
                        console.error('Error al obtener productos del pedido:', err);
                        return reject(err);
                    }
                    resolve(results);
                });
            });

            // Restaurar stock
            if (productosDelPedido.length > 0) {
                await Promise.all(productosDelPedido.map(async producto => {
                    await actualizarStockProducto(producto.producto_id, producto.cantidad, 'anular_pedido');
                }));
            }
        } else if (estadoActual === 'Anulado' && estado !== 'Anulado') {
            // Si se reactiva un pedido anulado, volver a restar stock
            const queryObtenerProductos = `
                SELECT producto_id, cantidad 
                FROM pedidos_cont 
                WHERE pedido_id = ?
            `;
            
            const productosDelPedido = await new Promise((resolve, reject) => {
                db.query(queryObtenerProductos, [pedidoId], (err, results) => {
                    if (err) {
                        console.error('Error al obtener productos del pedido:', err);
                        return reject(err);
                    }
                    resolve(results);
                });
            });

            // Restar stock nuevamente
            if (productosDelPedido.length > 0) {
                await Promise.all(productosDelPedido.map(async producto => {
                    await actualizarStockProducto(producto.producto_id, -producto.cantidad, 'reactivar_pedido');
                }));
            }
        }

        // Auditar cambio de estado
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            datosNuevos: { ...datosAnteriores, estado },
            detallesAdicionales: `Estado cambiado de "${estadoActual}" a "${estado}" - Cliente: ${datosAnteriores.cliente_nombre}`
        });

        res.json({ 
            success: true, 
            message: 'Estado del pedido actualizado correctamente y stock ajustado' 
        });

    } catch (error) {
        console.error('Error en actualizarEstadoPedido:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al actualizar estado del pedido: ${error.message}`
        });
        
        if (error.message.includes('Stock insuficiente')) {
            return res.status(400).json({ 
                success: false, 
                message: `No se puede reactivar el pedido: ${error.message}` 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Error al actualizar el estado del pedido' 
        });
    }
};


const eliminarPedido = async (req, res) => {
    const pedidoId = req.params.pedidoId;
    
    try {
        // Obtener datos del pedido antes de eliminarlo para auditoría
        const obtenerPedidoPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosAnteriores = await obtenerPedidoPromise();
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        // Obtener todos los productos del pedido antes de eliminarlo
        const queryObtenerProductos = `
            SELECT producto_id, cantidad 
            FROM pedidos_cont 
            WHERE pedido_id = ?
        `;
        
        const productosDelPedido = await new Promise((resolve, reject) => {
            db.query(queryObtenerProductos, [pedidoId], (err, results) => {
                if (err) {
                    console.error('Error al obtener productos del pedido:', err);
                    return reject(err);
                }
                resolve(results);
            });
        });

        // Eliminar el pedido (los productos se eliminan por CASCADE)
        const queryEliminarPedido = `DELETE FROM pedidos WHERE id = ?`;

        const result = await new Promise((resolve, reject) => {
            db.query(queryEliminarPedido, [pedidoId], (err, result) => {
                if (err) {
                    console.error('Error al eliminar el pedido:', err);
                    return reject(err);
                }
                resolve(result);
            });
        });

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pedido no encontrado' 
            });
        }

        // Restaurar stock de todos los productos
        if (productosDelPedido.length > 0) {
            await Promise.all(productosDelPedido.map(async producto => {
                await actualizarStockProducto(producto.producto_id, producto.cantidad, 'eliminar_pedido_completo');
            }));
        }

        // Auditar eliminación del pedido
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            detallesAdicionales: `Pedido eliminado completo - Cliente: ${datosAnteriores.cliente_nombre} - Total: $${datosAnteriores.total} - ${productosDelPedido.length} productos`
        });

        res.json({ 
            success: true, 
            message: 'Pedido eliminado correctamente y stock restaurado para todos los productos' 
        });

    } catch (error) {
        console.error('Error en eliminarPedido:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al eliminar pedido: ${error.message}`
        });
        
        res.status(500).json({ 
            success: false, 
            message: 'Error al eliminar el pedido' 
        });
    }
};

// Obtener productos de un pedido específico
const obtenerProductosPedido = (req, res) => {
    const pedidoId = req.params.pedidoId;

    const query = `
        SELECT id, pedido_id, producto_id, producto_nombre, producto_um, 
               cantidad, precio, iva, subtotal 
        FROM pedidos_cont
        WHERE pedido_id = ?
    `;
    
    db.query(query, [pedidoId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos del pedido:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener productos del pedido' });
        }
        res.json({ success: true, data: results });
    });
};

// Filtrar pedido por ID 
const filtrarPedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    const query = `SELECT * FROM pedidos WHERE id = ?`;
    
    db.query(query, [pedidoId], (err, results) => {
        if (err) {
            console.error('Error ejecutando la consulta:', err);
            return res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }
        
        res.json({ success: true, data: results[0] });
    });
};

// Actualizar observaciones del pedido
const actualizarObservacionesPedido = async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { observaciones } = req.body;
    
    try {
        // Obtener datos anteriores para auditoría
        const obtenerDatosAnterioresPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosAnteriores = await obtenerDatosAnterioresPromise();
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        const query = `UPDATE pedidos SET observaciones = ? WHERE id = ?`;

        const result = await new Promise((resolve, reject) => {
            db.query(query, [observaciones || 'sin observaciones', pedidoId], (err, result) => {
                if (err) {
                    console.error('Error al actualizar observaciones:', err);
                    return reject(err);
                }
                resolve(result);
            });
        });
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        // Auditar actualización de observaciones
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            datosNuevos: { ...datosAnteriores, observaciones: observaciones || 'sin observaciones' },
            detallesAdicionales: `Observaciones actualizadas - Cliente: ${datosAnteriores.cliente_nombre}`
        });
        
        res.json({ success: true, message: 'Observaciones actualizadas correctamente' });
    } catch (error) {
        console.error('Error en actualizarObservacionesPedido:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al actualizar observaciones: ${error.message}`
        });
        
        res.status(500).json({ success: false, message: 'Error al actualizar observaciones' });
    }
};

// Agregar producto a un pedido existente
const agregarProductoPedidoExistente = async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal } = req.body;

    if (!producto_id || !cantidad || cantidad <= 0) {
        return res.status(400).json({ 
            success: false, 
            message: "Producto ID y cantidad son requeridos, y la cantidad debe ser mayor a 0" 
        });
    }

    const query = `
        INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        // Insertar el producto en pedidos_cont
        const insertResult = await new Promise((resolve, reject) => {
            db.query(query, [pedidoId, producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal], (err, results) => {
                if (err) {
                    console.error('Error al insertar el producto:', err);
                    return reject(err);
                }
                resolve(results);
            });
        });

        // Actualizar stock (restar la cantidad)
        await actualizarStockProducto(producto_id, -cantidad, 'agregar_producto_pedido');

        // Auditar agregado de producto
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'pedidos_cont',
            registroId: insertResult.insertId,
            datosNuevos: { 
                id: insertResult.insertId,
                pedido_id: pedidoId,
                ...req.body
            },
            detallesAdicionales: `Producto agregado al pedido ${pedidoId}: ${producto_nombre} x${cantidad}`
        });

        res.json({ 
            success: true, 
            message: "Producto agregado correctamente y stock actualizado", 
            data: insertResult 
        });

    } catch (error) {
        console.error('Error en agregarProductoPedidoExistente:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'pedidos_cont',
            detallesAdicionales: `Error al agregar producto al pedido ${pedidoId}: ${error.message}`,
            datosNuevos: req.body
        });
        
        if (error.message.includes('Stock insuficiente')) {
            return res.status(400).json({ 
                success: false, 
                message: error.message 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: "Error al agregar el producto al pedido" 
        });
    }
};

// Actualizar producto de un pedido
const actualizarProductoPedido = async (req, res) => {
    const { cantidad, precio, iva, subtotal } = req.body;
    const productId = req.params.productId;

    if (!cantidad || cantidad <= 0) {
        return res.status(400).json({ 
            success: false, 
            message: "La cantidad debe ser mayor a 0" 
        });
    }

    try {
        // Obtener datos anteriores del producto en el pedido
        const obtenerDatosAnterioresPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM pedidos_cont WHERE id = ?', [productId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosAnteriores = await obtenerDatosAnterioresPromise();
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Producto en pedido no encontrado' });
        }

        const cantidadAnterior = datosAnteriores.cantidad;
        const productoId = datosAnteriores.producto_id;
        const diferenciaCantidad = cantidad - cantidadAnterior;

        // Actualizar el producto en pedidos_cont
        const queryActualizar = `
            UPDATE pedidos_cont SET cantidad = ?, precio = ?, IVA = ?, subtotal = ? WHERE id = ?
        `;

        await new Promise((resolve, reject) => {
            db.query(queryActualizar, [cantidad, precio, iva, subtotal, productId], (err, result) => {
                if (err) {
                    console.error('Error al actualizar el producto:', err);
                    return reject(err);
                }
                if (result.affectedRows === 0) {
                    return reject(new Error('Producto no encontrado'));
                }
                resolve(result);
            });
        });

        // Ajustar stock si hay diferencia en cantidad
        if (diferenciaCantidad !== 0) {
            await actualizarStockProducto(productoId, -diferenciaCantidad, 'actualizar_cantidad_pedido');
        }

        // Auditar actualización del producto
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos_cont',
            registroId: productId,
            datosAnteriores,
            datosNuevos: { ...datosAnteriores, cantidad, precio, iva, subtotal },
            detallesAdicionales: `Producto actualizado en pedido: ${datosAnteriores.producto_nombre} - Cantidad: ${cantidadAnterior} → ${cantidad}`
        });

        res.json({ 
            success: true, 
            message: 'Producto actualizado correctamente y stock ajustado' 
        });

    } catch (error) {
        console.error('Error en actualizarProductoPedido:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos_cont',
            registroId: productId,
            detallesAdicionales: `Error al actualizar producto: ${error.message}`
        });
        
        if (error.message.includes('Stock insuficiente')) {
            return res.status(400).json({ 
                success: false, 
                message: error.message 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Error al actualizar el producto' 
        });
    }
};

// Eliminar producto de un pedido
const eliminarProductoPedido = async (req, res) => {
    const productId = req.params.productId;

    try {
        // Obtener datos del producto antes de eliminarlo
        const obtenerDatosPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM pedidos_cont WHERE id = ?', [productId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosProducto = await obtenerDatosPromise();
        if (!datosProducto) {
            return res.status(404).json({ success: false, message: 'Producto en pedido no encontrado' });
        }

        // Eliminar el producto del pedido
        const queryEliminar = `DELETE FROM pedidos_cont WHERE id = ?`;

        await new Promise((resolve, reject) => {
            db.query(queryEliminar, [productId], (err, result) => {
                if (err) {
                    console.error('Error al eliminar el producto:', err);
                    return reject(err);
                }
                resolve(result);
            });
        });

        // Restaurar stock (sumar la cantidad que se había restado)
        await actualizarStockProducto(datosProducto.producto_id, datosProducto.cantidad, 'eliminar_producto_pedido');

        // Auditar eliminación del producto
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos_cont',
            registroId: productId,
            datosAnteriores: datosProducto,
            detallesAdicionales: `Producto eliminado del pedido: ${datosProducto.producto_nombre} x${datosProducto.cantidad}`
        });

        res.json({ 
            success: true, 
            message: 'Producto eliminado correctamente y stock restaurado' 
        });

    } catch (error) {
        console.error('Error en eliminarProductoPedido:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos_cont',
            registroId: productId,
            detallesAdicionales: `Error al eliminar producto: ${error.message}`
        });
        
        res.status(500).json({ 
            success: false, 
            message: 'Error al eliminar el producto' 
        });
    }
};

// Actualizar totales del pedido
const actualizarTotalesPedido = async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { subtotal, iva_total, total } = req.body;
    
    try {
        // Obtener datos anteriores para auditoría
        const obtenerDatosAnterioresPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosAnteriores = await obtenerDatosAnterioresPromise();
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        const query = `UPDATE pedidos SET subtotal = ?, iva_total = ?, total = ? WHERE id = ?`;

        const result = await new Promise((resolve, reject) => {
            db.query(query, [subtotal, iva_total, total, pedidoId], (err, result) => {
                if (err) {
                    console.error('Error al actualizar totales:', err);
                    return reject(err);
                }
                resolve(result);
            });
        });
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        // Auditar actualización de totales
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            datosNuevos: { ...datosAnteriores, subtotal, iva_total, total },
            detallesAdicionales: `Totales actualizados - Cliente: ${datosAnteriores.cliente_nombre} - Total: $${datosAnteriores.total} → $${total}`
        });
        
        res.json({ success: true, message: 'Totales actualizados correctamente' });
    } catch (error) {
        console.error('Error en actualizarTotalesPedido:', error);
        
        // Auditar error
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al actualizar totales: ${error.message}`
        });
        
        res.status(500).json({ success: false, message: 'Error al actualizar totales' });
    }
};

const generarPdfNotaPedido = async (req, res) => {
    const { pedido, productos } = req.body;

    if (!pedido || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    // ✅ Ruta de la plantilla HTML existente
    const templatePath = path.join(__dirname, "../resources/documents/nota_pedido2.html");

    if (!fs.existsSync(templatePath)) {
        console.error('❌ Plantilla HTML no encontrada en:', templatePath);
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        console.log('📄 Iniciando generación de PDF de nota de pedido con plantilla...');

        // ✅ Leer y reemplazar la plantilla HTML existente
        let htmlTemplate = fs.readFileSync(templatePath, "utf8");

        const fechaFormateada = formatearFecha(pedido.fecha);
        htmlTemplate = htmlTemplate
            .replace("{{fecha}}", fechaFormateada)
            .replace("{{id}}", pedido.id)
            .replace("{{cliente_nombre}}", pedido.cliente_nombre)
            .replace("{{cliente_direccion}}", pedido.cliente_direccion || "No informado")
            .replace("{{cliente_telefono}}", pedido.cliente_telefono || "No informado")
            .replace("{{empleado_nombre}}", pedido.empleado_nombre || "No informado")
            .replace("{{pedido_observacion}}", pedido.observaciones || "No informado");

        const itemsHTML = productos.map(p => `
            <tr>
                <td>${p.producto_id || ''}</td>
                <td>${p.producto_nombre || ''}</td>
                <td>${p.producto_descripcion || ""}</td>
                <td>${p.producto_um || ''}</td>
                <td class="text-right">${p.cantidad || 0}</td>
            </tr>
        `).join("\n");

        htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);

        // ✅ Usar puppeteerManager con configuración dinámica de altura
        const pdfBuffer = await puppeteerManager.generatePDF(htmlTemplate, {
            width: '210mm',
            margin: {
                top: '8mm',
                right: '8mm',
                bottom: '8mm',
                left: '8mm'
            },
            printBackground: true,
            preferCSSPageSize: false,
            displayHeaderFooter: false,
            scale: 0.95
        });

        // ✅ Auditar generación de PDF
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            registroId: pedido.id,
            detallesAdicionales: `PDF de nota de pedido generado para cliente: ${pedido.cliente_nombre}`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="NotaPedido_${pedido.cliente_nombre}.pdf"`);

        res.end(pdfBuffer);
        
        console.log('✅ PDF de nota de pedido generado exitosamente con plantilla');

    } catch (error) {
        console.error("❌ Error generando PDF:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            registroId: pedido.id,
            detallesAdicionales: `Error generando PDF de nota de pedido: ${error.message}`
        });

        res.status(500).json({ 
            error: "Error al generar el PDF",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ✅ GENERAR PDFs MÚLTIPLES DE NOTAS DE PEDIDO 
const generarPdfNotasPedidoMultiples = async (req, res) => {
    const { pedidosIds } = req.body;
    
    if (!pedidosIds || !Array.isArray(pedidosIds) || pedidosIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de pedido válido" });
    }

    const templatePath = path.join(__dirname, "../resources/documents/nota_pedido2.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        console.log(`📄 Iniciando generación de ${pedidosIds.length} notas de pedido múltiples con plantilla...`);

        const htmlSections = [];

        for (let i = 0; i < pedidosIds.length; i++) {
            const pedidoId = pedidosIds[i];
            
            try {
                const pedidoRows = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (pedidoRows.length === 0) {
                    console.warn(`Pedido con ID ${pedidoId} no encontrado, continuando`);
                    continue;
                }
                
                const productos = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM pedidos_cont WHERE pedido_id = ?', [pedidoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (productos.length === 0) {
                    console.warn(`No se encontraron productos para el pedido ${pedidoId}, continuando`);
                    continue;
                }
                
                const pedido = pedidoRows[0];
                
                // ✅ Leer plantilla para cada pedido
                let htmlTemplate = fs.readFileSync(templatePath, "utf8");
                
                const fechaFormateada = formatearFecha(pedido.fecha);
                htmlTemplate = htmlTemplate
                    .replace("{{fecha}}", fechaFormateada)
                    .replace("{{id}}", pedido.id)
                    .replace("{{cliente_nombre}}", pedido.cliente_nombre)
                    .replace("{{cliente_direccion}}", pedido.cliente_direccion || "No informado")
                    .replace("{{cliente_telefono}}", pedido.cliente_telefono || "No informado")
                    .replace("{{empleado_nombre}}", pedido.empleado_nombre || "No informado")
                    .replace("{{pedido_observacion}}", pedido.observaciones || "No informado");

                const itemsHTML = productos
                    .map(p => `
                        <tr>
                            <td>${p.producto_id || ''}</td>
                            <td>${p.producto_nombre || ''}</td>
                            <td>${p.producto_descripcion || ""}</td>
                            <td>${p.producto_um || ''}</td>
                            <td class="text-right">${p.cantidad || 0}</td>
                        </tr>
                    `)
                    .join("");

                htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);
                
                htmlSections.push(htmlTemplate);
                
                console.log(`✅ PDF generado para pedido ID ${pedidoId}`);
                
            } catch (error) {
                console.error(`❌ Error procesando pedido ID ${pedidoId}:`, error);
            }
        }

        if (htmlSections.length === 0) {
            return res.status(404).json({ 
                error: "No se pudieron generar PDFs para las notas de pedido seleccionadas"
            });
        }

        // ✅ Combinar todas las notas de pedido con salto de página
        const combinedHTML = htmlSections.join('<div style="page-break-before: always;"></div>');

        // ✅ Usar puppeteerManager para generar PDF combinado
        const pdfBuffer = await puppeteerManager.generatePDF(combinedHTML, {
            width: '210mm',
            margin: {
                top: '6mm',
                right: '6mm', 
                bottom: '6mm',
                left: '6mm'
            },
            printBackground: true,
            preferCSSPageSize: false,
            scale: 0.9
        });

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            detallesAdicionales: `PDFs múltiples generados: ${htmlSections.length} notas de pedido combinadas`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Notas_Pedidos_Multiples_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);
        
        console.log(`🎉 ${htmlSections.length} notas de pedido generadas y combinadas exitosamente`);
        
    } catch (error) {
        console.error("❌ Error generando PDFs múltiples:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            detallesAdicionales: `Error generando PDFs múltiples: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar los PDFs múltiples",
            detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const obtenerDatosFiltros = (req, res) => {
    // Consulta optimizada para obtener ciudades y clientes únicos
    const queryCiudades = `
        SELECT DISTINCT cliente_ciudad
        FROM pedidos 
        WHERE cliente_ciudad IS NOT NULL 
            AND cliente_ciudad != ''
            AND TRIM(cliente_ciudad) != ''
        ORDER BY cliente_ciudad ASC
        LIMIT 100
    `;

    const queryClientes = `
        SELECT DISTINCT cliente_nombre
        FROM pedidos 
        WHERE cliente_nombre IS NOT NULL 
            AND cliente_nombre != ''
            AND TRIM(cliente_nombre) != ''
        ORDER BY cliente_nombre ASC
        LIMIT 200
    `;

    // Ejecutar consulta para ciudades
    db.query(queryCiudades, (err, resultadoCiudades) => {
        if (err) {
            console.error('Error al obtener ciudades para filtros:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener ciudades para filtros" 
            });
        }

        // Ejecutar consulta para clientes
        db.query(queryClientes, (err, resultadoClientes) => {
            if (err) {
                console.error('Error al obtener clientes para filtros:', err);
                return res.status(500).json({ 
                    success: false, 
                    message: "Error al obtener clientes para filtros" 
                });
            }

            // Extraer solo los valores de las ciudades y clientes
            const ciudades = resultadoCiudades.map(row => row.cliente_ciudad);
            const clientes = resultadoClientes.map(row => row.cliente_nombre);

            console.log(`📊 Datos para filtros obtenidos: ${ciudades.length} ciudades, ${clientes.length} clientes`);

            res.json({
                success: true,
                data: {
                    ciudades,
                    clientes
                },
                meta: {
                    totalCiudades: ciudades.length,
                    totalClientes: clientes.length
                }
            });
        });
    });
};

module.exports = {
     // Funciones de búsqueda
    buscarCliente,
    buscarProducto,
    
    // Funciones de pedidos
    nuevoPedido,
    obtenerPedidos,
    obtenerDetallePedido,
    actualizarEstadoPedido,
    eliminarPedido,
    obtenerProductosPedido,
    filtrarPedido,
    
    // Funciones para editar pedidos
    agregarProductoPedidoExistente,
    actualizarProductoPedido,
    eliminarProductoPedido,
    actualizarTotalesPedido,
    actualizarObservacionesPedido,
    
    // Alias para compatibilidad
    registrarPedido: nuevoPedido,
    filtrarCliente: buscarCliente,
    filtrarProducto: buscarProducto,
    
    generarPdfNotaPedido,
    generarPdfNotasPedidoMultiples,
    obtenerDatosFiltros
};