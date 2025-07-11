const db = require('./db');

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');

const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const pdfGenerator = require('../utils/pdfGenerator');



//
const obtenerVentas = (req, res) => {
    const query = `
        SELECT 
            id, fecha, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, subtotal, iva_total, total, estado, observaciones, empleado_id, empleado_nombre, cae_id, cae_fecha
        FROM ventas ORDER BY fecha DESC`;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener ventas:', err);
            res.status(500).send('Error al obtener ventas');
        } else {
            res.json(results);
        }
    });
};

const filtrarVenta = (req, res) => {
    const ventaId = req.params.ventaId;
    const query = `SELECT * FROM ventas WHERE id = ?`;
    db.query(query, [ventaId], (err, results) => {
        if (err) {
            console.error('Error ejecutando la consulta:', err);
            res.status(500).send('Error en el servidor');
            return;
        }
        res.json(results);
    });
};

const filtrarProductosVenta = (req, res) => {
    const ventaId = req.params.id;

    const query = `
        SELECT id, venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal FROM ventas_cont
        WHERE venta_id = ?
    `;
    
    db.query(query, [ventaId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos de la venta:', err);
            return res.status(500).json({ error: 'Error al obtener productos de la venta' });
        }
        res.json(results);
    });
};

const formatearFecha = (fechaBD) => {
    if (!fechaBD) return 'Fecha no disponible';
    
    try {
        const fecha = new Date(fechaBD);
        
        if (isNaN(fecha.getTime())) {
            console.warn('Fecha inválida recibida:', fechaBD);
            return 'Fecha inválida';
        }
        
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const año = fecha.getFullYear();
        
        const horas = String(fecha.getHours()).padStart(2, '0');
        const minutos = String(fecha.getMinutes()).padStart(2, '0');
        const segundos = String(fecha.getSeconds()).padStart(2, '0');
        
        return `${dia}/${mes}/${año} - ${horas}:${minutos}:${segundos}`;
        
    } catch (error) {
        console.error('Error formateando fecha:', error, 'Fecha original:', fechaBD);
        return 'Error en fecha';
    }
};



