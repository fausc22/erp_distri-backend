const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const puppeteer = require("puppeteer");
const multer = require('multer');
const stockMiddleware = require('../middlewares/stockMiddleware');



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

// ========== FUNCIONES DE PEDIDOS ==========

// Función para registrar un pedido en la tabla principal
const registrarPedido = (pedidoData, callback) => {
    const { 
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
        subtotal, iva_total, total, estado, empleado_id, empleado_nombre, observaciones 
    } = pedidoData;

    const registrarPedidoQuery = `
        INSERT INTO pedidos 
        (fecha, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, 
         cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, total, 
         estado, observaciones, empleado_id, empleado_nombre)
        VALUES 
        (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        callback(null, result.insertId); // Devuelve el ID del pedido recién insertado
    });
};

// Función para insertar los productos del pedido
const insertarProductosPedido = async (pedidoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        await Promise.all(productos.map(async producto => { // ¡Nota el 'async' aquí!
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

            
            await stockMiddleware.actualizarStock(id, -cantidad, 'pedido'); 
                

        }));
        return null; // Si todo salió bien
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
            return res.status(500).json({ success: false, message: 'Error al insertar el pedido' });
        }

        const errorProductos = await insertarProductosPedido(pedidoId, productos);
        if (errorProductos) {
            return res.status(500).json({ success: false, message: 'Error al insertar los productos del pedido' });
        }

        res.json({ success: true, message: 'Pedido y productos insertados correctamente', pedidoId });
    });

                
};

// Obtener todos los pedidos (con filtro opcional por empleado)
const obtenerPedidos = (req, res) => {
    const empleadoId = req.query.empleado_id; // Parámetro opcional para filtrar por empleado
    
    let query = `
        SELECT 
            id, DATE_FORMAT(fecha, '%d-%m-%Y // %H:%i:%s') AS fecha, 
            cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
            cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
            subtotal, iva_total, total, estado, observaciones, 
            empleado_id, empleado_nombre
        FROM pedidos 
    `;
    
    let queryParams = [];
    
    // Si se especifica empleado_id, filtrar por ese empleado (para vendedores)
    if (empleadoId) {
        query += ` WHERE empleado_id = ?`;
        queryParams.push(empleadoId);
    }
    
    query += ` ORDER BY fecha DESC`;
    
    db.query(query, queryParams, (err, results) => {
        if (err) {
            console.error('Error al obtener pedidos:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
        }
        
        console.log(`📋 Consulta pedidos: ${empleadoId ? `empleado ${empleadoId}` : 'todos'} - ${results.length} resultados`);
        res.json({ success: true, data: results });
    });
};

// Obtener detalle de un pedido específico
const obtenerDetallePedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    
    // Consulta para obtener los datos del pedido
    const queryPedido = `
        SELECT * FROM pedidos WHERE id = ?
    `;
    
    // Consulta para obtener los productos del pedido
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
const actualizarEstadoPedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { estado } = req.body;
    
    // Validar que el estado sea uno de los permitidos
    const estadosValidos = ['Exportado', 'Facturado', 'Anulado'];
    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Estado inválido. Los estados permitidos son: Exportado, Facturado, Anulado' 
        });
    }
    
    const query = `
        UPDATE pedidos
        SET estado = ?
        WHERE id = ?
    `;

    db.query(query, [estado, pedidoId], (err, result) => {
        if (err) {
            console.error('Error al actualizar el estado del pedido:', err);
            return res.status(500).json({ success: false, message: 'Error al actualizar el estado del pedido' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }
        
        res.json({ success: true, message: 'Estado del pedido actualizado correctamente' });
    });
};


// Eliminar un pedido (elimina también los productos por CASCADE)
const eliminarPedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    
    const query = `
        DELETE FROM pedidos WHERE id = ?
    `;

    db.query(query, [pedidoId], (err, result) => {
        if (err) {
            console.error('Error al eliminar el pedido:', err);
            return res.status(500).json({ success: false, message: 'Error al eliminar el pedido' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }
        
        res.json({ success: true, message: 'Pedido eliminado correctamente' });
    });
};



// Obtener productos de un pedido específico (funcionalidad extra)
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
    const query = `
        SELECT * FROM pedidos WHERE id = ?
    `;
    
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
const actualizarObservacionesPedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { observaciones } = req.body;
    
    const query = `
        UPDATE pedidos SET observaciones = ? WHERE id = ?
    `;

    db.query(query, [observaciones || 'sin observaciones', pedidoId], (err, result) => {
        if (err) {
            console.error('Error al actualizar observaciones:', err);
            return res.status(500).json({ success: false, message: 'Error al actualizar observaciones' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }
        
        res.json({ success: true, message: 'Observaciones actualizadas correctamente' });
    });
};


// Agregar producto a un pedido existente
const agregarProductoPedidoExistente = (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal } = req.body;

    const query = `
        INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [pedidoId, producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal], (err, results) => {
        if (err) {
            console.error('Error al insertar el producto:', err);
            return res.status(500).json({ success: false, message: "Error al insertar el producto" });
        }
        res.json({ success: true, message: "Producto agregado correctamente", data: results });
    });
};

