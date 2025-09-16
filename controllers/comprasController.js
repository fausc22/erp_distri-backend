const db = require('./db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');



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
        ORDER BY fecha DESC
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


const manejarMovimientoFondos = async (cuentaId, monto, origen, referenciaId, tipoOperacion = 'insertar') => {
    return new Promise((resolve, reject) => {
        if (!cuentaId || monto <= 0) {
            return resolve(); // No hay cuenta o monto inválido, no hacer nada
        }

        if (tipoOperacion === 'insertar') {
            // Insertar movimiento de egreso
            const queryMovimiento = `
                INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, referencia_id, monto)
                VALUES (?, 'EGRESO', ?, ?, ?)
            `;
            
            db.query(queryMovimiento, [cuentaId, origen, referenciaId, monto], (err, result) => {
                if (err) {
                    console.error('❌ Error al insertar movimiento de fondos:', err);
                    return reject(err);
                }
                
                // Actualizar saldo de la cuenta (restar monto)
                const queryActualizarSaldo = `
                    UPDATE cuenta_fondos 
                    SET saldo = saldo - ? 
                    WHERE id = ?
                `;
                
                db.query(queryActualizarSaldo, [monto, cuentaId], (err, result) => {
                    if (err) {
                        console.error('❌ Error al actualizar saldo de cuenta:', err);
                        return reject(err);
                    }
                    console.log(`✅ Movimiento registrado - Cuenta: ${cuentaId}, Monto: -$${monto}, Origen: ${origen}`);
                    resolve(result);
                });
            });
        } else if (tipoOperacion === 'eliminar') {
            // Eliminar movimiento y restaurar saldo
            const queryEliminarMovimiento = `
                DELETE FROM movimiento_fondos 
                WHERE origen = ? AND referencia_id = ?
            `;
            
            db.query(queryEliminarMovimiento, [origen, referenciaId], (err, result) => {
                if (err) {
                    console.error('❌ Error al eliminar movimiento de fondos:', err);
                    return reject(err);
                }
                
                // Restaurar saldo de la cuenta (sumar monto)
                const queryRestaurarSaldo = `
                    UPDATE cuenta_fondos 
                    SET saldo = saldo + ? 
                    WHERE id = ?
                `;
                
                db.query(queryRestaurarSaldo, [monto, cuentaId], (err, result) => {
                    if (err) {
                        console.error('❌ Error al restaurar saldo de cuenta:', err);
                        return reject(err);
                    }
                    console.log(`✅ Movimiento eliminado - Cuenta: ${cuentaId}, Monto: +$${monto}, Origen: ${origen}`);
                    resolve(result);
                });
            });
        }
    });
};

// Función para obtener los productos de una compra
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
        res.json(results || []);
    });
};