const generarPdfFactura = async (req, res) => {
    const { venta, productos } = req.body;

    if (!venta || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    try {
        console.log('📄 Generando PDF de factura optimizado...');
        const startTime = Date.now();

        // ✅ USAR PLANTILLA HTML EXACTA (mismo que antes)
        const pdfBuffer = await pdfGenerator.generarFactura(venta, productos);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de factura generado en ${generationTime}ms`);

        // ✅ Auditar generación de PDF
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            registroId: venta.id,
            detallesAdicionales: `PDF de factura generado optimizado en ${generationTime}ms - Cliente: ${venta.cliente_nombre} - Total: $${venta.total}`
        });

        // ✅ Enviar respuesta (igual que antes)
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Factura_${venta.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
        
        res.end(pdfBuffer);
        
        console.log('✅ PDF de factura enviado exitosamente');

    } catch (error) {
        console.error("❌ Error generando PDF:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            registroId: venta.id,
            detallesAdicionales: `Error generando PDF de factura optimizado: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar el PDF",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const generarPdfRankingVentas = async (req, res) => {
    const { fecha, ventas } = req.body; // Expecting 'fecha' and an array of 'ventas'

    if (!fecha || !ventas || !Array.isArray(ventas) || ventas.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el ranking de ventas en PDF. Se requiere una fecha y un array de ventas." });
    }

    try {
        console.log(`📄 Generando PDF de Ranking de Ventas para la fecha ${fecha} (${ventas.length} ventas)...`);
        const startTime = Date.now();

        // Call the pdfGenerator's function
        const pdfBuffer = await pdfGenerator.generarRankingVentas(fecha, ventas);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de Ranking de Ventas generado en ${generationTime}ms`);

        // Auditar generación de PDF
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ranking_ventas', // Or a more appropriate table/context
            detallesAdicionales: `PDF de Ranking de Ventas generado optimizado en ${generationTime}ms para ${ventas.length} ventas.`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Ranking_Ventas_${new Date(fecha).toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ PDF de Ranking de Ventas enviado exitosamente');

    } catch (error) {
        console.error("❌ Error generando PDF de Ranking de Ventas:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ranking_ventas',
            detallesAdicionales: `Error generando PDF de Ranking de Ventas: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar el PDF de Ranking de Ventas",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};



// ✅ NUEVA FUNCIÓN - Generar PDFs múltiples de facturas
const generarPdfFacturasMultiples = async (req, res) => {
    const { ventasIds } = req.body;
    
    if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de venta válido" });
    }

    try {
        console.log(`📄 Generando ${ventasIds.length} facturas múltiples optimizadas...`);
        const startTime = Date.now();

        const htmlSections = [];

        // ✅ USAR LA MISMA LÓGICA QUE LA FUNCIÓN INDIVIDUAL
        for (const ventaId of ventasIds) {
            try {
                const ventaRows = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM ventas WHERE id = ?', [ventaId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (ventaRows.length === 0) {
                    console.warn(`Venta con ID ${ventaId} no encontrada, continuando`);
                    continue;
                }
                
                const productos = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM ventas_cont WHERE venta_id = ?', [ventaId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (productos.length === 0) {
                    console.warn(`No se encontraron productos para la venta ${ventaId}, continuando`);
                    continue;
                }
                
                // ✅ USAR EXACTAMENTE LA MISMA LÓGICA QUE generarFactura()
                const templatePath = path.join(pdfGenerator.templatesPath, 'factura.html');
                let htmlTemplate = require('fs').readFileSync(templatePath, 'utf8');
                
                htmlTemplate = htmlTemplate
                    .replace('{{fecha}}', pdfGenerator.formatearFecha(ventaRows[0].fecha))
                    .replace('{{cliente_nombre}}', ventaRows[0].cliente_nombre);
                
                const itemsHTML = productos.map(producto => {
                    const subtotal = parseFloat(producto.subtotal) || 0;
                    const iva = parseFloat(producto.iva || producto.IVA) || 0;
                    const total = subtotal + iva;
                    const productoPrecioIva = (total  / producto.cantidad) ;

                    return `
                        <tr>
                            <td>${producto.producto_id}</td>
                            <td>${producto.producto_nombre}</td>
                            <td>${producto.producto_um}</td>
                            <td style="text-align: center;">${producto.cantidad}</td>
                            <td style="text-align: right;">$${productoPrecioIva.toFixed(2)}</td>
                            <td style="text-align: right;">$${total.toFixed(2)}</td>
                        </tr>
                    `;
                }).join('');
                
                htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
                
                // ✅ CALCULAR TOTALES EXACTAMENTE IGUAL
            const subtotalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0).toFixed(2);
            const ivaPdf = productos.reduce((acc, item) => acc + (parseFloat(item.iva) || 0), 0).toFixed(2);
            const totalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0) + (parseFloat(item.iva) || 0), 0).toFixed(2);

            htmlTemplate = htmlTemplate.replace('{{total}}', ventaRows[0].total || totalPdf);
                
                htmlSections.push(htmlTemplate);
                
            } catch (error) {
                console.error(`Error procesando venta ID ${ventaId}:`, error);
            }
        }
        
        if (htmlSections.length === 0) {
            return res.status(404).json({ error: "No se pudieron obtener datos para las ventas seleccionadas" });
        }

        // ✅ COMBINAR TODAS LAS SECCIONES
        const combinedHTML = htmlSections.join('<div style="page-break-before: always;"></div>');
        const pdfBuffer = await pdfGenerator.generatePdfFromHtml(combinedHTML);

        const generationTime = Date.now() - startTime;
        console.log(`✅ ${htmlSections.length} facturas múltiples generadas en ${generationTime}ms`);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Facturas_Multiples_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDFs múltiples:", error);
        res.status(500).json({ 
            error: "Error al generar los PDFs múltiples",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ✅ NUEVA FUNCIÓN - Generar PDF de lista de precios
const generarPdfListaPrecio = async (req, res) => {
    const { cliente, productos } = req.body;

    if (!cliente || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    try {
        console.log('📄 Generando PDF de lista de precios optimizado...');
        const startTime = Date.now();

        // ✅ USAR PLANTILLA HTML EXACTA
        const pdfBuffer = await pdfGenerator.generarListaPrecios(cliente, productos);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de lista de precios generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Lista de precios generada optimizada en ${generationTime}ms - Cliente: ${cliente.nombre} - ${productos.length} productos`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Lista_Precios_${cliente.nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
        
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDF:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Error generando lista de precios optimizada: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar el PDF",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Obtener todas las cuentas de fondos
const obtenerCuentasFondos = (req, res) => {
    const query = `
        SELECT id, nombre, saldo 
        FROM cuenta_fondos 
        ORDER BY nombre ASC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener cuentas de fondos:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener cuentas de fondos' });
        }
        res.json({ success: true, data: results });
    });
};


// Facturar pedido (convierte pedido a venta)
const facturarPedido = async (req, res) => {
    const { 
        pedidoId,
        cuentaId, 
        tipoFiscal, 
        subtotalSinIva, 
        ivaTotal, 
        totalConIva,
        descuentoAplicado 
    } = req.body;

    console.log('🧾 Iniciando facturación de pedido con remitos:', pedidoId);

    // ✅ USAR beginTransaction CORRECTAMENTE según db.js
    db.beginTransaction(async (err, connection) => {
        if (err) {
            console.error('Error iniciando transacción:', err);
            return res.status(500).json({ success: false, message: 'Error iniciando transacción' });
        }

        try {
            // 1. Obtener datos del pedido
            const pedidoQuery = `SELECT * FROM pedidos WHERE id = ?`;
            const pedidoResult = await queryPromiseWithConnection(connection, pedidoQuery, [pedidoId]);
            
            if (pedidoResult.length === 0) {
                throw new Error('Pedido no encontrado');
            }
            
            const pedido = pedidoResult[0];
            console.log('📋 Pedido obtenido:', pedido.id, '-', pedido.cliente_nombre);

            // 2. Obtener productos del pedido
            const productosQuery = `SELECT * FROM pedidos_cont WHERE pedido_id = ?`;
            const productos = await queryPromiseWithConnection(connection, productosQuery, [pedidoId]);

            if (productos.length === 0) {
                throw new Error('No se encontraron productos en el pedido');
            }
            
            console.log('📦 Productos obtenidos:', productos.length, 'productos');

            // 3. Crear la venta
            const ventaQuery = `
                INSERT INTO ventas 
                (fecha, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
                 cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
                 cuenta_id, tipo_doc, tipo_f, subtotal, iva_total, total, estado, 
                 observaciones, empleado_id, empleado_nombre)
                VALUES 
                (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturada', ?, ?, ?)
            `;

            const ventaValues = [
                pedido.cliente_id,
                pedido.cliente_nombre,
                pedido.cliente_telefono,
                pedido.cliente_direccion,
                pedido.cliente_ciudad,
                pedido.cliente_provincia,
                pedido.cliente_condicion,
                pedido.cliente_cuit,
                cuentaId,
                'FACTURA',
                tipoFiscal,
                subtotalSinIva,
                ivaTotal,
                totalConIva,
                pedido.observaciones,
                pedido.empleado_id,
                pedido.empleado_nombre
            ];

            const ventaResult = await queryPromiseWithConnection(connection, ventaQuery, ventaValues);
            const ventaId = ventaResult.insertId;
            console.log('💰 Venta creada con ID:', ventaId);

            // 4. Copiar productos del pedido a la venta
            for (const producto of productos) {
                const productoVentaQuery = `
                    INSERT INTO ventas_cont 
                    (venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                await queryPromiseWithConnection(connection, productoVentaQuery, [
                    ventaId,
                    producto.producto_id,
                    producto.producto_nombre,
                    producto.producto_um,
                    producto.cantidad,
                    producto.precio,
                    producto.IVA,
                    producto.subtotal
                ]);
            }
            console.log('📦 Productos copiados a la venta');

            // 5. ✅ CREAR REMITO AUTOMÁTICAMENTE
            console.log('📋 Creando remito automáticamente...');
            
            const datosRemito = {
                venta_id: ventaId,
                cliente_id: pedido.cliente_id,
                cliente_nombre: pedido.cliente_nombre,
                cliente_condicion: pedido.cliente_condicion,
                cliente_cuit: pedido.cliente_cuit,
                cliente_telefono: pedido.cliente_telefono,
                cliente_direccion: pedido.cliente_direccion,
                cliente_ciudad: pedido.cliente_ciudad,
                cliente_provincia: pedido.cliente_provincia,
                estado: 'Generado',
                observaciones: pedido.observaciones,
                empleado_id: pedido.empleado_id,
                empleado_nombre: pedido.empleado_nombre,
            };

            const remitoId = await registrarRemitoPromiseWithConnection(connection, datosRemito);
            console.log('📋 Remito creado con ID:', remitoId);

            // 6. ✅ INSERTAR PRODUCTOS EN EL REMITO
            console.log('📦 Insertando productos en el remito...');
            
            const errorProductosRemito = await insertarProductosRemitoPromiseWithConnection(connection, remitoId, productos);
            if (errorProductosRemito) {
                throw new Error(`Error insertando productos en remito: ${errorProductosRemito.message}`);
            }
            console.log('📦 Productos del remito insertados correctamente');

            // 7. Crear movimiento de fondos (INGRESO)
            const movimientoQuery = `
                INSERT INTO movimiento_fondos 
                (cuenta_id, tipo, origen, referencia_id, monto, fecha)
                VALUES (?, 'INGRESO', ?, ?, ?, NOW())
            `;

            await queryPromiseWithConnection(connection, movimientoQuery, [
                cuentaId,
                `Facturación - ${pedido.cliente_nombre}`,
                ventaId,
                totalConIva
            ]);
            console.log('💰 Movimiento de fondos registrado');

            // 8. Actualizar saldo de la cuenta
            const actualizarSaldoQuery = `
                UPDATE cuenta_fondos 
                SET saldo = saldo + ? 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarSaldoQuery, [totalConIva, cuentaId]);
            console.log('💳 Saldo de cuenta actualizado');

            // 9. Cambiar estado del pedido a "Facturado"
            const actualizarPedidoQuery = `
                UPDATE pedidos 
                SET estado = 'Facturado' 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarPedidoQuery, [pedidoId]);
            console.log('📋 Estado del pedido actualizado a "Facturado"');

            // ✅ 10. CONFIRMAR TRANSACCIÓN - USAR CONNECTION CORRECTAMENTE
            console.log('✅ Todos los procesos completados, confirmando transacción...');
            
            await new Promise((resolve, reject) => {
                connection.commit((err) => {
                    if (err) {
                        console.error('❌ Error confirmando transacción:', err);
                        return reject(err);
                    }
                    console.log('✅ Transacción confirmada exitosamente');
                    connection.release(); // ✅ LIBERAR CONEXIÓN
                    resolve();
                });
            });

            // 11. Auditar facturación exitosa (después del commit)
            try {
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'ventas',
                    registroId: ventaId,
                    datosNuevos: {
                        id: ventaId,
                        pedido_origen: pedidoId,
                        cliente_nombre: pedido.cliente_nombre,
                        total: totalConIva,
                        tipo_fiscal: tipoFiscal,
                        cuenta_id: cuentaId
                    },
                    detallesAdicionales: `Pedido #${pedidoId} facturado como venta #${ventaId} - Cliente: ${pedido.cliente_nombre} - Total: $${totalConIva}`
                });

                // ✅ AUDITAR CREACIÓN DE REMITO
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'remitos',
                    registroId: remitoId,
                    datosNuevos: {
                        id: remitoId,
                        venta_id: ventaId,
                        pedido_origen: pedidoId,
                        cliente_nombre: pedido.cliente_nombre,
                        estado: 'Generado'
                    },
                    detallesAdicionales: `Remito #${remitoId} generado automáticamente desde facturación - Venta #${ventaId} - Cliente: ${pedido.cliente_nombre}`
                });
            } catch (auditError) {
                console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
            }

            console.log('✅ Facturación y remito completados exitosamente');
            res.json({ 
                success: true, 
                message: 'Facturación y remito completados exitosamente',
                data: {
                    ventaId,
                    remitoId,
                    pedidoId,
                    total: totalConIva,
                    productosCount: productos.length
                }
            });

        } catch (error) {
            console.error('❌ Error en facturación:', error);
            
            // ✅ ROLLBACK CON CONNECTION CORRECTAMENTE
            try {
                await new Promise((resolve, reject) => {
                    connection.rollback((rollbackErr) => {
                        if (rollbackErr) {
                            console.error('❌ Error adicional en rollback:', rollbackErr);
                        } else {
                            console.log('🔄 Rollback ejecutado correctamente');
                        }
                        connection.release(); // ✅ LIBERAR CONEXIÓN
                        resolve();
                    });
                });
            } catch (rollbackError) {
                console.error('❌ Error crítico en rollback:', rollbackError);
            }
            
            // Auditar error en facturación
            try {
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'ventas',
                    detallesAdicionales: `Error en facturación del pedido ${pedidoId}: ${error.message}`,
                    datosNuevos: req.body
                });
            } catch (auditError) {
                console.warn('⚠️ Error en auditoría de error (no crítico):', auditError.message);
            }
            
            res.status(500).json({ 
                success: false, 
                message: error.message || 'Error en el proceso de facturación' 
            });
        }
    });
};

