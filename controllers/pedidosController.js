const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const multer = require('multer');

const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const pdfGenerator = require('../utils/pdfGenerator');



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
    
    // ✅ SI NO HAY BÚSQUEDA, DEVOLVER TODOS (para PWA)
    if (!rawSearch || rawSearch.trim() === '') {
        const queryTodos = `
            SELECT * FROM clientes
            ORDER BY nombre ASC
        `;
        
        db.query(queryTodos, (err, results) => {
            if (err) {
                console.error('Error al obtener todos los clientes:', err);
                return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
            }
            console.log(`📦 Enviando TODOS los clientes: ${results.length}`);
            res.json({ success: true, data: results });
        });
        return;
    }
    
    // ✅ CON BÚSQUEDA, FILTRAR PERO SIN LÍMITE DE 10
    const searchTerm = `%${rawSearch}%`;
    const query = `
        SELECT * FROM clientes
        WHERE nombre LIKE ?
        ORDER BY nombre ASC
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los clientes:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
        }
        console.log(`🔍 Búsqueda clientes "${rawSearch}": ${results.length} resultados`);
        res.json({ success: true, data: results });
    });
};



const buscarProducto = (req, res) => {
    const rawSearch = req.query.q || req.query.search || '';
    
    // ✅ SI NO HAY BÚSQUEDA, DEVOLVER TODOS (para PWA)
    if (!rawSearch || rawSearch.trim() === '') {
        const queryTodos = `
            SELECT * FROM productos
            WHERE stock_actual >= 0
            ORDER BY nombre ASC
        `;
        
        db.query(queryTodos, (err, results) => {
            if (err) {
                console.error('Error al obtener todos los productos:', err);
                return res.status(500).json({ success: false, message: "Error al obtener los productos" });
            }
            console.log(`📦 Enviando TODOS los productos: ${results.length}`);
            res.json({ success: true, data: results });
        });
        return;
    }
    
    // ✅ CON BÚSQUEDA, FILTRAR PERO SIN LÍMITE DE 10
    const searchTerm = `%${rawSearch}%`;
    const query = `
        SELECT * FROM productos
        WHERE nombre LIKE ?
        ORDER BY nombre ASC
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los productos:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los productos" });
        }
        console.log(`🔍 Búsqueda productos "${rawSearch}": ${results.length} resultados`);
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
            const nuevoStock = parseFloat(stockActual) + parseFloat(cantidadCambio);
            
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
        INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal, descuento_porcentaje) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        await Promise.all(productos.map(async producto => {
            const { id, nombre, unidad_medida, cantidad, precio, iva, subtotal, descuento_porcentaje } = producto;
            const productoValues = [pedidoId, id, nombre, unidad_medida, cantidad, precio, iva, subtotal, descuento_porcentaje || 0];

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
               cantidad, precio, iva, subtotal, descuento_porcentaje
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

        // ✅ VALIDAR QUE EL PEDIDO NO ESTÉ FACTURADO
        if (datosAnteriores.estado === 'Facturado') {
            console.warn(`⚠️ Intento de editar observaciones en pedido facturado ${pedidoId}`);
            
            await auditarOperacion(req, {
                accion: 'UPDATE_BLOCKED',
                tabla: 'pedidos',
                registroId: pedidoId,
                estado: 'FALLIDO',
                detallesAdicionales: `Intento bloqueado de cambiar observaciones en pedido facturado ${pedidoId} - Usuario: ${req.user?.nombre || 'Desconocido'}`
            });

            return res.status(403).json({
                success: false,
                message: 'No se pueden modificar las observaciones de un pedido que ya está facturado',
                code: 'PEDIDO_FACTURADO',
                estadoActual: datosAnteriores.estado
            });
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

    try {
        // 1. Obtener la condición IVA del cliente del pedido
        const obtenerClientePedidoPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT cliente_condicion FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosPedido = await obtenerClientePedidoPromise();
        if (!datosPedido) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        // 2. Recalcular IVA si el cliente es EXENTO
        const esClienteExento = datosPedido.cliente_condicion?.toUpperCase() === 'EXENTO';
        let ivaFinal = iva;

        if (esClienteExento) {
            ivaFinal = 0;
            console.log(`✅ Cliente EXENTO detectado - IVA ajustado a 0 para producto ${producto_nombre}`);
        }

        const query = `
            INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // 3. Insertar el producto en pedidos_cont
        const insertResult = await new Promise((resolve, reject) => {
            db.query(query, [pedidoId, producto_id, producto_nombre, producto_um, cantidad, precio, ivaFinal, subtotal], (err, results) => {
                if (err) {
                    console.error('Error al insertar el producto:', err);
                    return reject(err);
                }
                resolve(results);
            });
        });

        // 4. Actualizar stock (restar la cantidad)
        await actualizarStockProducto(producto_id, -cantidad, 'agregar_producto_pedido');

        // 5. ✅ RECALCULAR TOTALES AUTOMÁTICAMENTE DESDE BD
        const totalesActualizados = await recalcularYActualizarTotalesPedido(pedidoId);

        // 4. Auditar agregado de producto
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'pedidos_cont',
            registroId: insertResult.insertId,
            datosNuevos: { 
                id: insertResult.insertId,
                pedido_id: pedidoId,
                ...req.body
            },
            detallesAdicionales: `Producto agregado al pedido ${pedidoId}: ${producto_nombre} x${cantidad} - Nuevos totales: $${totalesActualizados.total}`
        });

        res.json({ 
            success: true, 
            message: "Producto agregado correctamente, stock y totales actualizados", 
            data: {
                producto: insertResult,
                totales: totalesActualizados
            }
        });

    } catch (error) {
        console.error('Error en agregarProductoPedidoExistente:', error);
        
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
    const { cantidad, precio, iva, subtotal, descuento_porcentaje } = req.body;
    const productId = req.params.productId;

    if (!cantidad || cantidad <= 0 || isNaN(parseFloat(cantidad))) {
        return res.status(400).json({ 
            success: false,
            message: "La cantidad debe ser un número válido y mayor a 0"
        });
    }

    if (!precio || precio <= 0) {
        return res.status(400).json({ 
            success: false,
            message: "El precio debe ser mayor a 0"
        });
    }

    // ✅ VALIDAR DESCUENTO (opcional para todos, solo gerentes pueden aplicarlo)
    const descuentoFinal = descuento_porcentaje || 0;
    if (descuentoFinal < 0 || descuentoFinal > 100) {
        return res.status(400).json({ 
            success: false,
            message: "El descuento debe estar entre 0 y 100%"
        });
    }

    // ✅ SI HAY DESCUENTO, VERIFICAR QUE SEA GERENTE
    const usuarioRol = req.user?.rol;
    if (descuentoFinal > 0 && usuarioRol !== 'GERENTE') {
        return res.status(403).json({
            success: false,
            message: "Solo los gerentes pueden aplicar descuentos"
        });
    }

    try {
        // 1. Obtener datos anteriores del producto en el pedido
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
        const pedidoId = datosAnteriores.pedido_id;
        const diferenciaCantidad = cantidad - cantidadAnterior;

        // 2. Obtener condición IVA del cliente del pedido
        const obtenerClientePedidoPromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT cliente_condicion FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const datosPedido = await obtenerClientePedidoPromise();
        if (!datosPedido) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        // 3. Ajustar IVA si el cliente es EXENTO
        const esClienteExento = datosPedido.cliente_condicion?.toUpperCase() === 'EXENTO';
        let ivaFinal = iva;

        if (esClienteExento) {
            ivaFinal = 0;
            console.log(`✅ Cliente EXENTO detectado - IVA ajustado a 0 para producto ${datosAnteriores.producto_nombre}`);
        }

        // 4. VALIDAR STOCK DISPONIBLE **ANTES** DE ACTUALIZAR
        // Si aumentamos la cantidad, debemos verificar que haya stock disponible
        if (diferenciaCantidad > 0) {
            const obtenerStockPromise = () => {
                return new Promise((resolve, reject) => {
                    db.query('SELECT stock_actual FROM productos WHERE id = ?', [productoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results.length > 0 ? results[0] : null);
                    });
                });
            };

            const stockInfo = await obtenerStockPromise();
            if (!stockInfo) {
                return res.status(404).json({ success: false, message: 'Producto no encontrado' });
            }

            // El stock actual ya tiene restadas las cantidades anteriores del pedido
            // Solo necesitamos verificar que hay stock para la diferencia
            if (stockInfo.stock_actual < diferenciaCantidad) {
                return res.status(400).json({
                    success: false,
                    message: `Stock insuficiente. Stock disponible: ${stockInfo.stock_actual}, necesitas: ${diferenciaCantidad} adicionales`
                });
            }
        }

        // 5. RECALCULAR SUBTOTAL CON DESCUENTO (Verificación)
        const subtotalBase = precio * cantidad;
        const montoDescuento = (subtotalBase * descuentoFinal) / 100;
        const subtotalConDescuento = subtotalBase - montoDescuento;

        // Verificar que el subtotal enviado coincida con el calculado
        if (Math.abs(subtotal - subtotalConDescuento) > 0.01) {
            return res.status(400).json({
                success: false,
                message: `Error en cálculo: Subtotal esperado $${subtotalConDescuento.toFixed(2)}, recibido $${subtotal}`
            });
        }

        // 6. ACTUALIZAR EL PRODUCTO CON DESCUENTO Y IVA AJUSTADO
        const queryActualizar = `
            UPDATE pedidos_cont
            SET cantidad = ?, precio = ?, IVA = ?, subtotal = ?, descuento_porcentaje = ?
            WHERE id = ?
        `;

        await new Promise((resolve, reject) => {
            db.query(queryActualizar, [cantidad, precio, ivaFinal, subtotal, descuentoFinal, productId], (err, result) => {
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

        // 7. Ajustar stock si hay diferencia en cantidad
        if (diferenciaCantidad !== 0) {
            await actualizarStockProducto(productoId, -diferenciaCantidad, 'actualizar_cantidad_pedido');
        }

        // ✅ 7. RECALCULAR TOTALES AUTOMÁTICAMENTE DESDE BD
        const totalesActualizados = await recalcularYActualizarTotalesPedido(pedidoId);

        // ✅ AUDITAR CON INFORMACIÓN ESPECÍFICA
        const tipoOperacion = descuentoFinal > 0 ? 'GERENTE' : 'EMPLEADO';
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos_cont',
            registroId: productId,
            datosAnteriores,
            datosNuevos: { 
                ...datosAnteriores, 
                cantidad, 
                precio, 
                iva, 
                subtotal, 
                descuento_porcentaje: descuentoFinal 
            },
            detallesAdicionales: `Producto actualizado por ${tipoOperacion} ${req.user?.nombre || 'Desconocido'} en pedido ${pedidoId}: ${datosAnteriores.producto_nombre} - Cantidad: ${cantidadAnterior} → ${cantidad} - Precio: ${datosAnteriores.precio} → ${precio}${descuentoFinal > 0 ? ` - Descuento: ${descuentoFinal}%` : ''} - Nuevos totales: ${totalesActualizados.total}`
        });

        // ✅ 9. RESPUESTA CON INFORMACIÓN DETALLADA
        res.json({
            success: true,
            message: `Producto actualizado correctamente${descuentoFinal > 0 ? ` con ${descuentoFinal}% de descuento` : ''}, stock y totales ajustados`,
            data: {
                totales: totalesActualizados,
                descuento: {
                    porcentaje: descuentoFinal,
                    monto: montoDescuento,
                    subtotalBase: subtotalBase,
                    subtotalConDescuento: subtotalConDescuento
                }
            }
        });

    } catch (error) {
        console.error('Error en actualizarProductoPedido:', error);
        
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
        // 1. Obtener datos del producto antes de eliminarlo
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

        const pedidoId = datosProducto.pedido_id;

        // 2. Eliminar el producto del pedido
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

        // 3. Restaurar stock (sumar la cantidad que se había restado)
        await actualizarStockProducto(datosProducto.producto_id, datosProducto.cantidad, 'eliminar_producto_pedido');

        // 4. ✅ RECALCULAR TOTALES AUTOMÁTICAMENTE DESDE BD
        const totalesActualizados = await recalcularYActualizarTotalesPedido(pedidoId);

        // 5. Auditar eliminación del producto
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos_cont',
            registroId: productId,
            datosAnteriores: datosProducto,
            detallesAdicionales: `Producto eliminado del pedido ${pedidoId}: ${datosProducto.producto_nombre} x${datosProducto.cantidad} - Nuevos totales: $${totalesActualizados.total}`
        });

        res.json({ 
            success: true, 
            message: 'Producto eliminado correctamente, stock restaurado y totales actualizados',
            data: {
                totales: totalesActualizados
            }
        });

    } catch (error) {
        console.error('Error en eliminarProductoPedido:', error);
        
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

        // ✅ USAR LA NUEVA FUNCIÓN DE RECÁLCULO
        const totalesActualizados = await recalcularYActualizarTotalesPedido(pedidoId);

        // Auditar actualización de totales
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            datosNuevos: { ...datosAnteriores, ...totalesActualizados },
            detallesAdicionales: `Totales recalculados - Cliente: ${datosAnteriores.cliente_nombre} - Total: $${datosAnteriores.total} → $${totalesActualizados.total}`
        });
        
        res.json({ 
            success: true, 
            message: 'Totales recalculados correctamente desde BD',
            data: totalesActualizados
        });
        
    } catch (error) {
        console.error('Error en actualizarTotalesPedido:', error);
        
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al recalcular totales: ${error.message}`
        });
        
        res.status(500).json({ success: false, message: 'Error al recalcular totales' });
    }
};

const generarPdfNotaPedido = async (req, res) => {
    const { pedido, productos } = req.body;

    if (!pedido || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    try {
        console.log('📄 Generando PDF de nota de pedido optimizado...');
        const startTime = Date.now();

        // ✅ USAR PLANTILLA HTML EXACTA
        const pdfBuffer = await pdfGenerator.generarNotaPedido(pedido, productos);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de nota de pedido generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            registroId: pedido.id,
            detallesAdicionales: `PDF de nota de pedido generado optimizado en ${generationTime}ms - Cliente: ${pedido.cliente_nombre}`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="NotaPedido_${pedido.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);

        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDF:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            registroId: pedido.id,
            detallesAdicionales: `Error generando PDF de nota de pedido optimizado: ${error.message}`
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
        console.log(`📄 Iniciando generación de ${pedidosIds.length} notas de pedido múltiples...`);

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
                            <td>${p.producto_um || ''}</td>
                            <td style="text-align: center;">${p.cantidad || 0}</td>
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

        // ✅ COMBINAR CON SALTO DE PÁGINA PARA html-pdf
        const combinedHTML = htmlSections.join('<div style="page-break-before: always;"></div>');

        // ✅ USAR pdfGenerator con html-pdf
        const pdfBuffer = await pdfGenerator.generatePdfFromHtml(combinedHTML, {
            format: 'A4',
            border: {
                top: '8mm',
                right: '6mm', 
                bottom: '8mm',
                left: '6mm'
            },
            quality: "75",
            type: "pdf",
            timeout: 30000
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

const recalcularYActualizarTotalesPedido = async (pedidoId, condicionIvaCliente = null) => {
    return new Promise((resolve, reject) => {
        // 1. Obtener todos los productos del pedido con su porcentaje de IVA desde la tabla productos
        const queryProductos = `
            SELECT
                pc.id,
                pc.producto_nombre,
                pc.subtotal,
                pc.IVA,
                COALESCE(p.IVA, 21) as porcentaje_iva
            FROM pedidos_cont pc
            LEFT JOIN productos p ON pc.producto_id = p.id
            WHERE pc.pedido_id = ?
        `;

        db.query(queryProductos, [pedidoId], async (err, productos) => {
            if (err) {
                console.error('Error al obtener productos:', err);
                return reject(err);
            }

            // Manejar caso sin productos
            if (productos.length === 0) {
                const totalesCero = { subtotal: 0, iva_total: 0, total: 0 };

                const queryActualizar = `
                    UPDATE pedidos
                    SET subtotal = ?, iva_total = ?, total = ?
                    WHERE id = ?
                `;

                db.query(queryActualizar, [0, 0, 0, pedidoId], (err, result) => {
                    if (err) {
                        console.error('Error al actualizar totales a cero:', err);
                        return reject(err);
                    }
                    console.log(`💰 Totales actualizados a cero para pedido ${pedidoId}`);
                    resolve(totalesCero);
                });
                return;
            }

            try {
                // 2. Si se proporciona condición IVA, recalcular IVA de cada producto
                if (condicionIvaCliente) {
                    const esClienteExento = condicionIvaCliente.toUpperCase() === 'EXENTO';
                    console.log(`🔄 Recalculando IVA para ${productos.length} productos. Cliente ${esClienteExento ? 'EXENTO' : 'CON IVA'}`);

                    for (const producto of productos) {
                        const subtotal = parseFloat(producto.subtotal) || 0;
                        const porcentajeIva = parseFloat(producto.porcentaje_iva) || 21;

                        // Si el cliente es EXENTO, IVA = 0. Si no, calcular IVA
                        const nuevoIva = esClienteExento
                            ? 0
                            : parseFloat((subtotal * (porcentajeIva / 100)).toFixed(2));

                        // Actualizar IVA del producto
                        await new Promise((resolveUpdate, rejectUpdate) => {
                            db.query(
                                'UPDATE pedidos_cont SET IVA = ? WHERE id = ?',
                                [nuevoIva, producto.id],
                                (errUpdate) => {
                                    if (errUpdate) {
                                        console.error(`Error actualizando IVA producto ${producto.id}:`, errUpdate);
                                        return rejectUpdate(errUpdate);
                                    }
                                    resolveUpdate();
                                }
                            );
                        });
                    }
                }

                // 3. Recalcular totales desde la BD (ahora con IVAs actualizados)
                db.query(
                    'SELECT SUM(subtotal) as subtotal_total, SUM(IVA) as iva_total FROM pedidos_cont WHERE pedido_id = ?',
                    [pedidoId],
                    (errSum, results) => {
                        if (errSum) {
                            console.error('Error al calcular totales:', errSum);
                            return reject(errSum);
                        }

                        const subtotalTotal = parseFloat(results[0].subtotal_total) || 0;
                        const ivaTotal = parseFloat(results[0].iva_total) || 0;
                        const total = subtotalTotal + ivaTotal;

                        // 4. Actualizar totales del pedido
                        const queryActualizar = `
                            UPDATE pedidos
                            SET subtotal = ?, iva_total = ?, total = ?
                            WHERE id = ?
                        `;

                        db.query(queryActualizar, [subtotalTotal, ivaTotal, total, pedidoId], (errUpdate, result) => {
                            if (errUpdate) {
                                console.error('Error al actualizar totales del pedido:', errUpdate);
                                return reject(errUpdate);
                            }

                            console.log(`💰 Totales recalculados para pedido ${pedidoId}: Subtotal=${subtotalTotal}, IVA=${ivaTotal}, Total=${total}`);
                            resolve({
                                subtotal: subtotalTotal,
                                iva_total: ivaTotal,
                                total: total
                            });
                        });
                    }
                );
            } catch (error) {
                console.error('Error en recálculo:', error);
                reject(error);
            }
        });
    });
};


const obtenerCatalogoCompleto = async (req, res) => {
    try {
        console.log('📦 Solicitando catálogo completo para PWA...');
        const startTime = Date.now();

        // ✅ CONSULTAR TODOS LOS CLIENTES ACTIVOS
        const queryClientes = `
            SELECT id, nombre, nombre_alternativo, condicion_iva, cuit, dni, 
                   direccion, ciudad, provincia, telefono, email
            FROM clientes 
            ORDER BY nombre ASC
        `;

        // ✅ CONSULTAR TODOS LOS PRODUCTOS CON STOCK > 0
        const queryProductos = `
            SELECT id, nombre, unidad_medida, precio, iva, stock_actual
            FROM productos 
            WHERE stock_actual >= 0
            ORDER BY nombre ASC
        `;

        // ✅ EJECUTAR CONSULTAS EN PARALELO
        const [clientesResults, productosResults] = await Promise.all([
            new Promise((resolve, reject) => {
                db.query(queryClientes, (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            }),
            new Promise((resolve, reject) => {
                db.query(queryProductos, (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            })
        ]);

        const processingTime = Date.now() - startTime;

        // ✅ PREPARAR RESPUESTA OPTIMIZADA
        const catalogoCompleto = {
            clientes: clientesResults,
            productos: productosResults,
            metadata: {
                version: Date.now().toString(), // Timestamp como versión
                totalClientes: clientesResults.length,
                totalProductos: productosResults.length,
                generadoEn: new Date().toISOString(),
                tiempoProcesamiento: `${processingTime}ms`
            }
        };

        // ✅ AUDITAR DESCARGA DE CATÁLOGO
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'catalogo_completo',
            detallesAdicionales: `Catálogo completo descargado: ${clientesResults.length} clientes, ${productosResults.length} productos en ${processingTime}ms`
        });

        console.log(`✅ Catálogo completo enviado: ${clientesResults.length} clientes, ${productosResults.length} productos (${processingTime}ms)`);

        res.json({
            success: true,
            data: catalogoCompleto,
            message: `Catálogo completo: ${clientesResults.length} clientes, ${productosResults.length} productos`
        });

    } catch (error) {
        console.error('❌ Error obteniendo catálogo completo:', error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'catalogo_completo',
            detallesAdicionales: `Error obteniendo catálogo completo: ${error.message}`
        });

        res.status(500).json({
            success: false,
            message: 'Error al obtener catálogo completo',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


const verificarVersionCatalogo = async (req, res) => {
    try {
        const { version: versionCliente } = req.query;

        // ✅ OBTENER METADATA RÁPIDA SIN TRAER TODOS LOS DATOS
        const queryCounts = `
            SELECT 
                (SELECT COUNT(*) FROM clientes) as total_clientes,
                (SELECT COUNT(*) FROM productos WHERE stock_actual >= 0) as total_productos,
                (SELECT MAX(id) FROM clientes) as max_cliente_id,
                (SELECT MAX(id) FROM productos) as max_producto_id
        `;

        const [results] = await new Promise((resolve, reject) => {
            db.query(queryCounts, (err, results) => {
                if (err) return reject(err);
                resolve([results]);
            });
        });

        const counts = results[0];
        
        // ✅ GENERAR VERSIÓN BASADA EN DATOS ACTUALES
        const versionServidor = `${counts.total_clientes}_${counts.total_productos}_${counts.max_cliente_id}_${counts.max_producto_id}`;
        const necesitaActualizacion = versionCliente !== versionServidor;

        res.json({
            success: true,
            data: {
                versionServidor,
                versionCliente: versionCliente || 'sin_version',
                necesitaActualizacion,
                metadata: {
                    totalClientes: counts.total_clientes,
                    totalProductos: counts.total_productos,
                    verificadoEn: new Date().toISOString()
                }
            }
        });

    } catch (error) {
        console.error('❌ Error verificando versión del catálogo:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar versión del catálogo'
        });
    }
};


// Actualizar cliente de un pedido existente
const actualizarClientePedido = async (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { cliente_id } = req.body;

    if (!cliente_id) {
        return res.status(400).json({
            success: false,
            message: 'El ID del cliente es requerido'
        });
    }

    try {
        // 1. Obtener datos del pedido antes de actualizarlo
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
            return res.status(404).json({
                success: false,
                message: 'Pedido no encontrado'
            });
        }

        // ✅ VALIDAR QUE EL PEDIDO NO ESTÉ FACTURADO
        if (datosAnteriores.estado === 'Facturado') {
            console.warn(`⚠️ Intento de editar cliente en pedido facturado ${pedidoId}`);
            
            await auditarOperacion(req, {
                accion: 'UPDATE_BLOCKED',
                tabla: 'pedidos',
                registroId: pedidoId,
                estado: 'FALLIDO',
                detallesAdicionales: `Intento bloqueado de cambiar cliente en pedido facturado ${pedidoId} - Usuario: ${req.user?.nombre || 'Desconocido'} - Cliente anterior: ${datosAnteriores.cliente_nombre}`
            });

            return res.status(403).json({
                success: false,
                message: 'No se puede cambiar el cliente de un pedido que ya está facturado',
                code: 'PEDIDO_FACTURADO',
                estadoActual: datosAnteriores.estado
            });
        }

        // 2. Obtener datos del nuevo cliente
        const obtenerClientePromise = () => {
            return new Promise((resolve, reject) => {
                db.query('SELECT * FROM clientes WHERE id = ?', [cliente_id], (err, results) => {
                    if (err) return reject(err);
                    resolve(results.length > 0 ? results[0] : null);
                });
            });
        };

        const nuevoCliente = await obtenerClientePromise();
        if (!nuevoCliente) {
            return res.status(404).json({
                success: false,
                message: 'Cliente no encontrado'
            });
        }

        // 3. Actualizar el pedido con los datos del nuevo cliente
        const queryActualizar = `
            UPDATE pedidos
            SET
                cliente_id = ?,
                cliente_nombre = ?,
                cliente_telefono = ?,
                cliente_direccion = ?,
                cliente_ciudad = ?,
                cliente_provincia = ?,
                cliente_condicion = ?,
                cliente_cuit = ?
            WHERE id = ?
        `;

        await new Promise((resolve, reject) => {
            db.query(
                queryActualizar,
                [
                    nuevoCliente.id,
                    nuevoCliente.nombre,
                    nuevoCliente.telefono || '',
                    nuevoCliente.direccion || '',
                    nuevoCliente.ciudad || '',
                    nuevoCliente.provincia || '',
                    nuevoCliente.condicion_iva || '',
                    nuevoCliente.cuit || '',
                    pedidoId
                ],
                (err, result) => {
                    if (err) {
                        console.error('Error al actualizar cliente del pedido:', err);
                        return reject(err);
                    }
                    if (result.affectedRows === 0) {
                        return reject(new Error('No se pudo actualizar el pedido'));
                    }
                    resolve(result);
                }
            );
        });

        // 4. Recalcular totales del pedido basados en la condición IVA del nuevo cliente
        await recalcularYActualizarTotalesPedido(pedidoId, nuevoCliente.condicion_iva);

        // 5. Auditar el cambio
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            datosNuevos: {
                ...datosAnteriores,
                cliente_id: nuevoCliente.id,
                cliente_nombre: nuevoCliente.nombre,
                cliente_telefono: nuevoCliente.telefono || '',
                cliente_direccion: nuevoCliente.direccion || '',
                cliente_ciudad: nuevoCliente.ciudad || '',
                cliente_provincia: nuevoCliente.provincia || '',
                cliente_condicion: nuevoCliente.condicion_iva || '',
                cliente_cuit: nuevoCliente.cuit || ''
            },
            detallesAdicionales: `Cliente del pedido actualizado: "${datosAnteriores.cliente_nombre}" (${datosAnteriores.cliente_condicion}) → "${nuevoCliente.nombre}" (${nuevoCliente.condicion_iva})`
        });

        console.log(`✅ Cliente del pedido ${pedidoId} actualizado: ${datosAnteriores.cliente_nombre} → ${nuevoCliente.nombre}`);

        res.json({
            success: true,
            message: `Cliente actualizado correctamente a: ${nuevoCliente.nombre}`,
            data: {
                pedidoId,
                nuevoCliente: {
                    id: nuevoCliente.id,
                    nombre: nuevoCliente.nombre,
                    ciudad: nuevoCliente.ciudad,
                    provincia: nuevoCliente.provincia,
                    condicion_iva: nuevoCliente.condicion_iva
                }
            }
        });

    } catch (error) {
        console.error('Error en actualizarClientePedido:', error);

        // Auditar error
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al actualizar cliente del pedido: ${error.message}`
        });

        res.status(500).json({
            success: false,
            message: 'Error al actualizar el cliente del pedido'
        });
    }
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
    recalcularYActualizarTotalesPedido,
    // Alias para compatibilidad
    registrarPedido: nuevoPedido,
    filtrarCliente: buscarCliente,
    filtrarProducto: buscarProducto,
    
    generarPdfNotaPedido,
    generarPdfNotasPedidoMultiples,
    obtenerDatosFiltros,

    obtenerCatalogoCompleto,
    verificarVersionCatalogo,
    actualizarClientePedido
};