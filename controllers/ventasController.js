const db = require('./db');
const puppeteer = require("puppeteer");
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');
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

const generarPdfFactura = async (req, res) => {
    const { venta, productos } = req.body;

    if (!venta || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    const templatePath = path.join(__dirname, "../resources/documents/factura.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        let htmlTemplate = fs.readFileSync(templatePath, "utf8");

        htmlTemplate = htmlTemplate
            .replace("{{fecha}}", venta.fecha)
            .replace("{{cliente_nombre}}", venta.cliente_nombre)
            .replace("{{cliente_cuit}}", venta.cliente_cuit || "No informado")
            .replace("{{cliente_cativa}}", venta.cliente_condicion || "No informado");

        const itemsHTML = productos
            .map(
                (producto) => `
                <tr>
                    <td>${producto.producto_id}</td>
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um}</td>
                    <td>${producto.cantidad}</td>
                    <td style="text-align: right;">$${producto.precio}</td>
                    <td style="text-align: right;">$${producto.iva}</td>
                    <td style="text-align: right;">$${producto.subtotal}</td>
                </tr>`
            )
            .join("");

        htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);
        
        const subtotalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0).toFixed(2);
        const ivaPdf = productos.reduce((acc, item) => acc + (parseFloat(item.iva) || 0), 0).toFixed(2);
        const totalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0) + (parseFloat(item.iva) || 0), 0).toFixed(2);

        htmlTemplate = htmlTemplate.replace("{{subtotal}}", subtotalPdf);
        htmlTemplate = htmlTemplate.replace("{{iva}}", ivaPdf);
        htmlTemplate = htmlTemplate.replace("{{total}}", totalPdf);

        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });
        const pdfBuffer = await page.pdf({ format: "A4" });

        await browser.close();

        // Auditar generación de PDF
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            registroId: venta.id,
            detallesAdicionales: `PDF de factura generado para cliente: ${venta.cliente_nombre} - Total: $${venta.total}`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Factura_${venta.cliente_nombre}.pdf"`);
        
        res.end(pdfBuffer);
    } catch (error) {
        console.error("Error generando PDF:", error);
        
        // Auditar error en generación de PDF
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            registroId: venta.id,
            detallesAdicionales: `Error generando PDF de factura: ${error.message}`
        });
        
        res.status(500).json({ error: "Error al generar el PDF" });
    }
};


