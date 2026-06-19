const db = require('../db/legacyAdapter');

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');
const crypto = require('crypto'); // ✅ Para generar hash SHA-256
const { withTransaction } = require('../db/transaction');
const ventasRepository = require('../repositories/ventasRepository');
const remitosRepository = require('../repositories/remitosRepository');

const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const pdfGenerator = require('../utils/pdfGenerator');
const { roundFacturacion } = require('../utils/rounding');
// Nota: Las funciones de ARCA solo se usan al solicitar CAE, no al crear ventas

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




/**
 * ✅ OBTENER SIGUIENTE NÚMERO DE FACTURA (NUMERACIÓN LOCAL)
 * 
 * Esta función usa SOLO numeración local (tabla control_numeracion_facturas).
 * NO consulta ARCA en este punto.
 * 
 * La sincronización con ARCA se hace SOLO cuando se solicita el CAE,
 * en ese momento se valida y actualiza el número si es necesario.
 */
const obtenerSiguienteNumeroFactura = async (connection, tipoFiscal, puntoVenta = null) => {
    try {
        return ventasRepository.obtenerSiguienteNumeroFactura(connection, tipoFiscal, puntoVenta);
    } catch (error) {
        console.error('❌ Error obteniendo número de factura:', error);
        throw error;
    }
};






    /**
     * Obtener ventas con paginación y filtros opcionales.
     * Query params: pagina, porPagina, cliente, ciudad, fechaDesde, fechaHasta, tipoDocumento, tipoFiscal, empleado.
     * Sin filtros de fecha se devuelve todo el historial (paginado).
     * Respuesta: { success, data, total, pagina, porPagina }
     */
    const obtenerVentas = (req, res) => {
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
        const porPagina = Math.min(200, Math.max(10, parseInt(req.query.porPagina, 10) || 50));
        const offset = (pagina - 1) * porPagina;
        const cliente = (req.query.cliente || '').trim();
        const ciudad = (req.query.ciudad || '').trim();
        const fechaDesde = (req.query.fechaDesde || '').trim();
        const fechaHasta = (req.query.fechaHasta || '').trim();
        const tipoDocumento = (req.query.tipoDocumento || '').trim();
        const tipoFiscal = (req.query.tipoFiscal || '').trim();
        const empleado = (req.query.empleado || '').trim();

        const conditions = [];
        const params = [];
        if (cliente) {
            conditions.push('cliente_nombre LIKE ?');
            params.push('%' + cliente + '%');
        }
        if (ciudad) {
            conditions.push('cliente_ciudad LIKE ?');
            params.push('%' + ciudad + '%');
        }
        if (fechaDesde) {
            conditions.push('DATE(fecha) >= ?');
            params.push(fechaDesde);
        }
        if (fechaHasta) {
            conditions.push('DATE(fecha) <= ?');
            params.push(fechaHasta);
        }
        if (tipoDocumento) {
            conditions.push('tipo_doc = ?');
            params.push(tipoDocumento);
        }
        if (tipoFiscal) {
            conditions.push('tipo_f = ?');
            params.push(tipoFiscal);
        }
        if (empleado) {
            conditions.push('LOWER(TRIM(empleado_nombre)) = LOWER(?)');
            params.push(empleado);
        }
        const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const baseQuery = `FROM ventas ${whereClause}`;
        const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
        const dataQuery = `
            SELECT 
                id, fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, 
                cliente_direccion, cliente_ciudad, cliente_provincia, 
                cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, 
                subtotal, iva_total, exento, total, estado, observaciones, 
                empleado_id, empleado_nombre, 
                cae_id, cae_fecha, cae_resultado, cae_observaciones, cae_solicitud_fecha,
                comprobante_path
            ${baseQuery}
            ORDER BY fecha DESC, id DESC
            LIMIT ? OFFSET ?
        `;
        const dataParams = [...params, porPagina, offset];

        db.query(countQuery, params, (errCount, countRows) => {
            if (errCount) {
                console.error('Error al contar ventas:', errCount);
                return res.status(500).json({ success: false, message: 'Error al obtener ventas' });
            }
            const total = (countRows && countRows[0] && countRows[0].total) ? countRows[0].total : 0;
            db.query(dataQuery, dataParams, (err, results) => {
                if (err) {
                    console.error('Error al obtener ventas:', err);
                    return res.status(500).json({ success: false, message: 'Error al obtener ventas' });
                }
                res.json({
                    success: true,
                    data: results || [],
                    total: total,
                    pagina: pagina,
                    porPagina: porPagina
                });
            });
        });
    };

    const filtrarVenta = (req, res) => {
        const ventaId = req.params.ventaId;
        const query = `
            SELECT 
                id, fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, 
                cliente_direccion, cliente_ciudad, cliente_provincia, 
                cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, 
                subtotal, iva_total, exento, total, estado, observaciones, 
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
    let { venta, productos } = req.body;

    if (!venta?.id) {
        return res.status(400).json({ error: "Se requiere venta con id para generar el PDF" });
    }

    try {
        const [ventaRows] = await db.execute('SELECT * FROM ventas WHERE id = ?', [venta.id]);
        if (!ventaRows.length) {
            return res.status(404).json({ error: "Venta no encontrada" });
        }
        venta = ventaRows[0];

        const [prodRows] = await db.execute(
            'SELECT *, descuento_porcentaje FROM ventas_cont WHERE venta_id = ?',
            [venta.id]
        );
        if (prodRows.length > 0) {
            productos = prodRows;
        }

        if (!productos || productos.length === 0) {
            return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
        }
        
        // ✅ DETECTAR SI ES UNA NOTA
        const esNota = venta.tipo_doc === 'NOTA_DEBITO' || venta.tipo_doc === 'NOTA_CREDITO';
        const tipoDoc = esNota ? venta.tipo_doc : 'FACTURA';
        
        console.log(`📄 Generando PDF de ${tipoDoc} optimizado...`);
        const startTime = Date.now();

        // ✅ USAR FUNCIÓN CORRECTA SEGÚN TIPO
        const pdfBuffer = esNota 
            ? await pdfGenerator.generarNota(venta, productos)
            : await pdfGenerator.generarFactura(venta, productos);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de ${tipoDoc} generado en ${generationTime}ms`);

        // ✅ Auditar generación de PDF
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            registroId: venta.id,
            detallesAdicionales: `PDF de ${tipoDoc} generado optimizado en ${generationTime}ms - Cliente: ${venta.cliente_nombre} - Total: $${venta.total}`
        });

        // ✅ Enviar respuesta
        const nombreArchivo = esNota 
            ? `${tipoDoc}_${venta.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
            : `Factura_${venta.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
        
        res.end(pdfBuffer);
        
        console.log(`✅ PDF de ${tipoDoc} enviado exitosamente`);

    } catch (error) {
        console.error("❌ Error generando PDF:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            registroId: venta.id,
            detallesAdicionales: `Error generando PDF: ${error.message}`
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
        const tiposPermitidos = new Set(['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO']);
        const normalizeNumber = (value) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 0;
        };
        const sanitizeText = (value) => (typeof value === 'string' ? value.trim() : (value ?? ''));

        const ventasNormalizadas = ventas.map((venta) => {
            const tipoDocumento = sanitizeText(venta?.tipo_doc).toUpperCase();
            return {
                cliente_id: venta?.cliente_id ?? null,
                cliente_nombre: sanitizeText(venta?.cliente_nombre),
                direccion: sanitizeText(venta?.direccion),
                telefono: sanitizeText(venta?.telefono),
                email: sanitizeText(venta?.email),
                dni: sanitizeText(venta?.dni),
                tipo_doc: tiposPermitidos.has(tipoDocumento) ? tipoDocumento : 'FACTURA',
                subtotal: normalizeNumber(venta?.subtotal),
                iva_total: normalizeNumber(venta?.iva_total),
                total: normalizeNumber(venta?.total)
            };
        });

        console.log(`📄 Generando PDF de Ranking de Ventas para la fecha ${fecha} (${ventas.length} ventas)...`);
        const startTime = Date.now();

        // Call the pdfGenerator's function
        const pdfBuffer = await pdfGenerator.generarRankingVentas(fecha, ventasNormalizadas);

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



// ✅ NUEVA FUNCIÓN - Generar PDFs múltiples de facturas/notas
    const generarPdfFacturasMultiples = async (req, res) => {
        const { ventasIds } = req.body;

        if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
            return res.status(400).json({ error: "Debe proporcionar al menos un ID de venta válido" });
        }

        let PDFDocument;
        try {
            ({ PDFDocument } = require('pdf-lib'));
        } catch (error) {
            console.error('❌ Dependencia faltante: pdf-lib');
            return res.status(500).json({
                error: "Falta dependencia para impresión múltiple",
                details: "Instalar 'pdf-lib' en el backend y reiniciar el servicio"
            });
        }

        try {
            console.log(`📄 Generando ${ventasIds.length} comprobantes múltiples...`);
            const startTime = Date.now();
            const pdfBuffers = [];

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

                    const esNota = venta.tipo_doc === 'NOTA_DEBITO' || venta.tipo_doc === 'NOTA_CREDITO';
                    const pdfBufferIndividual = esNota
                        ? await pdfGenerator.generarNota(venta, productos)
                        : await pdfGenerator.generarFactura(venta, productos);

                    pdfBuffers.push(pdfBufferIndividual);
                } catch (error) {
                    console.error(`Error procesando venta ID ${ventaId}:`, error);
                }
            }

            if (pdfBuffers.length === 0) {
                return res.status(404).json({ error: "No se pudieron obtener datos para las ventas seleccionadas" });
            }

            const mergedPdf = await PDFDocument.create();
            for (const buffer of pdfBuffers) {
                const pdf = await PDFDocument.load(buffer);
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            }

            const mergedBytes = await mergedPdf.save();
            const pdfBuffer = Buffer.from(mergedBytes);

            const generationTime = Date.now() - startTime;
            console.log(`✅ ${pdfBuffers.length} comprobantes múltiples generados en ${generationTime}ms`);

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

