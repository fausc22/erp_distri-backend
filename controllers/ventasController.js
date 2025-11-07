const db = require('./db');

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');

const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const pdfGenerator = require('../utils/pdfGenerator');

const verificarArchivoExiste = (comprobantePath) => {
  if (!comprobantePath) return false;
  
  try {
    const rutaCompleta = path.join(__dirname, '..', comprobantePath);
    return fs.existsSync(rutaCompleta);
  } catch (error) {
    console.error('Error verificando archivo:', error);
    return false;
  }
};




const obtenerSiguienteNumeroFactura = async (connection, tipoFiscal, puntoVenta = null) => {
    try {
        const pv = puntoVenta || process.env.DEFAULT_PUNTO_VENTA;
        const puntoVentaFormateado = String(pv).padStart(4, '0');
        
        console.log(`🔢 Obteniendo siguiente número para Factura ${tipoFiscal} - Punto de Venta: ${puntoVentaFormateado}`);
        
        // ✅ 1. VERIFICAR SI EXISTE
        const checkQuery = `
            SELECT ultimo_numero 
            FROM control_numeracion_facturas 
            WHERE punto_venta = ? AND tipo_factura = ?
        `;
        
        let checkResults = await queryPromiseWithConnection(connection, checkQuery, [puntoVentaFormateado, tipoFiscal]);
        
        console.log(`🔍 Número actual en BD:`, checkResults[0]?.ultimo_numero || 'No existe');
        
        // ✅ 2. SI NO EXISTE, CREARLO
        if (!checkResults || checkResults.length === 0) {
            console.log(`⚠️ Creando control para ${tipoFiscal} en PV ${puntoVentaFormateado}...`);
            
            const insertQuery = `
                INSERT INTO control_numeracion_facturas (punto_venta, tipo_factura, ultimo_numero)
                VALUES (?, ?, 0)
            `;
            
            await queryPromiseWithConnection(connection, insertQuery, [puntoVentaFormateado, tipoFiscal]);
            console.log(`✅ Control creado - Empezará en 1`);
        }
        
        // ✅ 3. INCREMENTAR
        const updateQuery = `
            UPDATE control_numeracion_facturas 
            SET ultimo_numero = ultimo_numero + 1
            WHERE punto_venta = ? AND tipo_factura = ?
        `;
        
        await queryPromiseWithConnection(connection, updateQuery, [puntoVentaFormateado, tipoFiscal]);
        console.log(`✅ Número incrementado en BD`);
        
        // ✅ 4. OBTENER EL NUEVO NÚMERO
        const selectQuery = `
            SELECT ultimo_numero 
            FROM control_numeracion_facturas 
            WHERE punto_venta = ? AND tipo_factura = ?
            LIMIT 1
        `;
        
        const results = await queryPromiseWithConnection(connection, selectQuery, [puntoVentaFormateado, tipoFiscal]);
        
        if (!results || !results[0] || typeof results[0].ultimo_numero === 'undefined') {
            throw new Error(`No se pudo obtener el número de factura para tipo ${tipoFiscal} en PV ${puntoVentaFormateado}`);
        }
        
        const numeroFactura = results[0].ultimo_numero;
        
        // ✅ FORMATO CON TIPO DE COMPROBANTE: "A 0004-00000001"
        const numeroCompleto = `${tipoFiscal} ${puntoVentaFormateado}-${String(numeroFactura).padStart(8, '0')}`;
        
        console.log(`✅ Número asignado: ${numeroCompleto}`);
        
        return {
            numeroFactura,
            numeroCompleto,
            puntoVenta: puntoVentaFormateado
        };
        
    } catch (error) {
        console.error('❌ Error obteniendo número de factura:', error);
        throw error;
    }
};






    const obtenerVentas = (req, res) => {
        const query = `
            SELECT 
                id, fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, 
                cliente_direccion, cliente_ciudad, cliente_provincia, 
                cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, 
                subtotal, iva_total, total, estado, observaciones, 
                empleado_id, empleado_nombre, 
                cae_id, cae_fecha, cae_resultado, cae_observaciones, cae_solicitud_fecha,
                comprobante_path
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
        const query = `
            SELECT 
                id, fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, 
                cliente_direccion, cliente_ciudad, cliente_provincia, 
                cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, 
                subtotal, iva_total, total, estado, observaciones, 
                empleado_id, empleado_nombre, 
                cae_id, cae_fecha, cae_resultado, cae_observaciones, cae_solicitud_fecha,
                comprobante_path
            FROM ventas 
            WHERE id = ?`;
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
        SELECT id, venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal, descuento_porcentaje FROM ventas_cont
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

            // ✅ PROCESAR CADA VENTA Y USAR LA PLANTILLA CORRECTA SEGÚN tipo_f
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
                    
                    const venta = ventaRows[0];
                    const tipoFiscal = (venta.tipo_f || '').toString().trim().toUpperCase();
                    
                    const productos = await new Promise((resolve, reject) => {
                        db.query('SELECT *, descuento_porcentaje FROM ventas_cont WHERE venta_id = ?', [ventaId], (err, results) => {
                            if (err) return reject(err);
                            resolve(results);
                        });
                    });
                    
                    if (productos.length === 0) {
                        console.warn(`No se encontraron productos para la venta ${ventaId}, continuando`);
                        continue;
                    }
                    
                    // ✅ DETERMINAR QUÉ PLANTILLA USAR: ARCA (A/B) o GENÉRICA (C)
                    let htmlTemplate;
                    let templateName;
                    
                    if (tipoFiscal === 'A' || tipoFiscal === 'B') {
                        // ✅ VERIFICAR SI TIENE CAE APROBADO
                        const tieneCAEAprobado = venta.cae_id && 
                                                venta.cae_resultado && 
                                                venta.cae_resultado.toString().trim().toUpperCase() === 'A';

                        if (tieneCAEAprobado) {
                            templateName = 'factura_arca.html';
                            console.log(`📋 Usando plantilla ARCA para venta ${ventaId} tipo ${tipoFiscal}`);
                        } else {
                            templateName = 'factura.html';
                            console.warn(`⚠️ Venta ${ventaId} tipo ${tipoFiscal} sin CAE, usando genérica`);
                        }
                    } else {
                        templateName = 'factura.html';
                        console.log(`📋 Usando plantilla genérica para venta ${ventaId} tipo ${tipoFiscal}`);
                    }

                    const templatePath = path.join(pdfGenerator.templatesPath, templateName);
                    htmlTemplate = fs.readFileSync(templatePath, 'utf8');
                    
                    // ✅ PROCESAR SEGÚN TIPO DE PLANTILLA
                    if (templateName === 'factura_arca.html') {
                        // ✅ FACTURA ARCA (A/B) - SIN IVA EN ITEMS
                        const qrBase64 = await pdfGenerator.generarQRDesdeARCA(venta);
                        const logoARCABase64 = pdfGenerator.obtenerLogoARCABase64();
                        const fechaFormateada = pdfGenerator.formatearFecha(venta.fecha);
                        const fechaVencimientoCAE = pdfGenerator.formatearFecha(venta.cae_fecha);
                        
                        htmlTemplate = htmlTemplate
                            .replace(/{{tipo_comprobante}}/g, tipoFiscal)
                            .replace(/{{punto_venta}}/g, String(1).padStart(4, '0'))
                            .replace(/{{numero_comprobante}}/g, String(venta.id).padStart(8, '0'))
                            .replace(/{{fecha}}/g, fechaFormateada)
                            .replace(/{{cuit_emisor}}/g, process.env.AFIP_CUIT || '30714525030')
                            .replace(/{{ingresos_brutos}}/g, process.env.IIBB || '251491/4')
                            .replace(/{{fecha_inicio_actividades}}/g, process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016')
                            .replace(/{{telefono}}/g, process.env.EMPRESA_TELEFONO || '')
                            .replace(/{{email}}/g, process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com')
                            .replace(/{{cliente_cuit}}/g, venta.cliente_cuit || 'No informado')
                            .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
                            .replace(/{{cliente_condicion}}/g, venta.cliente_condicion || 'No informado')
                            .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado');

                        // ✅ ITEMS SIN IVA
                        const itemsHTML = productos.map(producto => {
                            const cantidad = parseFloat(producto.cantidad) || 0;
                            const subtotal = parseFloat(producto.subtotal) || 0;
                            const precioUnitarioSinIva = cantidad > 0 ? (subtotal / cantidad) : 0;
                            const cantidadFormateada = pdfGenerator.formatearCantidad(cantidad);

                            return `
                                <tr>
                                    <td style="text-align: center;">${cantidadFormateada}</td>
                                    <td>${producto.producto_nombre} - ${producto.producto_um}</td>
                                    <td style="text-align: center;">21.00</td>
                                    <td style="text-align: right;">${precioUnitarioSinIva.toFixed(2)}</td>
                                    <td style="text-align: right;">${subtotal.toFixed(2)}</td>
                                </tr>
                            `;
                        }).join('');

                        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

                        // ✅ TOTALES: SUBTOTAL + IVA 21%
                        const subtotal = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
                        const ivaTotal = subtotal * 0.21;
                        const total = subtotal + ivaTotal;

                        htmlTemplate = htmlTemplate
                            .replace(/{{subtotal}}/g, subtotal.toFixed(2))
                            .replace(/{{iva_total}}/g, ivaTotal.toFixed(2))
                            .replace(/{{total}}/g, total.toFixed(2))
                            .replace(/{{qr_base64}}/g, qrBase64)
                            .replace(/{{logo_arca}}/g, logoARCABase64)
                            .replace(/{{cae}}/g, venta.cae_id)
                            .replace(/{{cae_vencimiento}}/g, fechaVencimientoCAE);
                        
                    } else {
                        // ✅ FACTURA GENÉRICA (C) - CON IVA INCLUIDO, SIN $
                        const fechaFormateada = pdfGenerator.formatearFecha(venta.fecha);
                        
                        htmlTemplate = htmlTemplate
                            .replace(/{{fecha}}/g, fechaFormateada)
                            .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
                            .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado');

                        const itemsHTML = productos.map(producto => {
                            const cantidad = parseFloat(producto.cantidad) || 0;
                            const subtotal = parseFloat(producto.subtotal) || 0;
                            const iva = parseFloat(producto.iva || producto.IVA) || 0;
                            const total = subtotal + iva;
                            const productoPrecioIva = cantidad > 0 ? (total / cantidad) : 0;
                            const cantidadFormateada = pdfGenerator.formatearCantidad(cantidad);

                            return `
                                <tr>
                                    <td>${producto.producto_id}</td>
                                    <td>${producto.producto_nombre}</td>
                                    <td>${producto.producto_um}</td>
                                    <td style="text-align: center;">${cantidadFormateada}</td>
                                    <td style="text-align: right;">${productoPrecioIva.toFixed(2)}</td>
                                    <td style="text-align: right;">${total.toFixed(2)}</td>
                                </tr>
                            `;
                        }).join('');
                        
                        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
                        
                        const totalFactura = productos.reduce((acc, item) => {
                            const subtotal = parseFloat(item.subtotal) || 0;
                            const iva = parseFloat(item.iva || item.IVA) || 0;
                            return acc + subtotal + iva;
                        }, 0);

                        htmlTemplate = htmlTemplate.replace(/{{total}}/g, venta.total || totalFactura.toFixed(2));
                    }
                    
                    htmlSections.push(htmlTemplate);
                    
                } catch (error) {
                    console.error(`Error procesando venta ID ${ventaId}:`, error);
                }
            }
            
            if (htmlSections.length === 0) {
                return res.status(404).json({ error: "No se pudieron obtener datos para las ventas seleccionadas" });
            }

            // ✅ COMBINAR TODAS LAS SECCIONES CON SALTOS DE PÁGINA
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
            console.log('📄 Generando PDF de lista de precios...');
            console.log('📋 Cliente:', cliente.nombre);
            console.log('📦 Productos:', productos.length);
            
            const startTime = Date.now();

            // ✅ Validar que los productos tengan los campos necesarios
            const productosValidados = productos.map(p => ({
                id: p.id,
                nombre: p.nombre,
                unidad_medida: p.unidad_medida || 'Unidad',
                cantidad: parseFloat(p.cantidad) || 1,
                precio_venta: parseFloat(p.precio_venta) || 0, // Ya viene con IVA incluido
                subtotal: parseFloat(p.subtotal) || 0 // Ya viene con IVA incluido
            }));

            // ✅ Log para debugging
            console.log('📊 Ejemplo de producto:', productosValidados[0]);

            const pdfBuffer = await pdfGenerator.generarListaPrecios(cliente, productosValidados);

            const generationTime = Date.now() - startTime;
            console.log(`✅ PDF de lista de precios generado en ${generationTime}ms`);

            await auditarOperacion(req, {
                accion: 'EXPORT',
                tabla: 'productos',
                detallesAdicionales: `Lista de precios generada en ${generationTime}ms - Cliente: ${cliente.nombre} - ${productos.length} productos`
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="Lista_Precios_${cliente.nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
            
            res.end(pdfBuffer);
            console.log('✅ PDF de lista de precios enviado exitosamente');
            
        } catch (error) {
            console.error("❌ Error generando PDF de lista de precios:", error);
            
            await auditarOperacion(req, {
                accion: 'EXPORT',
                tabla: 'productos',
                detallesAdicionales: `Error generando lista de precios: ${error.message}`
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
        tipoFiscal,  // 'A', 'B' o 'X'
        subtotalSinIva, 
        ivaTotal, 
        totalConIva,
        descuentoAplicado 
    } = req.body;

    console.log(`🧾 Iniciando facturación de pedido ${pedidoId} - Tipo: ${tipoFiscal}`);

    // ✅ VALIDAR TIPO FISCAL
    if (!['A', 'B', 'X'].includes(tipoFiscal)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tipo fiscal inválido. Debe ser A, B o X' 
        });
    }

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

            // ✅ 3. OBTENER SIGUIENTE NÚMERO DE FACTURA
            const { numeroFactura, numeroCompleto, puntoVenta } = await obtenerSiguienteNumeroFactura(
                connection, 
                tipoFiscal
            );
            
            console.log(`📄 Número de factura asignado: ${numeroCompleto}`);

            // 4. Crear la venta CON NÚMERO DE FACTURA
            const ventaQuery = `
                INSERT INTO ventas 
                (fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
                 cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
                 cuenta_id, tipo_doc, tipo_f, subtotal, iva_total, total, estado, 
                 observaciones, empleado_id, empleado_nombre)
                VALUES 
                (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturada', ?, ?, ?)
            `;

            const ventaValues = [
                numeroCompleto,  // ✅ NUEVO: número_factura
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
            console.log('💰 Venta creada con ID:', ventaId, '- Número:', numeroCompleto);

            // 5. Copiar productos del pedido a la venta
            for (const producto of productos) {
                const productoVentaQuery = `
                    INSERT INTO ventas_cont 
                    (venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal, descuento_porcentaje)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                await queryPromiseWithConnection(connection, productoVentaQuery, [
                    ventaId,
                    producto.producto_id,
                    producto.producto_nombre,
                    producto.producto_um,
                    parseFloat(producto.cantidad),
                    producto.precio,
                    producto.IVA,
                    producto.subtotal,
                    producto.descuento_porcentaje || 0
                ]);
            }
            console.log('📦 Productos copiados a la venta');

            // ✅ 6. SI ES FACTURA A o B → SOLICITAR CAE A ARCA
            let caeData = null;
            if (tipoFiscal === 'A' || tipoFiscal === 'B') {
                console.log(`📡 Solicitando CAE para Factura ${tipoFiscal}...`);
                
                try {
                    // Aquí llamarías al microservicio ARCA
                    // Por ahora lo dejamos preparado
                    console.log('⚠️ Integración ARCA pendiente - CAE no solicitado');
                    
                    // TODO: Implementar llamada a ARCA
                    // caeData = await solicitarCAEARCA(ventaId, tipoFiscal);
                    
                } catch (arcaError) {
                    console.error('❌ Error solicitando CAE:', arcaError);
                    // Decidir si hacer rollback o continuar
                    // Por ahora continuamos sin CAE
                }
            } else {
                console.log('📝 Factura X (en negro) - No requiere CAE');
            }

            // 7. Crear remito automáticamente
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

            // 8. Insertar productos en el remito
            console.log('📦 Insertando productos en el remito...');
            
            const errorProductosRemito = await insertarProductosRemitoPromiseWithConnection(connection, remitoId, productos);
            if (errorProductosRemito) {
                throw new Error(`Error insertando productos en remito: ${errorProductosRemito.message}`);
            }
            console.log('📦 Productos del remito insertados correctamente');

            // 9. Crear movimiento de fondos (INGRESO)
            const movimientoQuery = `
                INSERT INTO movimiento_fondos 
                (cuenta_id, tipo, origen, referencia_id, monto, fecha)
                VALUES (?, 'INGRESO', ?, ?, ?, NOW())
            `;

            await queryPromiseWithConnection(connection, movimientoQuery, [
                cuentaId,
                `Facturación ${tipoFiscal} - ${pedido.cliente_nombre}`,
                ventaId,
                totalConIva
            ]);
            console.log('💰 Movimiento de fondos registrado');

            // 10. Actualizar saldo de la cuenta
            const actualizarSaldoQuery = `
                UPDATE cuenta_fondos 
                SET saldo = saldo + ? 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarSaldoQuery, [totalConIva, cuentaId]);
            console.log('💳 Saldo de cuenta actualizado');

            // 11. Cambiar estado del pedido a "Facturado"
            const actualizarPedidoQuery = `
                UPDATE pedidos 
                SET estado = 'Facturado' 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarPedidoQuery, [pedidoId]);
            console.log('📋 Estado del pedido actualizado a "Facturado"');

            // ✅ 12. CONFIRMAR TRANSACCIÓN
            console.log('✅ Confirmando transacción...');
            
            await new Promise((resolve, reject) => {
                connection.commit((err) => {
                    if (err) {
                        console.error('❌ Error confirmando transacción:', err);
                        return reject(err);
                    }
                    console.log('✅ Transacción confirmada exitosamente');
                    connection.release();
                    resolve();
                });
            });

            // 13. Auditar facturación exitosa
            try {
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'ventas',
                    registroId: ventaId,
                    datosNuevos: {
                        id: ventaId,
                        numero_factura: numeroCompleto,
                        pedido_origen: pedidoId,
                        cliente_nombre: pedido.cliente_nombre,
                        total: totalConIva,
                        tipo_fiscal: tipoFiscal,
                        cuenta_id: cuentaId,
                        cae: caeData?.cae || null
                    },
                    detallesAdicionales: `Pedido #${pedidoId} facturado como ${tipoFiscal} #${numeroCompleto} - Cliente: ${pedido.cliente_nombre} - Total: $${totalConIva}`
                });

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
                    detallesAdicionales: `Remito #${remitoId} generado desde Factura ${tipoFiscal} #${numeroCompleto} - Cliente: ${pedido.cliente_nombre}`
                });
            } catch (auditError) {
                console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
            }

            console.log('✅ Facturación completada exitosamente');
            res.json({ 
                success: true, 
                message: 'Facturación completada exitosamente',
                data: {
                    ventaId,
                    numeroFactura: numeroCompleto,
                    tipoFactura: tipoFiscal,
                    remitoId,
                    pedidoId,
                    total: totalConIva,
                    productosCount: productos.length,
                    requiereCAE: tipoFiscal !== 'X',
                    cae: caeData?.cae || null
                }
            });

        } catch (error) {
            console.error('❌ Error en facturación:', error);
            
            try {
                await new Promise((resolve, reject) => {
                    connection.rollback((rollbackErr) => {
                        if (rollbackErr) {
                            console.error('❌ Error adicional en rollback:', rollbackErr);
                        } else {
                            console.log('🔄 Rollback ejecutado correctamente');
                        }
                        connection.release();
                        resolve();
                    });
                });
            } catch (rollbackError) {
                console.error('❌ Error crítico en rollback:', rollbackError);
            }
            
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

const buscarVentasPorCliente = (req, res) => {
    const { busqueda } = req.query;
    
    if (!busqueda || busqueda.trim() === '') {
        return res.status(400).json({ 
            success: false, 
            message: 'El parámetro de búsqueda es requerido' 
        });
    }

    const query = `
        SELECT 
            id, fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, 
            cliente_direccion, cliente_ciudad, cliente_provincia, 
            cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, 
            subtotal, iva_total, total, estado, observaciones, 
            empleado_id, empleado_nombre, 
            cae_id, cae_fecha, cae_resultado, cae_observaciones, cae_solicitud_fecha,
            comprobante_path
        FROM ventas 
        WHERE cliente_nombre LIKE ?
        ORDER BY fecha DESC
    `;
    
    const searchTerm = `%${busqueda}%`;
    
    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al buscar ventas:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Error al buscar ventas' 
            });
        }
        
        res.json({ 
            success: true, 
            data: results,
            count: results.length 
        });
    });
};