const generarPdfFacturasMultiples = async (req, res) => {
    const { ventasIds } = req.body;
    
    if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de venta válido" });
    }

    try {
        const pdfBuffers = [];
        const browser = await puppeteer.launch({ headless: "new" });

        for (let i = 0; i < ventasIds.length; i++) {
            const ventaId = ventasIds[i];
            
            const getVenta = () => {
                return new Promise((resolve, reject) => {
                    db.query('SELECT * FROM ventas WHERE id = ?', [ventaId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
            };
            
            const getProductos = () => {
                return new Promise((resolve, reject) => {
                    db.query('SELECT * FROM ventas_cont WHERE venta_id = ?', [ventaId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
            };
            
            try {
                const ventaRows = await getVenta();
                
                if (ventaRows.length === 0) {
                    console.warn(`Venta con ID ${ventaId} no encontrada, continuando con las siguientes`);
                    continue;
                }
                
                const venta = ventaRows[0];
                const productos = await getProductos();
                
                if (productos.length === 0) {
                    console.warn(`No se encontraron productos para la venta con ID ${ventaId}, continuando`);
                    continue;
                }
                
                const templatePath = path.join(__dirname, "../resources/documents/factura.html");
                let htmlTemplate = fs.readFileSync(templatePath, "utf8");
                const fechaFormateada = formatearFecha(venta.fecha);
                htmlTemplate = htmlTemplate
                    .replace("{{fecha}}", fechaFormateada)
                    .replace("{{cliente_nombre}}", venta.cliente_nombre)
                    .replace("{{cliente_cuit}}", venta.cliente_cuit || "No informado")
                    .replace("{{cliente_cativa}}", venta.cliente_condicion || "No informado");

                const itemsHTML = productos
                    .map(
                        (producto) => `
                        <tr>
                            <td>${producto.producto_id}</td>
                            <td>${producto.producto_nombre}</td>
                            <td>${producto.producto_um}</td>
                            <td>${producto.cantidad}</td>
                            <td style="text-align: right;">$${producto.precio}</td>
                            <td style="text-align: right;">$${producto.IVA}</td>
                            <td style="text-align: right;">$${producto.subtotal}</td>
                        </tr>`
                    )
                    .join("");

                htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);
                
                const subtotalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0).toFixed(2);
                const ivaPdf = productos.reduce((acc, item) => acc + (parseFloat(item.IVA) || 0), 0).toFixed(2);
                const totalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0) + (parseFloat(item.iva) || 0), 0).toFixed(2);

                htmlTemplate = htmlTemplate.replace("{{subtotal}}", venta.subtotal || subtotalPdf);
                htmlTemplate = htmlTemplate.replace("{{iva}}", venta.ivatotal || ivaPdf);
                htmlTemplate = htmlTemplate.replace("{{total}}", venta.total || totalPdf);

                const page = await browser.newPage();
                await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });
                const pdfBuffer = await page.pdf({ format: "A4" });
                await page.close();
                
                pdfBuffers.push(pdfBuffer);
            } catch (error) {
                console.error(`Error procesando venta ID ${ventaId}:`, error);
            }
        }
        
        await browser.close();

        if (pdfBuffers.length === 0) {
            return res.status(404).json({ error: "No se pudieron generar PDFs para las ventas seleccionadas" });
        }

        // Combinar todos los PDFs
        const { PDFDocument } = require('pdf-lib');
        const mergedPdf = await PDFDocument.create();
        
        for (const pdfBuffer of pdfBuffers) {
            const pdf = await PDFDocument.load(pdfBuffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
        
        const mergedPdfBuffer = await mergedPdf.save();

        // Auditar generación de PDFs múltiples
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `PDFs múltiples de facturas generados - ${ventasIds.length} ventas solicitadas, ${pdfBuffers.length} generadas`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Facturas_Multiples.pdf"`);
        res.end(Buffer.from(mergedPdfBuffer));
        
    } catch (error) {
        console.error("Error generando PDFs múltiples:", error);
        
        // Auditar error en generación de PDFs múltiples
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Error generando PDFs múltiples: ${error.message}`
        });
        
        res.status(500).json({ error: "Error al generar los PDFs múltiples" });
    }
};

const generarPdfListaPrecio = async (req, res) => {
    const { cliente, productos } = req.body;

    if (!cliente || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    const templatePath = path.join(__dirname, "../resources/documents/lista_precio.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        let htmlTemplate = fs.readFileSync(templatePath, "utf8");

        htmlTemplate = htmlTemplate
            .replace("{{fecha}}", new Date().toLocaleDateString())
            .replace("{{cliente_nombre}}", cliente.nombre)
            .replace("{{cliente_cuit}}", cliente.cuit || "No informado")
            .replace("{{cliente_cativa}}", cliente.condicion_iva || "No informado");

        const itemsHTML = productos
            .map(
                (producto) => `
                <tr>
                    <td>${producto.id}</td>
                    <td>${producto.nombre}</td>
                    <td>${producto.unidad_medida}</td>
                    <td>${producto.cantidad}</td>
                    <td style="text-align: right;">$${producto.precio}</td>
                    <td style="text-align: right;">$${producto.iva}</td>
                    <td style="text-align: right;">$${producto.subtotal}</td>
                </tr>`
            )
            .join("");

        htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);

        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });
        const pdfBuffer = await page.pdf({ format: "A4" });

        await browser.close();

        // Auditar generación de lista de precios
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Lista de precios generada para cliente: ${cliente.nombre} - ${productos.length} productos`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Lista_Precios_${cliente.nombre}.pdf"`);
        
        res.end(pdfBuffer);
    } catch (error) {
        console.error("Error generando PDF:", error);
        
        // Auditar error en generación de lista de precios
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Error generando lista de precios: ${error.message}`
        });
        
        res.status(500).json({ error: "Error al generar el PDF" });
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

    // Comenzar transacción
    db.beginTransaction(async (err) => {
        if (err) {
            console.error('Error iniciando transacción:', err);
            return res.status(500).json({ success: false, message: 'Error iniciando transacción' });
        }

        try {
            // 1. Obtener datos del pedido
            const pedidoQuery = `SELECT * FROM pedidos WHERE id = ?`;
            const pedidoResult = await queryPromise(pedidoQuery, [pedidoId]);
            
            if (pedidoResult.length === 0) {
                throw new Error('Pedido no encontrado');
            }
            
            const pedido = pedidoResult[0];
            console.log('📋 Pedido obtenido:', pedido.id, '-', pedido.cliente_nombre);

            // 2. Obtener productos del pedido
            const productosQuery = `SELECT * FROM pedidos_cont WHERE pedido_id = ?`;
            const productos = await queryPromise(productosQuery, [pedidoId]);

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

            const ventaResult = await queryPromise(ventaQuery, ventaValues);
            const ventaId = ventaResult.insertId;
            console.log('💰 Venta creada con ID:', ventaId);

            // 4. Copiar productos del pedido a la venta
            for (const producto of productos) {
                const productoVentaQuery = `
                    INSERT INTO ventas_cont 
                    (venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                await queryPromise(productoVentaQuery, [
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
                estado: 'Generado', // Estado inicial del remito
                observaciones: pedido.observaciones
            };

            const remitoId = await registrarRemitoPromise(datosRemito);
            console.log('📋 Remito creado con ID:', remitoId);

            // 6. ✅ INSERTAR PRODUCTOS EN EL REMITO
            console.log('📦 Insertando productos en el remito...');
            
            const errorProductosRemito = await insertarProductosRemitoPromise(remitoId, productos);
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

            await queryPromise(movimientoQuery, [
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

            await queryPromise(actualizarSaldoQuery, [totalConIva, cuentaId]);
            console.log('💳 Saldo de cuenta actualizado');

            // 9. Cambiar estado del pedido a "Facturado"
            const actualizarPedidoQuery = `
                UPDATE pedidos 
                SET estado = 'Facturado' 
                WHERE id = ?
            `;

            await queryPromise(actualizarPedidoQuery, [pedidoId]);
            console.log('📋 Estado del pedido actualizado a "Facturado"');

            // 10. Confirmar transacción
            db.commit(async (err) => {
                if (err) {
                    console.error('Error confirmando transacción:', err);
                    return db.rollback(() => {
                        res.status(500).json({ success: false, message: 'Error confirmando transacción' });
                    });
                }

                // Auditar facturación exitosa
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

                console.log('✅ Facturación y remito completados exitosamente');
                res.json({ 
                    success: true, 
                    message: 'Facturación y remito completados exitosamente',
                    data: {
                        ventaId,
                        remitoId, // ✅ INCLUIR ID DEL REMITO EN LA RESPUESTA
                        pedidoId,
                        total: totalConIva,
                        productosCount: productos.length
                    }
                });
            });

        } catch (error) {
            console.error('❌ Error en facturación:', error);
            
            // Auditar error en facturación
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'ventas',
                detallesAdicionales: `Error en facturación del pedido ${pedidoId}: ${error.message}`,
                datosNuevos: req.body
            });
            
            db.rollback(() => {
                res.status(500).json({ 
                    success: false, 
                    message: error.message || 'Error en el proceso de facturación' 
                });
            });
        }
    });
};

// Función helper para promisificar queries de MySQL
const queryPromise = (query, params) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};


// Obtener historial de movimientos de una cuenta
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


const registrarRemitoPromise = (pedidoData) => {
    return new Promise((resolve, reject) => {
        const { venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones} = pedidoData;

        const registrarRemitoQuery = `
            INSERT INTO remitos
            (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones)
            VALUES 
            (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const remitoValues = [venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones];

        db.query(registrarRemitoQuery, remitoValues, (err, result) => {
            if (err) {
                console.error('Error al insertar el remito:', err);
                return reject(err);
            }
            resolve(result.insertId); // Devuelve el ID del remito recién insertado
        });
    });
};

const insertarProductosRemitoPromise = async (remitoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad) 
        VALUES (?, ?, ?, ?, ?)
    `;

    try {
        await Promise.all(productos.map(producto => {
            const { producto_id, producto_nombre, producto_um, cantidad } = producto;
            const productoValues = [remitoId, producto_id, producto_nombre, producto_um, cantidad];

            return new Promise((resolve, reject) => {
                db.query(insertProductoQuery, productoValues, (err, result) => {
                    if (err) {
                        console.error('Error al insertar el producto del remito:', err);
                        return reject(err);
                    }
                    resolve(result);
                });
            });
        }));
        return null;
    } catch (error) {
        return error;
    }
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
    obtenerMovimientosCuenta
};