// ✅ FUNCIÓN PARA GENERAR HASH DETERMINÍSTICO DE FACTURACIÓN
const generarHashFacturacion = (pedidoId, tipoFiscal, datosFacturacion) => {
    try {
        const datosNormalizados = {
            pedidoId: parseInt(pedidoId),
            tipoFiscal: tipoFiscal,
            subtotalSinIva: parseFloat(datosFacturacion.subtotalSinIva || 0).toFixed(2),
            ivaTotal: parseFloat(datosFacturacion.ivaTotal || 0).toFixed(2),
            totalConIva: parseFloat(datosFacturacion.totalConIva || 0).toFixed(2),
            cuentaId: parseInt(datosFacturacion.cuentaId || 0)
        };
        
        const orderedJsonString = JSON.stringify(datosNormalizados, Object.keys(datosNormalizados).sort());
        return crypto.createHash('sha256').update(orderedJsonString).digest('hex');
    } catch (error) {
        console.error('❌ Error generando hash de facturación:', error);
        return null;
    }
};

const normalizarImporte = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
};

// ✅ FUNCIÓN PARA VERIFICAR VENTA EXISTENTE POR PEDIDO (dentro de transacción)
const verificarVentaExistentePorPedido = async (connection, pedidoId) => {
    try {
        return await ventasRepository.verificarVentaExistentePorPedido(connection, pedidoId);
    } catch (error) {
        console.error('❌ Error verificando venta existente por pedido:', error);
        return null;
    }
};

// ✅ FUNCIÓN PARA VERIFICAR VENTA EXISTENTE POR HASH (dentro de transacción)
const verificarVentaExistentePorHash = async (connection, hashFacturacion) => {
    try {
        return await ventasRepository.verificarVentaExistentePorHash(connection, hashFacturacion);
    } catch (error) {
        console.error('❌ Error verificando venta existente por hash:', error);
        return null;
    }
};

