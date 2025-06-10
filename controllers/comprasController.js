const db = require('./db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');


// Definir la ruta de almacenamiento para los comprobantes
const comprobantesPath = path.join(__dirname, "../storage/comprobantes");
// Si no existe la carpeta, la crea
if (!fs.existsSync(comprobantesPath)) {
    fs.mkdirSync(comprobantesPath, { recursive: true });
}

// Configuración de multer para guardar los archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, comprobantesPath);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const extension = path.extname(file.originalname);
        cb(null, `temp-${timestamp}${extension}`);
    },
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB
    fileFilter: (req, file, cb) => {
        // Verificar tipos de archivo permitidos
        const filetypes = /jpeg|jpg|png|pdf/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        
        cb(new Error("El archivo debe ser una imagen (JPG, PNG) o un PDF"));
    }
}).single("comprobante");



// Función para obtener todas las compras
const obtenerCompras = (req, res) => {
    const query = `
        SELECT * FROM compras
        ORDER BY fecha DESC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener compras:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener compras" 
            });
        }
        res.json({ 
            success: true, 
            data: results 
        });
    });
};

// Función para obtener todos los gastos
const obtenerGastos = (req, res) => {
    const query = `
        SELECT * FROM gastos
        ORDER BY fecha ASC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener gastos:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener gastos" 
            });
        }
        res.json({ 
            success: true, 
            data: results 
        });
    });
};

// Función para obtener un gasto específico
const obtenerGasto = (req, res) => {
    const gastoId = req.params.gastoId;
    
    const query = `
        SELECT * FROM gastos
        WHERE id = ?
    `;
    
    db.query(query, [gastoId], (err, results) => {
        if (err) {
            console.error('Error al obtener el gasto:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener el gasto" 
            });
        }
        
        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Gasto no encontrado"
            });
        }
        
        res.json({ 
            success: true, 
            data: results[0] 
        });
    });
};

// Función para obtener los productos de una compra (CORREGIDA)
const obtenerProductosCompra = (req, res) => {
    const compraId = req.params.compraId;
    
    const query = `
        SELECT 
            compra_id, producto_id, producto_nombre, producto_um, cantidad, costo, precio, IVA, subtotal
        FROM compras_cont 
        WHERE compra_id = ?
    `;
    
    db.query(query, [compraId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos de la compra:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener productos de la compra" 
            });
        }
        // Siempre devolvemos un array como respuesta, incluso si está vacío
        res.json(results || []);
    });
};



const nuevoGasto = (req, res) => {
    const { descripcion, monto, formaPago, observaciones, empleadoId } = req.body;
    
    const query = `
        INSERT INTO gastos (fecha, descripcion, monto, forma_pago, observaciones, empleado_id)
        VALUES (NOW(), ?, ?, ?, ?, ?)
    `;
    
    db.query(query, [descripcion, monto, formaPago, observaciones, empleadoId], (err, results) => {
        if (err) {
            console.error('Error al crear el gasto:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al crear el gasto" 
            });
        }
        
        res.json({ 
            success: true, 
            message: "Gasto creado exitosamente", 
            data: { id: results.insertId } 
        });
    });
};


// Función para registrar una nueva compra
const registrarCompra = (req, res) => {
    const { 
        proveedor_id, 
        proveedor_nombre, 
        proveedor_cuit, 
        total, 
        fecha, 
        productos,
        empleado_id = null,
        empleado_nombre = null 
    } = req.body;
    
    // Validaciones básicas
    if (!proveedor_id || !proveedor_nombre || !total || !productos || productos.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Datos incompletos. Se requiere proveedor, total y al menos un producto."
        });
    }
    
    // Iniciar transacción
    db.beginTransaction((err) => {
        if (err) {
            console.error('Error al iniciar transacción:', err);
            return res.status(500).json({
                success: false,
                message: "Error interno del servidor"
            });
        }
        
        // Insertar la compra principal
        const queryCompra = `
            INSERT INTO compras (
                fecha, 
                proveedor_id, 
                proveedor_nombre, 
                proveedor_cuit, 
                total, 
                estado,
                empleado_id,
                empleado_nombre
            ) VALUES (?, ?, ?, ?, ?, 'Registrada', ?, ?)
        `;
        
        const fechaCompra = fecha || new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        db.query(queryCompra, [
            fechaCompra,
            proveedor_id,
            proveedor_nombre,
            proveedor_cuit,
            parseFloat(total),
            empleado_id,
            empleado_nombre
        ], (err, resultCompra) => {
            if (err) {
                console.error('Error al insertar compra:', err);
                return db.rollback(() => {
                    res.status(500).json({
                        success: false,
                        message: "Error al registrar la compra"
                    });
                });
            }
            
            const compraId = resultCompra.insertId;
            
            // Preparar los datos de los productos para inserción múltiple
            const queryProductos = `
                INSERT INTO compras_cont (
                    compra_id,
                    producto_id,
                    producto_nombre,
                    producto_um,
                    cantidad,
                    costo,
                    precio,
                    IVA,
                    subtotal
                ) VALUES ?
            `;
            
            // Mapear productos del frontend a formato de base de datos
            const productosData = productos.map(producto => [
                compraId,
                producto.id,
                producto.nombre,
                producto.unidad_medida || null,
                parseInt(producto.cantidad),
                parseFloat(producto.precio_costo),
                parseFloat(producto.precio_venta),
                0, // IVA - calculamos como 0 por ahora, se puede ajustar según necesidad
                parseFloat(producto.subtotal)
            ]);
            
            db.query(queryProductos, [productosData], (err, resultProductos) => {
                if (err) {
                    console.error('Error al insertar productos de la compra:', err);
                    return db.rollback(() => {
                        res.status(500).json({
                            success: false,
                            message: "Error al registrar los productos de la compra"
                        });
                    });
                }
                
                // Confirmar transacción
                db.commit((err) => {
                    if (err) {
                        console.error('Error al confirmar transacción:', err);
                        return db.rollback(() => {
                            res.status(500).json({
                                success: false,
                                message: "Error al confirmar la compra"
                            });
                        });
                    }
                    
                    // Respuesta exitosa
                    res.json({
                        success: true,
                        message: "Compra registrada exitosamente",
                        data: {
                            compra_id: compraId,
                            total: parseFloat(total),
                            productos_registrados: resultProductos.affectedRows
                        }
                    });
                });
            });
        });
    });
};