const ventaDirecta = async (req, res) => {
    const { 
        // Datos del cliente
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit,
        
        // Datos de productos
        productos,
        
        // Datos de facturación
        cuentaId,
        tipoFiscal,
        subtotalSinIva,
        ivaTotal,
        totalConIva,
        descuentoAplicado,
        
        // Observaciones y empleado
        observaciones,
        empleado_id,
        empleado_nombre
    } = req.body;

    // ✅ VALIDACIÓN DE ROL - SOLO GERENTES
    if (req.user.rol !== 'GERENTE') {
        console.log(`❌ Intento de venta directa por usuario no autorizado: ${req.user.usuario} (${req.user.rol})`);
        return res.status(403).json({ 
            success: false, 
            message: 'Solo los gerentes pueden realizar ventas directas',
            code: 'INSUFFICIENT_ROLE'
        });
    }

    // ✅ VALIDACIONES BÁSICAS
    if (!cliente_id || !productos || productos.length === 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'Debe proporcionar cliente y al menos un producto' 
        });
    }

    if (!cuentaId || !tipoFiscal) {
        return res.status(400).json({ 
            success: false, 
            message: 'Debe proporcionar cuenta de destino y tipo fiscal' 
        });
    }

    console.log(`💰 [Venta Directa] Iniciando proceso - Usuario: ${empleado_nombre} - Cliente: ${cliente_nombre}`);



    
    // ✅ USAR beginTransaction CORRECTAMENTE
    db.beginTransaction(async (err, connection) => {
        if (err) {
            console.error('❌ Error iniciando transacción:', err);
            return res.status(500).json({ success: false, message: 'Error iniciando transacción' });
        }

        try {
            // ============================================
            // 1️⃣ CREAR EL PEDIDO
            // ============================================
            console.log('📋 [Venta Directa] Paso 1: Creando pedido...');
            
            const pedidoQuery = `
                INSERT INTO pedidos 
                (cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, 
                 cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, total, 
                 estado, observaciones, empleado_id, empleado_nombre)
                VALUES 
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', ?, ?, ?)
            `;

            const pedidoValues = [
                cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
                cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
                subtotalSinIva, ivaTotal, totalConIva, 
                observaciones || '', empleado_id, empleado_nombre
            ];

            const pedidoResult = await queryPromiseWithConnection(connection, pedidoQuery, pedidoValues);
            const pedidoId = pedidoResult.insertId;
            
            console.log(`✅ [Venta Directa] Pedido creado con ID: ${pedidoId}`);

            // ============================================
            // 2️⃣ INSERTAR PRODUCTOS DEL PEDIDO Y ACTUALIZAR STOCK
            // ============================================
            console.log('📦 [Venta Directa] Paso 2: Insertando productos y actualizando stock...');
            
            const insertProductoPedidoQuery = `
                INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal, descuento_porcentaje) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            for (const producto of productos) {
                const { id, nombre, unidad_medida, cantidad, precio, iva, subtotal, descuento_porcentaje } = producto;
                
                // Insertar en pedidos_cont con descuento
                await queryPromiseWithConnection(connection, insertProductoPedidoQuery, 
                    [pedidoId, id, nombre, unidad_medida, cantidad, precio, iva, subtotal, descuento_porcentaje || 0]
                );

                // Actualizar stock
                const queryVerificarStock = `SELECT id, stock_actual FROM productos WHERE id = ?`;
                const stockResults = await queryPromiseWithConnection(connection, queryVerificarStock, [id]);
                
                if (stockResults.length === 0) {
                    throw new Error(`Producto ${id} no encontrado`);
                }
                
                const stockActual = parseFloat(stockResults[0].stock_actual);
                const nuevoStock = stockActual - parseFloat(cantidad);
                
                if (nuevoStock < 0) {
                    throw new Error(`Stock insuficiente para producto ${nombre}. Stock disponible: ${stockActual}`);
                }
                
                const queryActualizarStock = `UPDATE productos SET stock_actual = ? WHERE id = ?`;
                await queryPromiseWithConnection(connection, queryActualizarStock, [nuevoStock, id]);
                
                console.log(`✅ Stock actualizado - Producto: ${nombre}, Cantidad: ${cantidad}, Nuevo stock: ${nuevoStock}`);
            }

            // ============================================
            // 3️⃣ CREAR LA VENTA
            // ============================================
            console.log('💰 [Venta Directa] Paso 3: Creando venta...');
            
            const { numeroFactura, numeroCompleto, puntoVenta } = await obtenerSiguienteNumeroFactura(
                connection, 
                tipoFiscal
            );

            console.log(`📄 Número de factura asignado: ${numeroCompleto}`);

            // Crear la venta CON NÚMERO DE FACTURA
            const ventaQuery = `
                INSERT INTO ventas 
                (fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
                cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
                cuenta_id, tipo_doc, tipo_f, subtotal, iva_total, total, estado, 
                observaciones, empleado_id, empleado_nombre)
                VALUES 
                (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FACTURA', ?, ?, ?, ?, 'Facturada', ?, ?, ?)
            `;

            const ventaValues = [
                numeroCompleto,  // ✅ número_factura
                cliente_id, cliente_nombre, cliente_telefono, cliente_direccion,
                cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit,
                cuentaId, tipoFiscal, subtotalSinIva, ivaTotal, totalConIva,
                observaciones || '', empleado_id, empleado_nombre
            ];

            const ventaResult = await queryPromiseWithConnection(connection, ventaQuery, ventaValues);
            const ventaId = ventaResult.insertId;
            
            console.log(`✅ [Venta Directa] Venta creada con ID: ${ventaId}`);

            // ============================================
            // 4️⃣ COPIAR PRODUCTOS A LA VENTA
            // ============================================
            console.log('📦 [Venta Directa] Paso 4: Copiando productos a la venta...');
            
            const insertProductoVentaQuery = `
                INSERT INTO ventas_cont 
                (venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal, descuento_porcentaje)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            for (const producto of productos) {
                await queryPromiseWithConnection(connection, insertProductoVentaQuery, [
                    ventaId,
                    producto.id,
                    producto.nombre,
                    producto.unidad_medida,
                    parseFloat(producto.cantidad),
                    producto.precio,
                    producto.iva,
                    producto.subtotal,
                    producto.descuento_porcentaje || 0
                ]);
            }
            
            console.log('✅ [Venta Directa] Productos copiados a la venta');

            // ============================================
            // 5️⃣ CREAR REMITO AUTOMÁTICAMENTE
            // ============================================
            console.log('📋 [Venta Directa] Paso 5: Creando remito...');
            
            const datosRemito = {
                venta_id: ventaId,
                cliente_id,
                cliente_nombre,
                cliente_condicion: cliente_condicion,
                cliente_cuit,
                cliente_telefono,
                cliente_direccion,
                cliente_ciudad,
                cliente_provincia,
                estado: 'Generado',
                observaciones: observaciones || '',
                empleado_id,
                empleado_nombre,
            };

            const remitoId = await registrarRemitoPromiseWithConnection(connection, datosRemito);
            console.log(`✅ [Venta Directa] Remito creado con ID: ${remitoId}`);

            // ============================================
            // 6️⃣ INSERTAR PRODUCTOS EN EL REMITO
            // ============================================
            console.log('📦 [Venta Directa] Paso 6: Insertando productos en remito...');
            
            // ✅ ADAPTAR ESTRUCTURA DE PRODUCTOS PARA EL REMITO
                const productosParaRemito = productos.map(producto => ({
                    producto_id: producto.id,
                    producto_nombre: producto.nombre,
                    producto_um: producto.unidad_medida,
                    cantidad: producto.cantidad
                }));

                const errorProductosRemito = await insertarProductosRemitoPromiseWithConnection(connection, remitoId, productosParaRemito);
                if (errorProductosRemito) {
                    throw new Error(`Error insertando productos en remito: ${errorProductosRemito.message}`);
                }
            
            console.log('✅ [Venta Directa] Productos del remito insertados');

            // ============================================
            // 7️⃣ CREAR MOVIMIENTO DE FONDOS (INGRESO)
            // ============================================
            console.log('💰 [Venta Directa] Paso 7: Registrando movimiento de fondos...');
            
            const movimientoQuery = `
                INSERT INTO movimiento_fondos 
                (cuenta_id, tipo, origen, referencia_id, monto, fecha)
                VALUES (?, 'INGRESO', ?, ?, ?, NOW())
            `;

            await queryPromiseWithConnection(connection, movimientoQuery, [
                cuentaId,
                `Venta Directa - ${cliente_nombre}`,
                ventaId,
                totalConIva
            ]);
            
            console.log('✅ [Venta Directa] Movimiento de fondos registrado');

            // ============================================
            // 8️⃣ ACTUALIZAR SALDO DE LA CUENTA
            // ============================================
            console.log('💳 [Venta Directa] Paso 8: Actualizando saldo de cuenta...');
            
            const actualizarSaldoQuery = `
                UPDATE cuenta_fondos 
                SET saldo = saldo + ? 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarSaldoQuery, [totalConIva, cuentaId]);
            console.log('✅ [Venta Directa] Saldo de cuenta actualizado');

            // ============================================
            // 9️⃣ COMMIT DE TRANSACCIÓN
            // ============================================
            console.log('✅ [Venta Directa] Paso 9: Confirmando transacción...');
            
            await new Promise((resolve, reject) => {
                connection.commit((err) => {
                    if (err) {
                        console.error('❌ Error confirmando transacción:', err);
                        return reject(err);
                    }
                    console.log('✅ [Venta Directa] Transacción confirmada exitosamente');
                    connection.release();
                    resolve();
                });
            });

            // ============================================
            // 🎉 AUDITAR ÉXITO
            // ============================================
            try {
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'venta_directa',
                    registroId: ventaId,
                    datosNuevos: {
                        pedidoId,
                        ventaId,
                        remitoId,
                        cliente_nombre,
                        total: totalConIva,
                        tipo_fiscal: tipoFiscal,
                        cuenta_id: cuentaId,
                        descuento: descuentoAplicado
                    },
                    detallesAdicionales: `Venta directa completada - Pedido #${pedidoId} → Venta #${ventaId} → Remito #${remitoId} - Cliente: ${cliente_nombre} - Total: $${totalConIva} - ${productos.length} productos`
                });
            } catch (auditError) {
                console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
            }

            console.log('🎉 [Venta Directa] Proceso completado exitosamente');
            
            // ============================================
            // ✅ RESPUESTA EXITOSA
            // ============================================
            res.json({ 
                success: true, 
                message: 'Venta directa completada exitosamente',
                data: {
                    pedidoId,
                    ventaId,
                    remitoId,
                    total: totalConIva,
                    productosCount: productos.length
                }
            });

        } catch (error) {
            console.error('❌ [Venta Directa] Error en el proceso:', error);
            
            // ============================================
            // ❌ ROLLBACK EN CASO DE ERROR
            // ============================================
            try {
                await new Promise((resolve, reject) => {
                    connection.rollback((rollbackErr) => {
                        if (rollbackErr) {
                            console.error('❌ Error adicional en rollback:', rollbackErr);
                        } else {
                            console.log('🔄 [Venta Directa] Rollback ejecutado correctamente');
                        }
                        connection.release();
                        resolve();
                    });
                });
            } catch (rollbackError) {
                console.error('❌ Error crítico en rollback:', rollbackError);
            }
            
            // Auditar error
            try {
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'venta_directa',
                    detallesAdicionales: `Error en venta directa: ${error.message}`,
                    datosNuevos: req.body
                });
            } catch (auditError) {
                console.warn('⚠️ Error en auditoría de error (no crítico):', auditError.message);
            }
            
            res.status(500).json({ 
                success: false, 
                message: error.message || 'Error en el proceso de venta directa',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
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
    generarPdfRankingVentas,
    buscarVentasPorCliente,
    ventaDirecta
};