// Facturar pedido (convierte pedido a venta) - ✅ CON IDEMPOTENCIA COMPLETA
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

    try {
        const txResult = await withTransaction(async (connection) => {
            // ✅ 1. BLOQUEAR PEDIDO CON SELECT ... FOR UPDATE (previene race conditions)
            const pedidoQuery = `SELECT * FROM pedidos WHERE id = ? FOR UPDATE`;
            const pedidoResult = await queryPromiseWithConnection(connection, pedidoQuery, [pedidoId]);
            
            if (pedidoResult.length === 0) {
                throw new Error('Pedido no encontrado');
            }
            
            const pedido = pedidoResult[0];
            console.log('📋 Pedido obtenido y bloqueado:', pedido.id, '-', pedido.cliente_nombre, '- Estado:', pedido.estado);
            
            // ✅ 2. VERIFICAR ESTADO DENTRO DE LA TRANSACCIÓN
            if (pedido.estado === 'Facturado') {
                console.log(`⚠️ Pedido ${pedidoId} ya está facturado. Buscando venta existente...`);
                
                // Buscar la venta existente asociada a este pedido
                const ventaExistente = await verificarVentaExistentePorPedido(connection, pedidoId);
                
                if (ventaExistente) {
                    // Obtener productos de la venta existente
                    const productosVentaQuery = `SELECT * FROM ventas_cont WHERE venta_id = ?`;
                    const productosVenta = await queryPromiseWithConnection(connection, productosVentaQuery, [ventaExistente.id]);
                    
                    // Obtener remito asociado si existe
                    const remitoQuery = `SELECT id FROM remitos WHERE venta_id = ? LIMIT 1`;
                    const remitoResult = await queryPromiseWithConnection(connection, remitoQuery, [ventaExistente.id]);
                    const remitoId = remitoResult.length > 0 ? remitoResult[0].id : null;
                    
                    console.log(`✅ Retornando venta existente ID ${ventaExistente.id} para pedido ${pedidoId}`);
                    
                    // Auditar detección de duplicado
                    try {
                        await auditarOperacion(req, {
                            accion: 'DUPLICATE_DETECTED',
                            tabla: 'ventas',
                            registroId: ventaExistente.id,
                            detallesAdicionales: `Intento de facturar pedido ya facturado - Pedido: ${pedidoId} - Venta existente: ID ${ventaExistente.id} - Factura: ${ventaExistente.numero_factura}`
                        });
                    } catch (auditError) {
                        console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
                    }
                    
                    return {
                        statusCode: 200,
                        success: true,
                        message: 'Este pedido ya fue facturado anteriormente',
                        existing: true,
                        data: {
                            ventaId: ventaExistente.id,
                            numeroFactura: ventaExistente.numero_factura,
                            tipoFactura: ventaExistente.tipo_f,
                            remitoId: remitoId,
                            pedidoId: pedidoId,
                            total: ventaExistente.total,
                            productosCount: productosVenta.length,
                            requiereCAE: ventaExistente.tipo_f !== 'X',
                            pedidoActualizado: { id: pedidoId, estado: 'Facturado' }
                        }
                    };
                } else {
                    return {
                        statusCode: 400,
                        success: false,
                        message: 'El pedido está marcado como facturado pero no se encontró la venta asociada'
                    };
                }
            }

            // ✅ 3. Obtener productos del pedido
            const productosQuery = `SELECT * FROM pedidos_cont WHERE pedido_id = ?`;
            const productos = await queryPromiseWithConnection(connection, productosQuery, [pedidoId]);

            if (productos.length === 0) {
                throw new Error('No se encontraron productos en el pedido');
            }
            
            console.log('📦 Productos obtenidos:', productos.length, 'productos');
            
            // ✅ 4. IMPORTES: fuente única = suma de líneas en pedidos_cont (coherencia BD / PDF / ARCA).
            // totalConIva del front puede ser menor (descuento global), nunca mayor que neto+IVA de líneas.
            const lineSubtotal = productos.reduce((acc, p) => acc + (Number(p.subtotal) || 0), 0);
            const lineIva = productos.reduce((acc, p) => acc + (Number(p.IVA) || 0), 0);
            const lineTotal = lineSubtotal + lineIva;

            const subtotalSinIvaFinal = lineSubtotal;
            const ivaTotalFinal = lineIva;

            const totalConIvaRaw = normalizarImporte(totalConIva);
            const totalConIvaFinal =
                Number.isFinite(totalConIvaRaw) &&
                totalConIvaRaw > 0 &&
                totalConIvaRaw <= lineTotal
                    ? totalConIvaRaw
                    : lineTotal;

            if (
                !Number.isFinite(subtotalSinIvaFinal) ||
                !Number.isFinite(ivaTotalFinal) ||
                !Number.isFinite(totalConIvaFinal) ||
                subtotalSinIvaFinal < 0 ||
                ivaTotalFinal < 0 ||
                totalConIvaFinal <= 0
            ) {
                const validationError = new Error('Importes de facturación inválidos. No se pudo generar una cabecera de venta válida.');
                validationError.statusCode = 400;
                throw validationError;
            }

            // ✅ 5. GENERAR HASH DETERMINÍSTICO PARA IDEMPOTENCIA
            const hashFacturacion = generarHashFacturacion(pedidoId, tipoFiscal, {
                subtotalSinIva: subtotalSinIvaFinal,
                ivaTotal: ivaTotalFinal,
                totalConIva: totalConIvaFinal,
                cuentaId
            });
            console.log(`🔐 Hash de facturación generado: ${hashFacturacion}`);
            
            // ✅ 6. VERIFICAR VENTA EXISTENTE POR HASH (idempotencia explícita)
            const ventaExistentePorHash = await verificarVentaExistentePorHash(connection, hashFacturacion);
            if (ventaExistentePorHash) {
                // Obtener productos y remito de la venta existente
                const productosVentaQuery = `SELECT * FROM ventas_cont WHERE venta_id = ?`;
                const productosVenta = await queryPromiseWithConnection(connection, productosVentaQuery, [ventaExistentePorHash.id]);
                
                const remitoQuery = `SELECT id FROM remitos WHERE venta_id = ? LIMIT 1`;
                const remitoResult = await queryPromiseWithConnection(connection, remitoQuery, [ventaExistentePorHash.id]);
                const remitoId = remitoResult.length > 0 ? remitoResult[0].id : null;

                console.log(`✅ Retornando venta existente por hash ID ${ventaExistentePorHash.id}`);

                // Auditar detección de duplicado
                try {
                    await auditarOperacion(req, {
                        accion: 'DUPLICATE_DETECTED',
                        tabla: 'ventas',
                        registroId: ventaExistentePorHash.id,
                        detallesAdicionales: `Intento de facturación duplicada detectado por hash - Hash: ${hashFacturacion} - Venta existente: ID ${ventaExistentePorHash.id} - Factura: ${ventaExistentePorHash.numero_factura}`
                    });
                } catch (auditError) {
                    console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
                }

                return {
                    statusCode: 200,
                    success: true,
                    message: 'Esta facturación ya fue procesada anteriormente',
                    existing: true,
                    data: {
                        ventaId: ventaExistentePorHash.id,
                        numeroFactura: ventaExistentePorHash.numero_factura,
                        tipoFactura: ventaExistentePorHash.tipo_f,
                        remitoId: remitoId,
                        pedidoId: pedidoId,
                        total: ventaExistentePorHash.total,
                        productosCount: productosVenta.length,
                        requiereCAE: ventaExistentePorHash.tipo_f !== 'X',
                        pedidoActualizado: { id: pedidoId, estado: 'Facturado' }
                    }
                };
            }
            
            // ✅ 7. VERIFICAR VENTA EXISTENTE POR PEDIDO (idempotencia por entidad)
            const ventaExistentePorPedido = await verificarVentaExistentePorPedido(connection, pedidoId);
            if (ventaExistentePorPedido) {
                // Obtener productos y remito de la venta existente
                const productosVentaQuery = `SELECT * FROM ventas_cont WHERE venta_id = ?`;
                const productosVenta = await queryPromiseWithConnection(connection, productosVentaQuery, [ventaExistentePorPedido.id]);
                
                const remitoQuery = `SELECT id FROM remitos WHERE venta_id = ? LIMIT 1`;
                const remitoResult = await queryPromiseWithConnection(connection, remitoQuery, [ventaExistentePorPedido.id]);
                const remitoId = remitoResult.length > 0 ? remitoResult[0].id : null;
                
                // Actualizar estado del pedido si no está actualizado
                if (pedido.estado !== 'Facturado') {
                    const actualizarPedidoQuery = `UPDATE pedidos SET estado = 'Facturado' WHERE id = ?`;
                    await queryPromiseWithConnection(connection, actualizarPedidoQuery, [pedidoId]);
                    console.log('📋 Estado del pedido actualizado a "Facturado"');
                }

                console.log(`✅ Retornando venta existente por pedido ID ${ventaExistentePorPedido.id}`);

                // Auditar detección de duplicado
                try {
                    await auditarOperacion(req, {
                        accion: 'DUPLICATE_DETECTED',
                        tabla: 'ventas',
                        registroId: ventaExistentePorPedido.id,
                        detallesAdicionales: `Intento de facturar pedido ya facturado - Pedido: ${pedidoId} - Venta existente: ID ${ventaExistentePorPedido.id} - Factura: ${ventaExistentePorPedido.numero_factura}`
                    });
                } catch (auditError) {
                    console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
                }

                return {
                    statusCode: 200,
                    success: true,
                    message: 'Este pedido ya fue facturado anteriormente',
                    existing: true,
                    data: {
                        ventaId: ventaExistentePorPedido.id,
                        numeroFactura: ventaExistentePorPedido.numero_factura,
                        tipoFactura: ventaExistentePorPedido.tipo_f,
                        remitoId: remitoId,
                        pedidoId: pedidoId,
                        total: ventaExistentePorPedido.total,
                        productosCount: productosVenta.length,
                        requiereCAE: ventaExistentePorPedido.tipo_f !== 'X',
                        pedidoActualizado: { id: pedidoId, estado: 'Facturado' }
                    }
                };
            }

            // ✅ 8. OBTENER SIGUIENTE NÚMERO DE FACTURA (solo si no existe venta)
            const { numeroFactura, numeroCompleto, puntoVenta } = await obtenerSiguienteNumeroFactura(
                connection, 
                tipoFiscal
            );
            
            console.log(`📄 Número de factura asignado: ${numeroCompleto}`);

            // 4. Crear la venta CON NÚMERO DE FACTURA
            // ✅ Política fiscal: EXENTO => exento=iva_total (desde líneas), no EXENTO => exento=0
            const esClienteExento = pedido.cliente_condicion?.toUpperCase() === 'EXENTO';
            const montoExento = esClienteExento ? ivaTotalFinal : 0;

            // ✅ Redondeo para facturación: ,01–,59 mantienen; ,60–,99 suben
            const subtotalR = roundFacturacion(subtotalSinIvaFinal);
            const ivaTotalR = roundFacturacion(ivaTotalFinal);
            const exentoR = roundFacturacion(montoExento);
            const totalR = roundFacturacion(totalConIvaFinal);
            
            console.log(`💰 [Facturar Pedido] Monto exento a guardar en venta: $${montoExento.toFixed(2)} (regla: EXENTO => iva_total; no EXENTO => 0)`);
            
            const ventaId = await ventasRepository.insertarVentaCabecera(connection, {
                numero_factura: numeroCompleto,
                cliente_id: pedido.cliente_id,
                cliente_nombre: pedido.cliente_nombre,
                cliente_telefono: pedido.cliente_telefono,
                cliente_direccion: pedido.cliente_direccion,
                cliente_ciudad: pedido.cliente_ciudad,
                cliente_provincia: pedido.cliente_provincia,
                cliente_condicion: pedido.cliente_condicion,
                cliente_cuit: pedido.cliente_cuit,
                cuenta_id: cuentaId,
                tipo_doc: 'FACTURA',
                tipo_f: tipoFiscal,
                subtotal: subtotalR,
                iva_total: ivaTotalR,
                exento: exentoR,
                total: totalR,
                estado: 'Facturada',
                observaciones: pedido.observaciones,
                empleado_id: pedido.empleado_id,
                empleado_nombre: pedido.empleado_nombre,
                hash_venta: hashFacturacion
            });
            console.log('💰 Venta creada con ID:', ventaId, '- Número:', numeroCompleto);
            await ventasRepository.actualizarTotalesVenta(connection, ventaId, {
                subtotal: subtotalR,
                iva_total: ivaTotalR,
                exento: exentoR,
                total: totalR
            });
            
            // ✅ Verificar inmediatamente después de insertar
            const verifyQuery = `SELECT exento FROM ventas WHERE id = ?`;
            const verifyResult = await queryPromiseWithConnection(connection, verifyQuery, [ventaId]);
            if (verifyResult.length > 0) {
                console.log(`🔍 [VERIFICACIÓN] Exento guardado en venta: ${verifyResult[0].exento}`);
                if (parseFloat(verifyResult[0].exento) !== exentoR) {
                    console.error(`❌ [ERROR] El exento guardado (${verifyResult[0].exento}) NO coincide con el enviado (${exentoR})`);
                } else {
                    console.log(`✅ [VERIFICACIÓN] El exento se guardó correctamente: $${verifyResult[0].exento}`);
                }
            }

            // 5. Copiar productos del pedido a la venta
            await ventasRepository.insertarVentaItems(connection, ventaId, productos.map((producto) => ({
                producto_id: producto.producto_id,
                producto_nombre: producto.producto_nombre,
                producto_um: producto.producto_um,
                cantidad: parseFloat(producto.cantidad),
                precio: producto.precio,
                iva: producto.IVA,
                subtotal: producto.subtotal,
                descuento_porcentaje: producto.descuento_porcentaje || 0
            })));
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

            const remitoId = await remitosRepository.crearRemito(connection, datosRemito);
            console.log('📋 Remito creado con ID:', remitoId);

            // 8. Insertar productos en el remito
            console.log('📦 Insertando productos en el remito...');
            
            await remitosRepository.insertarProductosRemito(connection, remitoId, productos.map((producto) => ({
                producto_id: producto.producto_id,
                producto_nombre: producto.producto_nombre,
                producto_um: producto.producto_um,
                cantidad: producto.cantidad
            })));
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
                totalR
            ]);
            console.log('💰 Movimiento de fondos registrado');

            // 10. Actualizar saldo de la cuenta
            const actualizarSaldoQuery = `
                UPDATE cuenta_fondos 
                SET saldo = saldo + ? 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarSaldoQuery, [totalR, cuentaId]);
            console.log('💳 Saldo de cuenta actualizado');

            // 11. Cambiar estado del pedido a "Facturado"
            const actualizarPedidoQuery = `
                UPDATE pedidos 
                SET estado = 'Facturado' 
                WHERE id = ?
            `;

            await queryPromiseWithConnection(connection, actualizarPedidoQuery, [pedidoId]);
            console.log('📋 Estado del pedido actualizado a "Facturado"');

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
                        total: totalR,
                        tipo_fiscal: tipoFiscal,
                        cuenta_id: cuentaId,
                        cae: caeData?.cae || null
                    },
                    detallesAdicionales: `Pedido #${pedidoId} facturado como ${tipoFiscal} #${numeroCompleto} - Cliente: ${pedido.cliente_nombre} - Total: $${totalR}`
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
            return { 
                statusCode: 200,
                success: true, 
                message: 'Facturación completada exitosamente',
                data: {
                    ventaId,
                    numeroFactura: numeroCompleto,
                    tipoFactura: tipoFiscal,
                    remitoId,
                    pedidoId,
                    total: totalR,
                    productosCount: productos.length,
                    requiereCAE: tipoFiscal !== 'X',
                    cae: caeData?.cae || null,
                    pedidoActualizado: { id: pedidoId, estado: 'Facturado' }
                }
            };
        });
        return res.status(txResult.statusCode || 200).json(txResult);
    } catch (error) {
        console.error('❌ Error en facturación:', error);
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
        const errorStatus = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        return res.status(errorStatus).json({
            success: false,
            message: error.message || 'Error en el proceso de facturación'
        });
    }
};