// Función auxiliar para actualizar stock de productos (opcional)
const actualizarStockProductos = (productos, callback) => {
    let productosActualizados = 0;
    const totalProductos = productos.length;
    
    if (totalProductos === 0) {
        return callback(null);
    }
    
    productos.forEach(producto => {
        const queryUpdateStock = `
            UPDATE productos 
            SET stock_actual = stock_actual + ?
            WHERE id = ?
        `;
        
        db.query(queryUpdateStock, [producto.cantidad, producto.id], (err) => {
            if (err) {
                console.error(`Error al actualizar stock del producto ${producto.id}:`, err);
                return callback(err);
            }
            
            productosActualizados++;
            if (productosActualizados === totalProductos) {
                callback(null);
            }
        });
    });
};

// Función para registrar compra con actualización de stock
const registrarCompraConStock = (req, res) => {
    const { 
        proveedor_id, 
        proveedor_nombre, 
        proveedor_cuit, 
        total, 
        fecha, 
        productos,
        empleado_id = null,
        empleado_nombre = null,
        actualizarStock = true 
    } = req.body;
    
    // Validaciones básicas
    if (!proveedor_id || !proveedor_nombre || !total || !productos || productos.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Datos incompletos. Se requiere proveedor, total y al menos un producto."
        });
    }
    
    // Iniciar transacción
    db.beginTransaction((err) => {
        if (err) {
            console.error('Error al iniciar transacción:', err);
            return res.status(500).json({
                success: false,
                message: "Error interno del servidor"
            });
        }
        
        // Insertar la compra principal
        const queryCompra = `
            INSERT INTO compras (
                fecha, 
                proveedor_id, 
                proveedor_nombre, 
                proveedor_cuit, 
                total, 
                estado,
                empleado_id,
                empleado_nombre
            ) VALUES (?, ?, ?, ?, ?, 'Registrada', ?, ?)
        `;
        
        const fechaCompra = fecha || new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        db.query(queryCompra, [
            fechaCompra,
            proveedor_id,
            proveedor_nombre,
            proveedor_cuit,
            parseFloat(total),
            empleado_id,
            empleado_nombre
        ], (err, resultCompra) => {
            if (err) {
                console.error('Error al insertar compra:', err);
                return db.rollback(() => {
                    res.status(500).json({
                        success: false,
                        message: "Error al registrar la compra"
                    });
                });
            }
            
            const compraId = resultCompra.insertId;
            
            // Preparar los datos de los productos
            const queryProductos = `
                INSERT INTO compras_cont (
                    compra_id,
                    producto_id,
                    producto_nombre,
                    producto_um,
                    cantidad,
                    costo,
                    precio,
                    IVA,
                    subtotal
                ) VALUES ?
            `;
            
            const productosData = productos.map(producto => [
                compraId,
                producto.id,
                producto.nombre,
                producto.unidad_medida || null,
                parseInt(producto.cantidad),
                parseFloat(producto.precio_costo),
                parseFloat(producto.precio_venta),
                0,
                parseFloat(producto.subtotal)
            ]);
            
            db.query(queryProductos, [productosData], (err, resultProductos) => {
                if (err) {
                    console.error('Error al insertar productos de la compra:', err);
                    return db.rollback(() => {
                        res.status(500).json({
                            success: false,
                            message: "Error al registrar los productos de la compra"
                        });
                    });
                }
                
                // Actualizar stock si se solicita
                if (actualizarStock) {
                    actualizarStockProductos(productos, (err) => {
                        if (err) {
                            console.error('Error al actualizar stock:', err);
                            return db.rollback(() => {
                                res.status(500).json({
                                    success: false,
                                    message: "Error al actualizar el stock de los productos"
                                });
                            });
                        }
                        
                        // Confirmar transacción
                        db.commit((err) => {
                            if (err) {
                                console.error('Error al confirmar transacción:', err);
                                return db.rollback(() => {
                                    res.status(500).json({
                                        success: false,
                                        message: "Error al confirmar la compra"
                                    });
                                });
                            }
                            
                            res.json({
                                success: true,
                                message: "Compra registrada exitosamente con actualización de stock",
                                data: {
                                    compra_id: compraId,
                                    total: parseFloat(total),
                                    productos_registrados: resultProductos.affectedRows
                                }
                            });
                        });
                    });
                } else {
                    // Confirmar sin actualizar stock
                    db.commit((err) => {
                        if (err) {
                            console.error('Error al confirmar transacción:', err);
                            return db.rollback(() => {
                                res.status(500).json({
                                    success: false,
                                    message: "Error al confirmar la compra"
                                });
                            });
                        }
                        
                        res.json({
                            success: true,
                            message: "Compra registrada exitosamente",
                            data: {
                                compra_id: compraId,
                                total: parseFloat(total),
                                productos_registrados: resultProductos.affectedRows
                            }
                        });
                    });
                }
            });
        });
    });
};




module.exports = {
    obtenerGastos,
    obtenerGasto,
    obtenerCompras,
    obtenerProductosCompra,
    nuevoGasto,
    registrarCompraConStock
};