const nuevoGasto = async (req, res) => {
    try {
        const { descripcion, monto, forma_pago, observaciones } = req.body;
        const empleado_id = req.user.id; // Obtenido del middleware de autenticación

        // Validaciones
        if (!descripcion || !monto || !forma_pago) {
            return res.status(400).json({
                success: false,
                message: 'Los campos descripcion, monto y forma_pago son obligatorios'
            });
        }

        if (typeof monto !== 'number' || monto <= 0) {
            return res.status(400).json({
                success: false,
                message: 'El monto debe ser un número mayor a 0'
            });
        }

        if (monto > 99999999.99) {
            return res.status(400).json({
                success: false,
                message: 'El monto no puede exceder $99.999.999,99'
            });
        }

        // Preparar datos para insertar
        const gastoData = {
            descripcion: descripcion.trim(),
            monto: parseFloat(monto).toFixed(2), // Asegurar 2 decimales
            forma_pago: forma_pago.trim(),
            observaciones: observaciones ? observaciones.trim() : null,
            empleado_id: empleado_id,
            fecha: new Date()
        };

        // Query de inserción
        const insertQuery = `
            INSERT INTO gastos (fecha, descripcion, monto, forma_pago, observaciones, empleado_id) 
            VALUES (NOW(), ?, ?, ?, ?, ?)
        `;

        const valores = [
            gastoData.descripcion,
            gastoData.monto,
            gastoData.forma_pago,
            gastoData.observaciones,
            gastoData.empleado_id,
            gastoData.fecha
        ];

        // Ejecutar inserción
        db.query(insertQuery, valores, async (err, result) => {
            if (err) {
                console.error('Error al insertar gasto:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Error al registrar el gasto en la base de datos'
                });
            }

            const gastoId = result.insertId;

            // Auditar la operación
            try {
                await auditarOperacion(req, {
                    accion: 'CREATE',
                    tabla: 'gastos',
                    registroId: gastoId,
                    detallesAdicionales: `Gasto registrado: ${descripcion} - $${monto}`
                });
            } catch (auditError) {
                console.error('Error en auditoría:', auditError);
                // No fallar la operación por error de auditoría
            }

            // Respuesta exitosa
            res.status(201).json({
                success: true,
                message: 'Gasto registrado exitosamente',
                data: {
                    id: gastoId,
                    descripcion: gastoData.descripcion,
                    monto: parseFloat(gastoData.monto),
                    forma_pago: gastoData.forma_pago,
                    observaciones: gastoData.observaciones,
                    empleado_id: gastoData.empleado_id,
                    fecha: gastoData.fecha
                }
            });
        });

    } catch (error) {
        console.error('Error en nuevo gasto:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};


const actualizarGasto = async (req, res) => {
    const gastoId = req.params.gastoId;
    const { descripcion, monto, formaPago, observaciones, empleadoId, cuentaId } = req.body;
    
    try {
        // Obtener datos anteriores
        const datosAnteriores = await new Promise((resolve, reject) => {
            db.query('SELECT * FROM gastos WHERE id = ?', [gastoId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
        
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Gasto no encontrado' });
        }
        
        // Actualizar gasto
        const queryActualizar = `
            UPDATE gastos 
            SET descripcion = ?, monto = ?, forma_pago = ?, observaciones = ?, empleado_id = ?, cuenta_id = ?
            WHERE id = ?
        `;
        
        await new Promise((resolve, reject) => {
            db.query(queryActualizar, [descripcion, monto, formaPago, observaciones, empleadoId, cuentaId, gastoId], (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
        
        // Manejar cambios en movimientos de fondos
        const montoAnterior = parseFloat(datosAnteriores.monto);
        const montoNuevo = parseFloat(monto);
        const cuentaAnterior = datosAnteriores.cuenta_id;
        
        // Si cambió la cuenta o el monto
        if (cuentaAnterior !== cuentaId || montoAnterior !== montoNuevo) {
            // Eliminar movimiento anterior si existía
            if (cuentaAnterior) {
                await manejarMovimientoFondos(cuentaAnterior, montoAnterior, 'gastos', gastoId, 'eliminar');
            }
            
            // Crear nuevo movimiento si hay cuenta
            if (cuentaId) {
                await manejarMovimientoFondos(cuentaId, montoNuevo, 'gastos', gastoId, 'insertar');
            }
        }
        
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'gastos',
            registroId: gastoId,
            datosAnteriores,
            datosNuevos: { ...datosAnteriores, descripcion, monto, formaPago, observaciones, empleadoId, cuentaId },
            detallesAdicionales: `Gasto actualizado: ${descripcion} - Monto: $${monto}`
        });
        
        res.json({ success: true, message: 'Gasto actualizado exitosamente' });
        
    } catch (error) {
        console.error('Error al actualizar gasto:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el gasto' });
    }
};

// Eliminar gasto
const eliminarGasto = async (req, res) => {
    const gastoId = req.params.gastoId;
    
    try {
        // Obtener datos antes de eliminar
        const datosAnteriores = await new Promise((resolve, reject) => {
            db.query('SELECT * FROM gastos WHERE id = ?', [gastoId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
        
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Gasto no encontrado' });
        }
        
        // Eliminar movimiento de fondos si existía
        if (datosAnteriores.cuenta_id) {
            await manejarMovimientoFondos(datosAnteriores.cuenta_id, parseFloat(datosAnteriores.monto), 'gastos', gastoId, 'eliminar');
        }
        
        // Eliminar gasto
        await new Promise((resolve, reject) => {
            db.query('DELETE FROM gastos WHERE id = ?', [gastoId], (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
        
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'gastos',
            registroId: gastoId,
            datosAnteriores,
            detallesAdicionales: `Gasto eliminado: ${datosAnteriores.descripcion} - Monto: $${datosAnteriores.monto}`
        });
        
        res.json({ success: true, message: 'Gasto eliminado exitosamente' });
        
    } catch (error) {
        console.error('Error al eliminar gasto:', error);
        res.status(500).json({ success: false, message: 'Error al eliminar el gasto' });
    }
};


// Función para registrar una nueva compra
const registrarCompra = async (req, res) => {
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
    db.beginTransaction(async (err) => {
        if (err) {
            console.error('Error al iniciar transacción:', err);
            return res.status(500).json({
                success: false,
                message: "Error interno del servidor"
            });
        }
        
        try {
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
            
            const resultCompra = await new Promise((resolve, reject) => {
                db.query(queryCompra, [
                    fechaCompra,
                    proveedor_id,
                    proveedor_nombre,
                    proveedor_cuit,
                    parseFloat(total),
                    empleado_id,
                    empleado_nombre
                ], (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
            
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
            
            await new Promise((resolve, reject) => {
                db.query(queryProductos, [productosData], (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
            
            // Confirmar transacción
            db.commit(async (err) => {
                if (err) {
                    console.error('Error al confirmar transacción:', err);
                    return db.rollback(() => {
                        res.status(500).json({
                            success: false,
                            message: "Error al confirmar la compra"
                        });
                    });
                }
                
                // Auditar creación exitosa de la compra
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'compras',
                    registroId: compraId,
                    datosNuevos: { 
                        id: compraId,
                        proveedor_nombre,
                        proveedor_cuit,
                        total: parseFloat(total),
                        productos_count: productos.length
                    },
                    detallesAdicionales: `Compra registrada - Proveedor: ${proveedor_nombre} - Total: $${total} - ${productos.length} productos`
                });
                
                res.json({
                    success: true,
                    message: "Compra registrada exitosamente",
                    data: {
                        compra_id: compraId,
                        total: parseFloat(total),
                        productos_registrados: productos.length
                    }
                });
            });
            
        } catch (error) {
            console.error('Error en el proceso de compra:', error);
            
            // Auditar error en creación de la compra
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'compras',
                detallesAdicionales: `Error al registrar compra: ${error.message}`,
                datosNuevos: req.body
            });
            
            db.rollback(() => {
                res.status(500).json({
                    success: false,
                    message: "Error al registrar la compra"
                });
            });
        }
    });
};



// Función auxiliar para actualizar stock de productos
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
            
           const cantidadFloat = parseFloat(producto.cantidad);
            console.log(`Stock actualizado: ${producto.id} +${cantidadFloat}`);
            productosActualizados++;
            if (productosActualizados === totalProductos) {
                callback(null);
            }
        });
    });
};


// Función para registrar compra con actualización de stock
const registrarCompraConStock = async (req, res) => {
    const { 
        proveedor_id, 
        proveedor_nombre, 
        proveedor_cuit, 
        total, 
        fecha, 
        productos,
        empleado_id = null,
        empleado_nombre = null,
        actualizarStock = true,
        cuentaId = null  
    } = req.body;
    
    // Validaciones básicas
    if (!proveedor_id || !proveedor_nombre || !total || !productos || productos.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Datos incompletos. Se requiere proveedor, total y al menos un producto."
        });
    }
    
    // ✅ USAR PROMESAS PARA TRANSACCIONES
    let connection;
    
    try {
        // ✅ Obtener conexión del pool
        connection = await new Promise((resolve, reject) => {
            db.getConnection((err, conn) => {
                if (err) return reject(err);
                resolve(conn);
            });
        });
        
        // ✅ Iniciar transacción
        await new Promise((resolve, reject) => {
            connection.beginTransaction((err) => {
                if (err) return reject(err);
                resolve();
            });
        });
        
        console.log('✅ Transacción iniciada para compra');
        
        // ✅ Insertar la compra principal
        const queryCompra = `
            INSERT INTO compras (
                fecha, 
                proveedor_id, 
                proveedor_nombre, 
                proveedor_cuit, 
                total, 
                estado,
                empleado_id,
                empleado_nombre,
                cuenta_id
            ) VALUES (?, ?, ?, ?, ?, 'Registrada', ?, ?, ?)
        `;
        
        const fechaCompra = fecha || new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        const resultCompra = await new Promise((resolve, reject) => {
            connection.query(queryCompra, [
                fechaCompra,
                proveedor_id,
                proveedor_nombre,
                proveedor_cuit,
                parseFloat(total),
                empleado_id,
                empleado_nombre,
                cuentaId
            ], (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
        
        const compraId = resultCompra.insertId;
        console.log(`✅ Compra insertada con ID: ${compraId}`);
        
        // ✅ Preparar los datos de los productos
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
            parseFloat(producto.cantidad),
            parseFloat(producto.precio_costo),
            parseFloat(producto.precio_venta),
            0,
            parseFloat(producto.subtotal)
        ]);
        
        await new Promise((resolve, reject) => {
            connection.query(queryProductos, [productosData], (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
        
        console.log(`✅ ${productos.length} productos insertados`);
        
        // ✅ Actualizar stock si se solicita
        if (actualizarStock) {
            for (const producto of productos) {
                const queryUpdateStock = `
                    UPDATE productos 
                    SET stock_actual = stock_actual + ?
                    WHERE id = ?
                `;
                
                await new Promise((resolve, reject) => {
                    connection.query(queryUpdateStock, [producto.cantidad, producto.id], (err, result) => {
                        if (err) return reject(err);
                        resolve(result);
                    });
                });
            }
            console.log('✅ Stock actualizado');
        }
        
        // ✅ Manejar movimiento de fondos si hay cuenta asignada
        if (cuentaId) {
            await manejarMovimientoFondosConConexion(connection, cuentaId, parseFloat(total), 'compras', compraId, 'insertar');
            console.log('✅ Movimiento de fondos registrado');
        }
        
        // ✅ Confirmar transacción
        await new Promise((resolve, reject) => {
            connection.commit((err) => {
                if (err) return reject(err);
                resolve();
            });
        });
        
        console.log('✅ Transacción confirmada exitosamente');
        
        // ✅ Auditar creación exitosa de la compra con stock
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'compras',
            registroId: compraId,
            datosNuevos: { 
                id: compraId,
                proveedor_nombre,
                proveedor_cuit,
                total: parseFloat(total),
                productos_count: productos.length,
                stock_actualizado: actualizarStock,
                cuenta_id: cuentaId
            },
            detallesAdicionales: `Compra registrada con ${actualizarStock ? 'actualización' : 'sin actualización'} de stock - Proveedor: ${proveedor_nombre} - Total: $${total} - ${productos.length} productos${cuentaId ? ` - Cuenta: ${cuentaId}` : ''}`
        });
        
        res.json({
            success: true,
            message: `Compra registrada exitosamente${actualizarStock ? ' con actualización de stock' : ''}${cuentaId ? ' y movimiento de fondos' : ''}`,
            data: {
                compra_id: compraId,
                total: parseFloat(total),
                productos_registrados: productos.length
            }
        });
        
    } catch (error) {
        console.error('❌ Error en el proceso de compra:', error);
        
        // ✅ Rollback en caso de error
        if (connection) {
            try {
                await new Promise((resolve, reject) => {
                    connection.rollback((err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
                console.log('✅ Rollback ejecutado correctamente');
            } catch (rollbackError) {
                console.error('❌ Error en rollback:', rollbackError);
            }
        }
        
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'compras',
            detallesAdicionales: `Error al registrar compra con stock: ${error.message}`,
            datosNuevos: req.body
        });
        
        res.status(500).json({
            success: false,
            message: "Error al registrar la compra",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        
    } finally {
        // ✅ Liberar conexión
        if (connection) {
            connection.release();
            console.log('🔌 Conexión liberada');
        }
    }
};

const manejarMovimientoFondosConConexion = async (connection, cuentaId, monto, origen, referenciaId, tipoOperacion = 'insertar') => {
    return new Promise((resolve, reject) => {
        if (!cuentaId || monto <= 0) {
            return resolve(); // No hay cuenta o monto inválido, no hacer nada
        }

        if (tipoOperacion === 'insertar') {
            // Insertar movimiento de egreso
            const queryMovimiento = `
                INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, referencia_id, monto)
                VALUES (?, 'EGRESO', ?, ?, ?)
            `;
            
            connection.query(queryMovimiento, [cuentaId, origen, referenciaId, monto], (err, result) => {
                if (err) {
                    console.error('❌ Error al insertar movimiento de fondos:', err);
                    return reject(err);
                }
                
                // Actualizar saldo de la cuenta (restar monto)
                const queryActualizarSaldo = `
                    UPDATE cuenta_fondos 
                    SET saldo = saldo - ? 
                    WHERE id = ?
                `;
                
                connection.query(queryActualizarSaldo, [monto, cuentaId], (err, result) => {
                    if (err) {
                        console.error('❌ Error al actualizar saldo de cuenta:', err);
                        return reject(err);
                    }
                    console.log(`✅ Movimiento registrado - Cuenta: ${cuentaId}, Monto: -$${monto}, Origen: ${origen}`);
                    resolve(result);
                });
            });
        } else if (tipoOperacion === 'eliminar') {
            // Eliminar movimiento y restaurar saldo
            const queryEliminarMovimiento = `
                DELETE FROM movimiento_fondos 
                WHERE origen = ? AND referencia_id = ?
            `;
            
            connection.query(queryEliminarMovimiento, [origen, referenciaId], (err, result) => {
                if (err) {
                    console.error('❌ Error al eliminar movimiento de fondos:', err);
                    return reject(err);
                }
                
                // Restaurar saldo de la cuenta (sumar monto)
                const queryRestaurarSaldo = `
                    UPDATE cuenta_fondos 
                    SET saldo = saldo + ? 
                    WHERE id = ?
                `;
                
                connection.query(queryRestaurarSaldo, [monto, cuentaId], (err, result) => {
                    if (err) {
                        console.error('❌ Error al restaurar saldo de cuenta:', err);
                        return reject(err);
                    }
                    console.log(`✅ Movimiento eliminado - Cuenta: ${cuentaId}, Monto: +$${monto}, Origen: ${origen}`);
                    resolve(result);
                });
            });
        }
    });
};

module.exports = {
    obtenerGastos,
    obtenerGasto,
    obtenerCompras,
    obtenerProductosCompra,
    nuevoGasto,
    actualizarGasto,
    eliminarGasto,
    registrarCompraConStock
};