const queryPromiseWithConnection = async (connection, query, params) => {
    const [results] = await connection.query(query, params);
    return results;
};

// FUNCIÓN PARA REMITO CON CONNECTION
const registrarRemitoPromiseWithConnection = async (connection, pedidoData) => {
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

    const [result] = await connection.query(registrarRemitoQuery, remitoValues);
    console.log('✅ Remito registrado con ID:', result.insertId, '- Empleado:', empleado_nombre);
    return result.insertId;
};

// FUNCIÓN PARA PRODUCTOS REMITO CON CONNECTION
const insertarProductosRemitoPromiseWithConnection = async (connection, remitoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad)
        VALUES (?, ?, ?, ?, ?)
    `;

    await Promise.all(productos.map(async (producto) => {
        const { producto_id, producto_nombre, producto_um, cantidad } = producto;
        const productoValues = [remitoId, producto_id, producto_nombre, producto_um, cantidad];
        await connection.query(insertProductoQuery, productoValues);
        console.log(`✅ Producto ${producto_nombre} insertado en remito`);
    }));

    console.log('✅ Todos los productos del remito insertados correctamente');
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

/**
 * Obtener datos únicos para filtros (clientes, ciudades, empleados) desde TODAS las ventas.
 * Usado para autocomplete y selects sin depender de la página actual.
 */
const obtenerDatosFiltros = (req, res) => {
    const queryClientes = `
        SELECT DISTINCT cliente_nombre AS valor FROM ventas
        WHERE cliente_nombre IS NOT NULL AND TRIM(cliente_nombre) != '' AND cliente_nombre != 'Cliente no especificado'
        ORDER BY cliente_nombre ASC
        LIMIT 300
    `;
    const queryCiudades = `
        SELECT DISTINCT cliente_ciudad AS valor FROM ventas
        WHERE cliente_ciudad IS NOT NULL AND TRIM(cliente_ciudad) != '' AND cliente_ciudad != 'No especificada'
        ORDER BY cliente_ciudad ASC
        LIMIT 150
    `;
    const queryEmpleados = `
        SELECT DISTINCT empleado_nombre AS valor FROM ventas
        WHERE empleado_nombre IS NOT NULL AND TRIM(empleado_nombre) != '' AND empleado_nombre != 'No especificado'
        ORDER BY empleado_nombre ASC
        LIMIT 100
    `;

    db.query(queryClientes, (errC, rowsC) => {
        if (errC) {
            console.error('Error al obtener clientes para filtros:', errC);
            return res.status(500).json({ success: false, message: 'Error al obtener datos de filtros' });
        }
        db.query(queryCiudades, (errCi, rowsCi) => {
            if (errCi) {
                console.error('Error al obtener ciudades para filtros:', errCi);
                return res.status(500).json({ success: false, message: 'Error al obtener datos de filtros' });
            }
            db.query(queryEmpleados, (errE, rowsE) => {
                if (errE) {
                    console.error('Error al obtener empleados para filtros:', errE);
                    return res.status(500).json({ success: false, message: 'Error al obtener datos de filtros' });
                }
                const clientes = (rowsC || []).map(r => r.valor);
                const ciudades = (rowsCi || []).map(r => r.valor);
                const empleados = (rowsE || []).map(r => r.valor);
                res.json({
                    success: true,
                    data: { clientes, ciudades, empleados },
                    meta: { totalClientes: clientes.length, totalCiudades: ciudades.length, totalEmpleados: empleados.length }
                });
            });
        });
    });
};

/**
 * Sugerencias para autocomplete: busca en TODAS las ventas por tipo (cliente, ciudad, empleado).
 * Query params: tipo (cliente|ciudad|empleado), q (texto a buscar). Limita a 25 resultados.
 */
const obtenerSugerenciasFiltros = (req, res) => {
    const tipo = (req.query.tipo || '').trim().toLowerCase();
    const q = (req.query.q || '').trim();
    const validos = ['cliente', 'ciudad', 'empleado'];
    if (!validos.includes(tipo)) {
        return res.status(400).json({ success: false, message: 'Parámetro tipo debe ser cliente, ciudad o empleado' });
    }
    const columna = tipo === 'cliente' ? 'cliente_nombre' : tipo === 'ciudad' ? 'cliente_ciudad' : 'empleado_nombre';
    const term = q.length ? '%' + q + '%' : '%';
    const query = `
        SELECT DISTINCT ${columna} AS valor FROM ventas
        WHERE ${columna} IS NOT NULL AND TRIM(${columna}) != ''
        AND (${columna} LIKE ?)
        ORDER BY ${columna} ASC
        LIMIT 25
    `;
    db.query(query, [term], (err, rows) => {
        if (err) {
            console.error('Error en sugerencias filtros:', err);
            return res.status(500).json({ success: false, message: 'Error al buscar sugerencias' });
        }
        const valores = (rows || []).map(r => r.valor);
        res.json({ success: true, data: valores });
    });
};

/**
 * Buscar ventas por cliente con paginación.
 * Query params: busqueda (requerido), pagina (default 1), porPagina (default 50).
 */
const buscarVentasPorCliente = (req, res) => {
    const busqueda = (req.query.busqueda || '').trim();
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const porPagina = Math.min(200, Math.max(10, parseInt(req.query.porPagina, 10) || 50));
    const offset = (pagina - 1) * porPagina;

    if (!busqueda) {
        return res.status(400).json({
            success: false,
            message: 'El parámetro de búsqueda es requerido'
        });
    }

    const searchTerm = '%' + busqueda + '%';
    const countQuery = 'SELECT COUNT(*) as total FROM ventas WHERE cliente_nombre LIKE ?';
    const dataQuery = `
        SELECT 
            id, fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, 
            cliente_direccion, cliente_ciudad, cliente_provincia, 
            cliente_condicion, cliente_cuit, cuenta_id, tipo_doc, tipo_f, 
            subtotal, iva_total, exento, total, estado, observaciones, 
            empleado_id, empleado_nombre, 
            cae_id, cae_fecha, cae_resultado, cae_observaciones, cae_solicitud_fecha,
            comprobante_path
        FROM ventas 
        WHERE cliente_nombre LIKE ?
        ORDER BY fecha DESC, id DESC
        LIMIT ? OFFSET ?
    `;

    db.query(countQuery, [searchTerm], (errCount, countRows) => {
        if (errCount) {
            console.error('Error al contar ventas por cliente:', errCount);
            return res.status(500).json({ success: false, message: 'Error al buscar ventas' });
        }
        const total = (countRows && countRows[0] && countRows[0].total) ? countRows[0].total : 0;
        db.query(dataQuery, [searchTerm, porPagina, offset], (err, results) => {
            if (err) {
                console.error('Error al buscar ventas:', err);
                return res.status(500).json({ success: false, message: 'Error al buscar ventas' });
            }
            res.json({
                success: true,
                data: results || [],
                total: total,
                pagina: pagina,
                porPagina: porPagina
            });
        });
    });
};

// ✅ FUNCIÓN PARA GENERAR HASH DE VENTA (similar a pedidos)
const generarHashVenta = (ventaData) => {
    try {
        const datosNormalizados = {
            cliente_id: ventaData.cliente_id,
            subtotalSinIva: parseFloat(ventaData.subtotalSinIva || 0).toFixed(2),
            ivaTotal: parseFloat(ventaData.ivaTotal || 0).toFixed(2),
            totalConIva: parseFloat(ventaData.totalConIva || 0).toFixed(2),
            empleado_id: ventaData.empleado_id || 1,
            tipoFiscal: ventaData.tipoFiscal,
            productos: (ventaData.productos || []).map(p => ({
                id: p.id,
                cantidad: parseFloat(p.cantidad || 0),
                precio: parseFloat(p.precio || 0).toFixed(2),
                subtotal: parseFloat(p.subtotal || 0).toFixed(2)
            })).sort((a, b) => a.id - b.id)
        };

        const stringVenta = JSON.stringify(datosNormalizados);
        let hash = 0;
        for (let i = 0; i < stringVenta.length; i++) {
            const char = stringVenta.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        const fechaHoy = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const hashFinal = `venta_${Math.abs(hash).toString(36)}_${fechaHoy}`;
        
        return hashFinal;
    } catch (error) {
        console.error('❌ Error generando hash de venta:', error);
        return null;
    }
};

// ✅ FUNCIÓN PARA VERIFICAR VENTA DUPLICADA
const verificarVentaDuplicada = async (hashVenta) => {
    return new Promise((resolve, reject) => {
        if (!hashVenta) {
            return resolve(null);
        }

        // Buscar venta con el mismo hash en los últimos 7 días
        const query = `
            SELECT id, fecha, cliente_nombre, total, numero_factura
            FROM ventas
            WHERE hash_venta = ?
            AND fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY fecha DESC, id DESC
            LIMIT 1
        `;

        db.query(query, [hashVenta], (err, results) => {
            if (err) {
                console.error('❌ Error verificando venta duplicada:', err);
                return resolve(null);
            }

            if (results.length > 0) {
                console.log(`⚠️ Venta duplicada detectada: hash ${hashVenta}, venta ID ${results[0].id}`);
                return resolve(results[0]);
            }

            return resolve(null);
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
        exento,  // ✅ Monto exento
        totalConIva,
        descuentoAplicado,
        
        // Observaciones y empleado
        observaciones,
        empleado_id,
        empleado_nombre,
        hash_venta  // ✅ Hash para idempotencia
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

    // ✅ GENERAR O USAR HASH DE LA VENTA PARA IDEMPOTENCIA
    let hashVentaFinal = hash_venta;
    if (!hashVentaFinal) {
        hashVentaFinal = generarHashVenta({
            cliente_id,
            subtotalSinIva,
            ivaTotal,
            totalConIva,
            empleado_id,
            tipoFiscal,
            productos
        });
        console.log(`🔐 Hash de venta generado en backend: ${hashVentaFinal}`);
    }

    // ✅ VERIFICAR DUPLICADOS ANTES DE PROCESAR
    const ventaDuplicada = await verificarVentaDuplicada(hashVentaFinal);
    if (ventaDuplicada) {
        console.log(`⚠️ Venta duplicada detectada, retornando venta existente ID: ${ventaDuplicada.id}`);
        
        await auditarOperacion(req, {
            accion: 'DUPLICATE_DETECTED',
            tabla: 'ventas',
            registroId: ventaDuplicada.id,
            detallesAdicionales: `Intento de duplicar venta detectado - Hash: ${hashVentaFinal} - Venta existente: ID ${ventaDuplicada.id} - Cliente: ${ventaDuplicada.cliente_nombre} - Factura: ${ventaDuplicada.numero_factura}`
        });

        return res.json({ 
            success: true, 
            message: 'Esta venta ya fue registrada anteriormente',
            data: ventaDuplicada,
            existing: true // ✅ INDICADOR DE DUPLICADO
        });
    }

    console.log(`💰 [Venta Directa] Iniciando proceso - Usuario: ${empleado_nombre} - Cliente: ${cliente_nombre} - Hash: ${hashVentaFinal}`);



    
    try {
        const txResult = await withTransaction(async (connection) => {
            // ============================================
            // 1️⃣ CREAR EL PEDIDO
            // ============================================
            console.log('📋 [Venta Directa] Paso 1: Creando pedido...');
            
            // ✅ Importes desde líneas del body (fuente única); total clampado ≤ neto+IVA (descuento global).
            const lineSubtotal = productos.reduce((acc, p) => acc + (Number(p.subtotal) || 0), 0);
            const lineIva = productos.reduce((acc, p) => acc + (Number(p.iva) || 0), 0);
            const lineTotal = lineSubtotal + lineIva;

            const subtotalSinIvaFinal = lineSubtotal;
            const ivaTotalFinal = lineIva;

            const totalConIvaRaw = normalizarImporte(totalConIva);
            const totalConIvaFinal =
                Number.isFinite(totalConIvaRaw) &&
                totalConIvaRaw > 0 &&
                totalConIvaRaw <= lineTotal
                    ? totalConIvaRaw
                    : lineTotal;

            if (
                !Number.isFinite(subtotalSinIvaFinal) ||
                !Number.isFinite(ivaTotalFinal) ||
                !Number.isFinite(totalConIvaFinal) ||
                subtotalSinIvaFinal < 0 ||
                ivaTotalFinal < 0 ||
                totalConIvaFinal <= 0
            ) {
                throw new Error('Importes de venta directa inválidos. No se pudo generar pedido/venta válidos.');
            }

            const pedidoQuery = `
                INSERT INTO pedidos 
                (cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, 
                 cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, exento, total, 
                 estado, observaciones, empleado_id, empleado_nombre)
                VALUES 
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', ?, ?, ?)
            `;

            // ✅ Política fiscal: EXENTO => exento=iva_total (desde líneas), no EXENTO => exento=0
            const esClienteExento = cliente_condicion?.toUpperCase() === 'EXENTO';
            const montoExento = esClienteExento ? ivaTotalFinal : 0;

            // ✅ Redondeo para facturación
            const subtotalR = roundFacturacion(subtotalSinIvaFinal);
            const ivaTotalR = roundFacturacion(ivaTotalFinal);
            const exentoR = roundFacturacion(montoExento);
            const totalR = roundFacturacion(totalConIvaFinal);
            
            console.log(`💰 [Venta Directa] Monto exento final a guardar: $${montoExento.toFixed(2)} (regla: EXENTO => iva_total; no EXENTO => 0)`);

            const pedidoValues = [
                cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
                cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
                subtotalR, ivaTotalR, exentoR, totalR, 
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

            // Crear la venta CON NÚMERO DE FACTURA Y HASH
            const ventaId = await ventasRepository.insertarVentaCabecera(connection, {
                numero_factura: numeroCompleto,
                cliente_id,
                cliente_nombre,
                cliente_telefono,
                cliente_direccion,
                cliente_ciudad,
                cliente_provincia,
                cliente_condicion,
                cliente_cuit,
                cuenta_id: cuentaId,
                tipo_doc: 'FACTURA',
                tipo_f: tipoFiscal,
                subtotal: subtotalR,
                iva_total: ivaTotalR,
                exento: exentoR,
                total: totalR,
                estado: 'Facturada',
                observaciones: observaciones || '',
                empleado_id,
                empleado_nombre,
                hash_venta: hashVentaFinal
            });
            
            console.log(`✅ [Venta Directa] Venta creada con ID: ${ventaId}`);
            
            // ✅ Verificar inmediatamente después de insertar
            const verifyQuery = `SELECT exento FROM ventas WHERE id = ?`;
            const verifyResult = await queryPromiseWithConnection(connection, verifyQuery, [ventaId]);
            if (verifyResult.length > 0) {
                console.log(`🔍 [VERIFICACIÓN] Exento guardado en venta: ${verifyResult[0].exento}`);
                if (parseFloat(verifyResult[0].exento) !== exentoR) {
                    console.error(`❌ [ERROR] El exento guardado (${verifyResult[0].exento}) NO coincide con el enviado (${exentoR})`);
                } else {
                    console.log(`✅ [VERIFICACIÓN] El exento se guardó correctamente: $${verifyResult[0].exento}`);
                }
            }

            // ============================================
            // 4️⃣ COPIAR PRODUCTOS A LA VENTA
            // ============================================
            console.log('📦 [Venta Directa] Paso 4: Copiando productos a la venta...');
            
            await ventasRepository.insertarVentaItems(connection, ventaId, productos.map((producto) => ({
                producto_id: producto.id,
                producto_nombre: producto.nombre,
                producto_um: producto.unidad_medida,
                cantidad: parseFloat(producto.cantidad),
                precio: producto.precio,
                iva: producto.iva,
                subtotal: producto.subtotal,
                descuento_porcentaje: producto.descuento_porcentaje || 0
            })));
            
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

            const remitoId = await remitosRepository.crearRemito(connection, datosRemito);
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

                await remitosRepository.insertarProductosRemito(connection, remitoId, productosParaRemito);
            
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
                totalR
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

            await queryPromiseWithConnection(connection, actualizarSaldoQuery, [totalR, cuentaId]);
            console.log('✅ [Venta Directa] Saldo de cuenta actualizado');

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
                        total: totalR,
                        tipo_fiscal: tipoFiscal,
                        cuenta_id: cuentaId,
                        descuento: descuentoAplicado
                    },
                    detallesAdicionales: `Venta directa completada - Pedido #${pedidoId} → Venta #${ventaId} → Remito #${remitoId} - Cliente: ${cliente_nombre} - Total: $${totalR} - ${productos.length} productos`
                });
            } catch (auditError) {
                console.warn('⚠️ Error en auditoría (no crítico):', auditError.message);
            }

            console.log('🎉 [Venta Directa] Proceso completado exitosamente');
            
            // ============================================
            // ✅ RESPUESTA EXITOSA
            // ============================================
            return { 
                statusCode: 200,
                success: true, 
                message: 'Venta directa completada exitosamente',
                data: {
                    pedidoId,
                    ventaId,
                    remitoId,
                    total: totalR,
                    productosCount: productos.length
                }
            };
        });
        return res.status(txResult.statusCode || 200).json(txResult);
    } catch (error) {
        console.error('❌ [Venta Directa] Error en el proceso:', error);
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
        return res.status(500).json({
            success: false,
            message: error.message || 'Error en el proceso de venta directa',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// ✅ DUPLICAR VENTA EN MODO BORRADOR (sin solicitar CAE)
const duplicarVentaBorrador = async (req, res) => {
    const ventaIdOrigen = parseInt(req.params.id, 10);

    if (!Number.isInteger(ventaIdOrigen) || ventaIdOrigen <= 0) {
        return res.status(400).json({
            success: false,
            message: 'ID de venta inválido'
        });
    }

    try {
        const txResult = await withTransaction(async (connection) => {
            const ventaOrigenRows = await queryPromiseWithConnection(
                connection,
                'SELECT * FROM ventas WHERE id = ? FOR UPDATE',
                [ventaIdOrigen]
            );

            if (!ventaOrigenRows.length) {
                throw new Error(`No se encontró la venta origen ID ${ventaIdOrigen}`);
            }

            const ventaOrigen = ventaOrigenRows[0];
            const tipoFiscal = (ventaOrigen.tipo_f || '').toString().trim().toUpperCase();

            if (!['A', 'B', 'X'].includes(tipoFiscal)) {
                throw new Error(`Tipo fiscal inválido en venta origen: ${ventaOrigen.tipo_f}`);
            }

            const itemsOrigen = await queryPromiseWithConnection(
                connection,
                `SELECT producto_id, producto_nombre, producto_um, cantidad, precio, iva, subtotal, descuento_porcentaje
                 FROM ventas_cont
                 WHERE venta_id = ?
                 ORDER BY id ASC`,
                [ventaIdOrigen]
            );

            if (!itemsOrigen.length) {
                throw new Error('La venta origen no tiene ítems para duplicar');
            }

            const { numeroCompleto } = await obtenerSiguienteNumeroFactura(connection, tipoFiscal);
            const hashVentaDuplicada = `dup_${ventaIdOrigen}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const observacionesOrigen = (ventaOrigen.observaciones || '').toString().trim();
            const observacionesDuplicada = observacionesOrigen && observacionesOrigen.toLowerCase() !== 'sin observaciones'
                ? `${observacionesOrigen} | Duplicada de venta #${ventaIdOrigen}`
                : `Duplicada de venta #${ventaIdOrigen}`;

            const empleadoIdFinal = ventaOrigen.empleado_id || req.user?.id || 1;
            const empleadoNombreFinal = ventaOrigen.empleado_nombre || req.user?.nombre || 'Sistema';

            const ventaNuevaId = await ventasRepository.insertarVentaCabecera(connection, {
                numero_factura: numeroCompleto,
                cliente_id: ventaOrigen.cliente_id,
                cliente_nombre: ventaOrigen.cliente_nombre,
                cliente_telefono: ventaOrigen.cliente_telefono,
                cliente_direccion: ventaOrigen.cliente_direccion,
                cliente_ciudad: ventaOrigen.cliente_ciudad,
                cliente_provincia: ventaOrigen.cliente_provincia,
                cliente_condicion: ventaOrigen.cliente_condicion,
                cliente_cuit: ventaOrigen.cliente_cuit,
                cuenta_id: ventaOrigen.cuenta_id,
                tipo_doc: ventaOrigen.tipo_doc,
                tipo_f: tipoFiscal,
                subtotal: parseFloat(ventaOrigen.subtotal) || 0,
                iva_total: parseFloat(ventaOrigen.iva_total) || 0,
                exento: parseFloat(ventaOrigen.exento) || 0,
                total: parseFloat(ventaOrigen.total) || 0,
                estado: 'Facturada',
                observaciones: observacionesDuplicada,
                empleado_id: empleadoIdFinal,
                empleado_nombre: empleadoNombreFinal,
                hash_venta: hashVentaDuplicada
            });

            await ventasRepository.insertarVentaItems(connection, ventaNuevaId, itemsOrigen.map((item) => ({
                producto_id: item.producto_id,
                producto_nombre: item.producto_nombre,
                producto_um: item.producto_um,
                cantidad: parseFloat(item.cantidad) || 0,
                precio: parseFloat(item.precio) || 0,
                iva: parseFloat(item.iva) || 0,
                subtotal: parseFloat(item.subtotal) || 0,
                descuento_porcentaje: parseFloat(item.descuento_porcentaje) || 0
            })));

            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'ventas',
                registroId: ventaNuevaId,
                detallesAdicionales: `Venta duplicada en borrador: origen #${ventaIdOrigen} -> nueva #${ventaNuevaId} (${numeroCompleto})`,
                datosNuevos: {
                    venta_origen_id: ventaIdOrigen,
                    venta_nueva_id: ventaNuevaId,
                    numero_factura_nuevo: numeroCompleto,
                    items_clonados: itemsOrigen.length
                }
            });

            return {
                statusCode: 200,
                success: true,
                message: 'Venta duplicada correctamente en modo borrador (sin CAE)',
                data: {
                    ventaOriginalId: ventaIdOrigen,
                    ventaNuevaId,
                    numeroFactura: numeroCompleto,
                    productosCount: itemsOrigen.length,
                    caeSolicitado: false
                }
            };
        });
        return res.status(txResult.statusCode || 200).json(txResult);
    } catch (error) {
        console.error('❌ Error duplicando venta:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error al duplicar venta'
        });
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
    obtenerMovimientosCuenta,
    generarPdfRankingVentas,
    obtenerDatosFiltros,
    obtenerSugerenciasFiltros,
    buscarVentasPorCliente,
    ventaDirecta,
    duplicarVentaBorrador
};