const db = require('./db');
const puppeteer = require("puppeteer");
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');














const obtenerVentas = (req, res) => {
    
    const query = `
        SELECT 
            id, DATE_FORMAT(fecha, '%d-%m-%Y // %H:%i:%s') AS fecha, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, subtotal, iva_total, total, estado, observaciones, empleado_id, empleado_nombre, cae_id, cae_fecha
        FROM ventas ORDER BY fecha ASC`;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener:', err);
            res.status(500).send('Error al obtener');
        } else {
            res.json(results);
        }
    });
};

const filtrarVenta = (req, res) => {
    const ventaId = req.params.ventaId;
    const query = `
        SELECT 
            *
        FROM ventas WHERE id = ? `;
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

    // Consulta SQL para obtener productos del pedido
    const query = `
        SELECT id, venta_id, producto_id, producto_nombre, producto_um, cantidad,  precio, iva, subtotal FROM ventas_cont
        WHERE venta_id = ?
    `;
    
    db.query(query, [ventaId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos del pedido:', err);
            return res.status(500).json({ error: 'Error al obtener productos del pedido' });
        }
        res.json(results);
    });
};



const generarPdfFactura = async (req, res) => {
    const { venta, productos } = req.body;

    if (!venta || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    // Ruta de la plantilla HTML
    const templatePath = path.join(__dirname, "../resources/documents/factura.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        // Leer y reemplazar la plantilla HTML
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


        // Iniciar Puppeteer y generar PDF
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" }); // ⬅️ Espera hasta que la página cargue completamente
        const pdfBuffer = await page.pdf({ format: "A4" });

        await browser.close();

        // Configurar la respuesta
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Factura_${venta.cliente_nombre}.pdf"`);

        
        res.end(pdfBuffer); // ⬅️ Usa res.end() en lugar de res.send() para archivos binarios
    } catch (error) {
        console.error("Error generando PDF:", error);
        res.status(500).json({ error: "Error al generar el PDF" });
    }
};

const generarPdfFacturasMultiples = async (req, res) => {
    const { ventasIds } = req.body;
    const db = require('./db'); // Ajusta esto a tu ruta de conexión
    
    if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de venta válido" });
    }

    try {
        // Array para almacenar todos los buffers de PDFs
        const pdfBuffers = [];
        
        // Iniciar Puppeteer
        const browser = await puppeteer.launch({ headless: "new" });

        // Procesar cada venta secuencialmente
        for (let i = 0; i < ventasIds.length; i++) {
            const ventaId = ventasIds[i];
            
            // Obtener información de la venta utilizando promisify para el enfoque de callback
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
                
                // Generar el PDF para esta venta (usando tu código existente)
                const templatePath = path.join(__dirname, "../resources/documents/factura.html");
                
                // ... resto del código del template igual que en tu función generarPdfFactura
                
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

                // Generar PDF individual para esta venta
                const page = await browser.newPage();
                await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });
                const pdfBuffer = await page.pdf({ format: "A4" });
                await page.close();
                
                // Almacenar el buffer del PDF
                pdfBuffers.push(pdfBuffer);
            } catch (error) {
                console.error(`Error procesando venta ID ${ventaId}:`, error);
                // Continúa con las siguientes ventas
            }
        }
        
        await browser.close();

        if (pdfBuffers.length === 0) {
            return res.status(404).json({ error: "No se pudieron generar PDFs para las ventas seleccionadas" });
        }

        // Combinar todos los PDFs usando pdf-lib
        const { PDFDocument } = require('pdf-lib');
        const mergedPdf = await PDFDocument.create();
        
        for (const pdfBuffer of pdfBuffers) {
            const pdf = await PDFDocument.load(pdfBuffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
        
        const mergedPdfBuffer = await mergedPdf.save();

        // Configurar la respuesta
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Facturas_Multiples.pdf"`);
        res.end(Buffer.from(mergedPdfBuffer));
        
    } catch (error) {
        console.error("Error generando PDFs múltiples:", error);
        res.status(500).json({ error: "Error al generar los PDFs múltiples" });
    }
};


const generarPdfListaPrecio = async (req, res) => {
    const { cliente, productos } = req.body;

    if (!cliente || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    // Ruta de la plantilla HTML
    const templatePath = path.join(__dirname, "../resources/documents/lista_precio.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }

    try {
        // Leer y reemplazar la plantilla HTML
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

        // Iniciar Puppeteer y generar PDF
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" }); // ⬅️ Espera hasta que la página cargue completamente
        const pdfBuffer = await page.pdf({ format: "A4" });

        await browser.close();

        // Configurar la respuesta
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Lista_Precios_${cliente.nombre}.pdf"`);
        
        res.end(pdfBuffer); // ⬅️ Usa res.end() en lugar de res.send() para archivos binarios
    } catch (error) {
        console.error("Error generando PDF:", error);
        res.status(500).json({ error: "Error al generar el PDF" });
    }
};



const comprobantesPath = path.join(__dirname, "../storage/comprobantes");

// Si no existe la carpeta, la crea
if (!fs.existsSync(comprobantesPath)) {
    fs.mkdirSync(comprobantesPath, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, comprobantesPath);
    },
    filename: (req, file, cb) => {
        const ventaId = req.params.ventaId;
        const extension = path.extname(file.originalname);
        cb(null, `VENTA-${ventaId}${extension}`);
    },
});

const upload = multer({ storage }).single("comprobante");







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

    console.log('🧾 Iniciando facturación de pedido:', pedidoId);

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

            // 2. Obtener productos del pedido
            const productosQuery = `SELECT * FROM pedidos_cont WHERE pedido_id = ?`;
            const productos = await queryPromise(productosQuery, [pedidoId]);

            if (productos.length === 0) {
                throw new Error('No se encontraron productos en el pedido');
            }

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
                'FACTURA', // tipo_doc
                tipoFiscal, // tipo_f (A, B, C)
                subtotalSinIva,
                ivaTotal,
                totalConIva,
                `Facturado desde pedido #${pedidoId}${descuentoAplicado ? ` - Descuento aplicado: $${descuentoAplicado.descuentoCalculado.toFixed(2)}` : ''}`,
                pedido.empleado_id,
                pedido.empleado_nombre
            ];

            const ventaResult = await queryPromise(ventaQuery, ventaValues);
            const ventaId = ventaResult.insertId;

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

            // 5. Crear movimiento de fondos (INGRESO)
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

            // 6. Actualizar saldo de la cuenta
            const actualizarSaldoQuery = `
                UPDATE cuenta_fondos 
                SET saldo = saldo + ? 
                WHERE id = ?
            `;

            await queryPromise(actualizarSaldoQuery, [totalConIva, cuentaId]);

            // 7. Cambiar estado del pedido a "Facturado"
            const actualizarPedidoQuery = `
                UPDATE pedidos 
                SET estado = 'Facturado' 
                WHERE id = ?
            `;

            await queryPromise(actualizarPedidoQuery, [pedidoId]);

            // Confirmar transacción
            db.commit((err) => {
                if (err) {
                    console.error('Error confirmando transacción:', err);
                    return db.rollback(() => {
                        res.status(500).json({ success: false, message: 'Error confirmando transacción' });
                    });
                }

                console.log('✅ Facturación completada exitosamente');
                res.json({ 
                    success: true, 
                    message: 'Facturación completada exitosamente',
                    data: {
                        ventaId,
                        pedidoId,
                        total: totalConIva
                    }
                });
            });

        } catch (error) {
            console.error('Error en facturación:', error);
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