// Actualizar producto de un pedido
const actualizarProductoPedido = (req, res) => {
    const { cantidad, precio, iva, subtotal } = req.body;
    const productId = req.params.productId;

    const query = `
        UPDATE pedidos_cont SET cantidad = ?, precio = ?, IVA = ?, subtotal = ? WHERE id = ? 
    `;

    db.query(query, [cantidad, precio, iva, subtotal, productId], (err, result) => {
        if (err) {
            console.error('Error al actualizar el producto:', err);
            return res.status(500).json({ success: false, message: 'Error al actualizar el producto' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }
        
        res.json({ success: true, message: 'Producto actualizado correctamente' });
    });
};

// Eliminar producto de un pedido
const eliminarProductoPedido = (req, res) => {
    const productId = req.params.productId;

    const query = `
        DELETE FROM pedidos_cont WHERE id = ? 
    `;

    db.query(query, [productId], (err, result) => {
        if (err) {
            console.error('Error al eliminar el producto:', err);
            return res.status(500).json({ success: false, message: 'Error al eliminar el producto' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }
        
        res.json({ success: true, message: 'Producto eliminado correctamente' });
    });
};

// Actualizar totales del pedido
const actualizarTotalesPedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    const { subtotal, iva_total, total } = req.body;
    
    const query = `
        UPDATE pedidos SET subtotal = ?, iva_total = ?, total = ? WHERE id = ?
    `;

    db.query(query, [subtotal, iva_total, total, pedidoId], (err, result) => {
        if (err) {
            console.error('Error al actualizar totales:', err);
            return res.status(500).json({ success: false, message: 'Error al actualizar totales' });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }
        
        res.json({ success: true, message: 'Totales actualizados correctamente' });
    });
};



const generarPdfNotaPedido = async (req, res) => {
    const { pedido, productos } = req.body;

    if (!pedido || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }
    
    // Ruta de la plantilla HTML
    const templatePath = path.join(__dirname, "../resources/documents/nota_pedido2.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        // Leer y reemplazar la plantilla HTML
        let htmlTemplate = fs.readFileSync(templatePath, "utf8");

        htmlTemplate = htmlTemplate
            .replace("{{fecha}}", pedido.fecha)
            .replace("{{id}}", pedido.id)
            .replace("{{cliente_nombre}}", pedido.cliente_nombre)
            .replace("{{cliente_direccion}}", pedido.cliente_direccion || "No informado")
            .replace("{{cliente_telefono}}", pedido.cliente_telefono || "No informado")
            .replace("{{empleado_nombre}}", pedido.empleado_nombre || "No informado");


         const itemsHTML = productos.map(p => `
            <tr>
                <td>${p.producto_id || ''}</td>
                <td>${p.producto_nombre || ''}</td>
                <td>${p.producto_descripcion || ""}</td>
                <td>${p.producto_um || ''}</td>
                <td class="text-right">${p.cantidad || 0}</td>
            </tr>
        `).join("\n");

        // Reemplazar el placeholder de los productos
        htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);


        
        


        // Iniciar Puppeteer y generar PDF
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" }); // ⬅️ Espera hasta que la página cargue completamente
        const pdfBuffer = await page.pdf({ format: "A4" });

        await browser.close();

        // Configurar la respuesta
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="NotaPedido_${pedido.cliente_nombre}.pdf"`);

        
        res.end(pdfBuffer); // ⬅️ Usa res.end() en lugar de res.send() para archivos binarios
    } catch (error) {
        console.error("Error generando PDF:", error);
        res.status(500).json({ error: "Error al generar el PDF" });
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
    
    // Alias para compatibilidad con diferentes rutas
    registrarPedido: nuevoPedido,
    filtrarCliente: buscarCliente,
    filtrarProducto: buscarProducto

    ,
    generarPdfNotaPedido
};