const queryPromiseWithConnection = (connection, query, params) => {
    return new Promise((resolve, reject) => {
        connection.query(query, params, (err, results) => {
            if (err) {
                console.error('❌ Error en query:', err.message);
                console.error('📄 Query:', query);
                console.error('📋 Parámetros:', params);
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

// ✅ FUNCIÓN PARA REMITO CON CONNECTION
const registrarRemitoPromiseWithConnection = (connection, pedidoData) => {
    return new Promise((resolve, reject) => {
        const { 
            venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, 
            cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, 
            estado, observaciones, empleado_id, empleado_nombre 
        } = pedidoData;

        const registrarRemitoQuery = `
            INSERT INTO remitos
            (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, 
             cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, 
             estado, observaciones, empleado_id, empleado_nombre)
            VALUES 
            (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const remitoValues = [
            venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, 
            cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, 
            estado, observaciones, empleado_id, empleado_nombre
        ];

        connection.query(registrarRemitoQuery, remitoValues, (err, result) => {
            if (err) {
                console.error('❌ Error al insertar el remito:', err);
                return reject(err);
            }
            console.log('✅ Remito registrado con ID:', result.insertId, '- Empleado:', empleado_nombre);
            resolve(result.insertId);
        });
    });
};

// ✅ FUNCIÓN PARA PRODUCTOS REMITO CON CONNECTION
const insertarProductosRemitoPromiseWithConnection = async (connection, remitoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad) 
        VALUES (?, ?, ?, ?, ?)
    `;

    try {
        const promesasInsert = productos.map(producto => {
            const { producto_id, producto_nombre, producto_um, cantidad } = producto;
            const productoValues = [remitoId, producto_id, producto_nombre, producto_um, cantidad];

            return new Promise((resolve, reject) => {
                connection.query(insertProductoQuery, productoValues, (err, result) => {
                    if (err) {
                        console.error('❌ Error al insertar producto del remito:', err);
                        return reject(err);
                    }
                    console.log(`✅ Producto ${producto_nombre} insertado en remito`);
                    resolve(result);
                });
            });
        });

        await Promise.all(promesasInsert);
        console.log('✅ Todos los productos del remito insertados correctamente');
        return null;
    } catch (error) {
        console.error('❌ Error general insertando productos del remito:', error);
        return error;
    }
};

// ✅ MANTENER FUNCIONES ORIGINALES PARA COMPATIBILIDAD
const queryPromise = (query, params) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) {
                console.error('❌ Error en query:', err.message);
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

const registrarRemitoPromise = (pedidoData) => {
    return new Promise((resolve, reject) => {
        const { 
            venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, 
            cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, 
            estado, observaciones, empleado_id, empleado_nombre 
        } = pedidoData;

        const registrarRemitoQuery = `
            INSERT INTO remitos
            (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, 
             cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, 
             estado, observaciones, empleado_id, empleado_nombre)
            VALUES 
            (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const remitoValues = [
            venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, 
            cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, 
            estado, observaciones, empleado_id, empleado_nombre
        ];

        db.query(registrarRemitoQuery, remitoValues, (err, result) => {
            if (err) {
                console.error('❌ Error al insertar el remito:', err);
                return reject(err);
            }
            console.log('✅ Remito registrado con ID:', result.insertId, '- Empleado:', empleado_nombre);
            resolve(result.insertId);
        });
    });
};

const insertarProductosRemitoPromise = async (remitoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad) 
        VALUES (?, ?, ?, ?, ?)
    `;

    try {
        const promesasInsert = productos.map(producto => {
            const { producto_id, producto_nombre, producto_um, cantidad } = producto;
            const productoValues = [remitoId, producto_id, producto_nombre, producto_um, cantidad];

            return new Promise((resolve, reject) => {
                db.query(insertProductoQuery, productoValues, (err, result) => {
                    if (err) {
                        console.error('❌ Error al insertar producto del remito:', err);
                        return reject(err);
                    }
                    console.log(`✅ Producto ${producto_nombre} insertado en remito`);
                    resolve(result);
                });
            });
        });

        await Promise.all(promesasInsert);
        console.log('✅ Todos los productos del remito insertados correctamente');
        return null;
    } catch (error) {
        console.error('❌ Error general insertando productos del remito:', error);
        return error;
    }
};

// Obtener historial de movimientos de una cuenta (sin cambios)
const obtenerMovimientosCuenta = (req, res) => {
    const cuentaId = req.params.cuentaId;
    
    const query = `
        SELECT 
            mf.id,
            mf.tipo,
            mf.origen,
            mf.referencia_id,
            mf.monto,
            DATE_FORMAT(mf.fecha, '%d-%m-%Y %H:%i:%s') AS fecha,
            cf.nombre as cuenta_nombre
        FROM movimiento_fondos mf
        INNER JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id
        WHERE mf.cuenta_id = ?
        ORDER BY mf.fecha DESC
        LIMIT 50
    `;
    
    db.query(query, [cuentaId], (err, results) => {
        if (err) {
            console.error('Error al obtener movimientos:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener movimientos' });
        }
        res.json({ success: true, data: results });
    });
};



module.exports = {
    obtenerVentas,
    filtrarVenta,
    filtrarProductosVenta,
    generarPdfListaPrecio,
    generarPdfFactura,
    generarPdfFacturasMultiples,
    obtenerCuentasFondos,
    facturarPedido,
    obtenerMovimientosCuenta,
    generarPdfRankingVentas
};