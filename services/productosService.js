const db = require('../db/legacyAdapter');
const { parsePagination } = require('../utils/pagination');
const { withTransaction } = require('../db/transaction');

/** Nombre exacto del producto plantilla para fletes (Venta Directa). La búsqueda usa igualdad exacta para no confundir con otros que contengan este texto. */
const NOMBRE_PRODUCTO_FLETE_HACIENDA = 'FLETE DE HACIENDA';

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const { invalidate } = require('../utils/cache');
const pdfGenerator = require('../utils/pdfGenerator');
const { registrarMovimientoStockPool } = require('../utils/stockMovement');
const { STOCK_THRESHOLDS } = require('../config/stockConstants');

const queryPromise = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });

const queryConn = async (connection, sql, params = []) => {
    const [results] = await connection.query(sql, params);
    return results;
};

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

const esNumeroValido = (valor) => valor != null && valor !== '' && !isNaN(parseFloat(valor));

const nuevoProducto = async (req, res) => {
    const { nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual } = req.body;

    if (
        !nombre ||
        !unidad_medida ||
        !categoria_id ||
        !esNumeroValido(costo) ||
        !esNumeroValido(precio) ||
        !esNumeroValido(iva) ||
        stock_actual === undefined ||
        isNaN(parseFloat(stock_actual))
    ) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const query = `
        INSERT INTO productos (nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, unidad_medida, costo, precio, categoria_id, iva, parseFloat(stock_actual)], async (err, results) => {
        if (err) {
            console.error('Error al insertar el producto:', err);
            
            // Auditar error en creación
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'productos',
                detallesAdicionales: `Error al crear producto: ${err.message}`,
                datosNuevos: req.body
            });
            
            return res.status(500).json({ success: false, message: "Error al insertar el producto" });
        }
        
        // Auditar creación exitosa del producto
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'productos',
            registroId: results.insertId,
            datosNuevos: { 
                id: results.insertId,
                ...req.body
            },
            detallesAdicionales: `Producto creado: ${nombre} - Stock inicial: ${stock_actual}`
        });

        invalidate('productos:*');
        
        res.json({ success: true, message: "Producto agregado correctamente", data: results });
    });
};

/**
 * Buscar productos con paginación y filtros (Fase 1 Productos).
 * Query: search, pagina, porPagina, categoria_id, unidad_medida, stock (bajo | cero).
 * Respuesta: { success, data, total, pagina, porPagina }.
 */
const buscarProducto = (req, res) => {
    const searchRaw = (req.query.search && String(req.query.search).trim()) || '';
    const searchTerm = searchRaw ? `%${searchRaw}%` : '%';
    const { pagina, porPagina, offset } = parsePagination(req.query, {
        defaultPageSize: 50,
        maxPageSize: 100
    });
    const categoriaId = (req.query.categoria_id && String(req.query.categoria_id).trim()) || '';
    const unidadMedida = (req.query.unidad_medida && String(req.query.unidad_medida).trim()) || '';
    const stockFiltro = (req.query.stock && String(req.query.stock).trim().toLowerCase()) || '';

    const baseFrom = `FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN (
            SELECT pc.producto_id, SUM(pc.cantidad) AS stock_reservado
            FROM pedidos_cont pc
            JOIN pedidos ped ON ped.id = pc.pedido_id
            WHERE ped.estado = 'Exportado'
            GROUP BY pc.producto_id
        ) r ON r.producto_id = p.id`;
    const conditions = ['(p.nombre LIKE ? OR c.nombre LIKE ? OR CAST(p.id AS CHAR) LIKE ?)'];
    const params = [searchTerm, searchTerm, searchTerm];

    if (categoriaId) {
        conditions.push('p.categoria_id = ?');
        params.push(categoriaId);
    }
    if (unidadMedida) {
        conditions.push('p.unidad_medida = ?');
        params.push(unidadMedida);
    }
    if (stockFiltro === 'bajo') {
        conditions.push(`p.stock_actual < ${STOCK_THRESHOLDS.BAJO_LISTADO}`);
    } else if (stockFiltro === 'cero') {
        conditions.push('p.stock_actual = 0');
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');
    const orderLimit = 'ORDER BY p.nombre ASC';

    const countQuery = `SELECT COUNT(*) as total ${baseFrom} ${whereClause}`;
    const dataQuery = `
        SELECT p.*, c.nombre as categoria_nombre,
               COALESCE(r.stock_reservado, 0) AS stock_reservado,
               (p.stock_actual - COALESCE(r.stock_reservado, 0)) AS stock_libre
        ${baseFrom}
        ${whereClause}
        ${orderLimit}
        LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, porPagina, offset];

    db.query(countQuery, params, (errCount, countResults) => {
        if (errCount) {
            console.error('Error al contar productos:', errCount);
            return res.status(500).json({ success: false, message: 'Error al obtener los productos' });
        }
        const total = (countResults && countResults[0] && countResults[0].total) ? Number(countResults[0].total) : 0;

        db.query(dataQuery, dataParams, (err, results) => {
            if (err) {
                console.error('Error al obtener los productos:', err);
                return res.status(500).json({ success: false, message: 'Error al obtener los productos' });
            }
            res.json({
                success: true,
                data: results,
                total,
                pagina,
                porPagina
            });
        });
    });
};

const actualizarProducto = async (req, res) => {
    const productoId = req.params.id;
    const { nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual } = req.body;

    if (
        !nombre ||
        !unidad_medida ||
        !categoria_id ||
        !esNumeroValido(costo) ||
        !esNumeroValido(precio) ||
        !esNumeroValido(iva) ||
        stock_actual === undefined
    ) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    try {
        const rows = await queryPromise('SELECT * FROM productos WHERE id = ?', [productoId]);
        const datosAnteriores = rows.length > 0 ? rows[0] : null;

        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: "Producto no encontrado" });
        }

        const updateResults = await queryPromise(
            `UPDATE productos
             SET nombre = ?, unidad_medida = ?, costo = ?, precio = ?, categoria_id = ?, iva = ?, stock_actual = ?
             WHERE id = ?`,
            [nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual, productoId]
        );

        if (updateResults.affectedRows === 0) {
            return res.status(400).json({ success: false, message: "No se realizaron cambios" });
        }

        const stockAntes = parseFloat(datosAnteriores.stock_actual) || 0;
        const stockDespues = parseFloat(stock_actual) || 0;
        const cambioStock = stockDespues - stockAntes;
        const detalleStock = cambioStock !== 0
            ? ` - Cambio en stock: ${cambioStock > 0 ? '+' : ''}${cambioStock}`
            : '';

        if (cambioStock !== 0) {
            try {
                await registrarMovimientoStockPool({
                    productoId: Number(productoId),
                    delta: cambioStock,
                    stockAntes,
                    stockDespues,
                    tipoOperacion: 'AJUSTE_MANUAL',
                    referenciaTipo: 'productos',
                    referenciaId: Number(productoId),
                    usuarioId: req.user?.id ?? null,
                    usuarioNombre: req.user?.nombre ?? null,
                    observaciones: 'Actualización completa de producto'
                });
            } catch (kardexError) {
                console.warn('No se pudo registrar movimiento de stock:', kardexError.message);
            }
        }

        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'productos',
            registroId: productoId,
            datosAnteriores,
            datosNuevos: {
                id: productoId,
                ...req.body
            },
            detallesAdicionales: `Producto actualizado: ${nombre}${detalleStock}`
        });

        invalidate('productos:*');

        res.json({ success: true, message: "Producto actualizado correctamente" });
    } catch (error) {
        console.error('Error al actualizar el producto:', error);
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'productos',
            registroId: productoId,
            detallesAdicionales: `Error al actualizar producto: ${error.message}`,
            datosNuevos: req.body
        });
        res.status(500).json({ success: false, message: "Error al actualizar el producto" });
    }
};

const registrarRemito = (pedidoData, callback) => {
    const { venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre} = pedidoData;

    const registrarVentaQuery = `
        INSERT INTO remitos
        (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre)
        VALUES 
        (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const ventaValues = [venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre];

    db.query(registrarVentaQuery, ventaValues, (err, result) => {
        if (err) {
            console.error('Error al insertar el remito:', err);
            return callback(err);
        }
        callback(null, result.insertId); // Devuelve el ID del remito recién insertado
    });
};

const insertarProductos = async (remitoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad) 
        VALUES (?, ?, ?, ?, ?)
    `;

    try {
        await Promise.all(productos.map(producto => {
            const {  producto_id, producto_nombre, producto_um, cantidad } = producto;
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

const nuevoRemito = async (req, res) => {
    const {
        venta_id,
        cliente_id,
        cliente_nombre,
        cliente_condicion,
        cliente_cuit,
        cliente_telefono,
        cliente_direccion,
        cliente_ciudad,
        cliente_provincia,
        estado,
        observaciones,
        productos
    } = req.body;

    if (!Array.isArray(productos) || productos.length === 0) {
        return res.status(400).json({ success: false, message: 'El remito debe incluir productos' });
    }

    const empleado_id = req.user?.id ?? req.body.empleado_id ?? null;
    const empleado_nombre = req.user?.nombre ?? req.body.empleado_nombre ?? null;

    try {
        const remitoId = await withTransaction(async (connection) => {
            const result = await queryConn(
                connection,
                `INSERT INTO remitos
                 (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono,
                  cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre)
                 VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    venta_id,
                    cliente_id,
                    cliente_nombre,
                    cliente_condicion,
                    cliente_cuit,
                    cliente_telefono,
                    cliente_direccion,
                    cliente_ciudad,
                    cliente_provincia,
                    estado,
                    observaciones,
                    empleado_id,
                    empleado_nombre
                ]
            );

            const insertId = result.insertId;
            const insertProductoQuery = `
                INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad)
                VALUES (?, ?, ?, ?, ?)
            `;

            for (const producto of productos) {
                const { producto_id, producto_nombre, producto_um, cantidad } = producto;
                await queryConn(connection, insertProductoQuery, [
                    insertId,
                    producto_id,
                    producto_nombre,
                    producto_um,
                    cantidad
                ]);
            }

            return insertId;
        });

        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'remitos',
            registroId: remitoId,
            datosNuevos: {
                id: remitoId,
                ...req.body,
                empleado_id,
                empleado_nombre
            },
            detallesAdicionales: `Remito creado para cliente: ${cliente_nombre} - ${productos.length} productos`
        });

        res.json({ success: true, message: 'Remito y productos insertados correctamente', data: { id: remitoId } });
    } catch (error) {
        console.error('Error al crear remito:', error);
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'remitos',
            detallesAdicionales: `Error al crear remito: ${error.message}`,
            datosNuevos: req.body
        });
        return res.status(500).json({ success: false, message: 'Error al insertar el remito' });
    }
};

const obtenerStock = async (req, res) => {
   const productoId = req.params.id;
    
    try {
        console.log('🔍 Consultando stock para producto ID:', productoId);
        
        const result = await new Promise((resolve, reject) => {
            db.query(
                'SELECT id, nombre, stock_actual FROM productos WHERE id = ?', 
                [productoId], 
                (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                }
            );
        });
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Producto no encontrado' 
            });
        }
        
        const producto = result[0];
        console.log('✅ Stock encontrado:', producto.stock_actual);
        
        res.json({ 
            success: true, 
            data: { 
                stock_actual: Number(producto.stock_actual) || 0,
                nombre: producto.nombre,
                id: producto.id
            }
        });
    } catch (error) {
        console.error('❌ Error al obtener stock:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al obtener stock del producto' 
        });
    }
};


const obtenerCategorias = (req, res) => {
    const query = `
        SELECT id, nombre 
        FROM categorias 
        ORDER BY nombre ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener las categorías:', err);
            return res.status(500).json({ success: false, message: "Error al obtener las categorías" });
        }
        res.json({ success: true, data: results });
    });
};

const obtenerRemitos = async (req, res) => {
    try {
        const { pagina, porPagina, offset } = parsePagination(req.query, {
            defaultPageSize: 10,
            maxPageSize: 100
        });

        const cliente = (req.query.cliente && String(req.query.cliente).trim()) || '';
        const ciudad = (req.query.ciudad && String(req.query.ciudad).trim()) || '';
        const provincia = (req.query.provincia && String(req.query.provincia).trim()) || '';
        const estado = (req.query.estado && String(req.query.estado).trim()) || '';
        const empleado = (req.query.empleado && String(req.query.empleado).trim()) || '';
        const empleadoId = (req.query.empleadoId && String(req.query.empleadoId).trim()) || '';
        const fechaDesde = (req.query.fechaDesde && String(req.query.fechaDesde).trim()) || '';
        const fechaHasta = (req.query.fechaHasta && String(req.query.fechaHasta).trim()) || '';
        const fecha = (req.query.fecha && String(req.query.fecha).trim()) || '';

        const conditions = ['1=1'];
        const params = [];

        if (cliente) {
            conditions.push('cliente_nombre LIKE ?');
            params.push(`%${cliente}%`);
        }
        if (ciudad) {
            conditions.push('cliente_ciudad LIKE ?');
            params.push(`%${ciudad}%`);
        }
        if (provincia) {
            conditions.push('cliente_provincia LIKE ?');
            params.push(`%${provincia}%`);
        }
        if (estado) {
            conditions.push('estado = ?');
            params.push(estado);
        }
        if (empleadoId) {
            conditions.push('empleado_id = ?');
            params.push(empleadoId);
        } else if (empleado) {
            conditions.push('empleado_nombre LIKE ?');
            params.push(`%${empleado}%`);
        }
        if (fecha) {
            conditions.push('DATE(fecha) = ?');
            params.push(fecha);
        }
        if (fechaDesde) {
            conditions.push('DATE(fecha) >= ?');
            params.push(fechaDesde);
        }
        if (fechaHasta) {
            conditions.push('DATE(fecha) <= ?');
            params.push(fechaHasta);
        }

        const whereClause = conditions.join(' AND ');

        const countRows = await queryPromise(
            `SELECT COUNT(*) AS total FROM remitos WHERE ${whereClause}`,
            params
        );
        const total = Number(countRows[0]?.total) || 0;

        const remitos = await queryPromise(
            `SELECT
                id, venta_id, fecha,
                cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono,
                cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones,
                empleado_id, empleado_nombre
             FROM remitos
             WHERE ${whereClause}
             ORDER BY fecha DESC
             LIMIT ? OFFSET ?`,
            [...params, porPagina, offset]
        );

        res.json({
            success: true,
            data: {
                remitos,
                total,
                pagina,
                porPagina
            }
        });
    } catch (error) {
        console.error('Error al obtener remitos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener remitos' });
    }
};

const filtrarProductosRemito = async (req, res) => {
    const remitoId = req.params.id;

    try {
        const results = await queryPromise(
            `SELECT id, remito_id, producto_id, producto_nombre, producto_um, cantidad
             FROM detalle_remitos
             WHERE remito_id = ?`,
            [remitoId]
        );
        res.json({ success: true, data: results });
    } catch (error) {
        console.error('Error al obtener productos del remito:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener productos del remito' });
    }
};

const generarPdfRemito = async (req, res) => {
    const { remito, productos } = req.body;

    if (!remito || !Array.isArray(productos) || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    try {
        console.log('📄 Generando PDF de remito optimizado...');
        const startTime = Date.now();

        // ✅ USAR PLANTILLA HTML EXACTA
        const pdfBuffer = await pdfGenerator.generarRemito(remito, productos);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de remito generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            registroId: remito.id,
            detallesAdicionales: `PDF de remito generado optimizado en ${generationTime}ms - Cliente: ${remito.cliente_nombre}`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="REMITO_${remito.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
        
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDF:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            registroId: remito.id,
            detallesAdicionales: `Error generando PDF de remito optimizado: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar el PDF",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const generarPdfRemitosMultiples = async (req, res) => {
    const { remitosIds } = req.body;
    
    if (!remitosIds || !Array.isArray(remitosIds) || remitosIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de remito válido" });
    }

    try {
        console.log(`📄 Generando ${remitosIds.length} remitos múltiples optimizados...`);
        const startTime = Date.now();

        const documentos = [];

        for (let i = 0; i < remitosIds.length; i++) {
            let remitoId;
            
            if (typeof remitosIds[i] === 'object' && remitosIds[i] !== null) {
                remitoId = remitosIds[i].id || remitosIds[i];
            } else {
                remitoId = remitosIds[i];
            }
            
            if (!remitoId || isNaN(parseInt(remitoId))) {
                console.warn(`ID de remito inválido: ${remitoId}, continuando`);
                continue;
            }
            
            remitoId = parseInt(remitoId);
            
            try {
                const remitoRows = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM remitos WHERE id = ?', [remitoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (remitoRows.length === 0) {
                    console.warn(`Remito con ID ${remitoId} no encontrado, continuando`);
                    continue;
                }
                
                const productos = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM detalle_remitos WHERE remito_id = ?', [remitoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (productos.length === 0) {
                    console.warn(`No se encontraron productos para el remito ${remitoId}, continuando`);
                    continue;
                }
                
                documentos.push({
                    remito: remitoRows[0],
                    productos: productos
                });
                
            } catch (error) {
                console.error(`Error procesando remito ID ${remitoId}:`, error);
            }
        }
        
        if (documentos.length === 0) {
            return res.status(404).json({ error: "No se pudieron obtener datos para los remitos seleccionados" });
        }

        // ✅ USAR EL NUEVO GENERADOR OPTIMIZADO
        const pdfBuffer = await pdfGenerator.generarPDFsMultiples(documentos, 'remitos');

        const generationTime = Date.now() - startTime;
        console.log(`✅ ${documentos.length} remitos múltiples generados en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            detallesAdicionales: `PDFs múltiples de remitos generados optimizados en ${generationTime}ms - ${remitosIds.length} remitos solicitados, ${documentos.length} generados`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Remitos_Multiples_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDFs múltiples:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            detallesAdicionales: `Error generando PDFs múltiples de remitos optimizados: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar los PDFs múltiples",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


const obtenerTodosProductos = (req, res) => {
    const searchTerm = req.query.search ? `%${req.query.search}%` : '%';

    const query = `
        SELECT p.*, c.nombre as categoria_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        WHERE p.nombre LIKE ?
        ORDER BY p.stock_actual ASC, p.nombre ASC
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener todos los productos:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los productos" });
        }
        console.log(`✅ Productos obtenidos: ${results.length}`);
        res.json({ success: true, data: results });
    });
};

// Función para actualizar solo nombre, categoría y stock
const actualizarProductoBasico = async (req, res) => {
    const productoId = req.params.id;
    const { nombre, categoria_id, stock_actual, motivo_ajuste, observaciones } = req.body;

    if (!nombre || !categoria_id || stock_actual === undefined) {
        return res.status(400).json({ success: false, message: "Nombre, categoría y stock son obligatorios" });
    }

    // Validar que el stock sea un número válido
    const stockNumerico = parseFloat(stock_actual);
    if (isNaN(stockNumerico) || stockNumerico < 0) {
        return res.status(400).json({ success: false, message: "El stock debe ser un número válido mayor o igual a 0" });
    }

    // Obtener datos anteriores para auditoría
    const obtenerDatosAnterioresPromise = () => {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM productos WHERE id = ?', [productoId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
    };

    try {
        const datosAnteriores = await obtenerDatosAnterioresPromise();
        
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: "Producto no encontrado" });
        }

        // Actualizar solo los campos especificados
        const updateQuery = `
            UPDATE productos 
            SET nombre = ?, categoria_id = ?, stock_actual = ? 
            WHERE id = ?
        `;

        db.query(updateQuery, [nombre, categoria_id, stockNumerico, productoId], async (error, updateResults) => {
            if (error) {
                console.error('Error al actualizar el producto:', error);
                
                // Auditar error en actualización
                await auditarOperacion(req, {
                    accion: 'UPDATE',
                    tabla: 'productos',
                    registroId: productoId,
                    detallesAdicionales: `Error al actualizar producto básico: ${error.message}`,
                    datosAnteriores,
                    datosNuevos: req.body
                });
                
                return res.status(500).json({ success: false, message: "Error al actualizar el producto" });
            }

            if (updateResults.affectedRows === 0) {
                return res.status(400).json({ success: false, message: "No se realizaron cambios" });
            }

            // Calcular cambio en stock para detalles adicionales
            const cambioStock = stockNumerico - parseFloat(datosAnteriores.stock_actual);
            const detalleStock = cambioStock !== 0 ? ` - Cambio en stock: ${cambioStock > 0 ? '+' : ''}${cambioStock}` : '';

            if (cambioStock !== 0) {
                try {
                    await registrarMovimientoStockPool({
                        productoId: Number(productoId),
                        delta: cambioStock,
                        stockAntes: parseFloat(datosAnteriores.stock_actual),
                        stockDespues: stockNumerico,
                        tipoOperacion: 'AJUSTE_MANUAL',
                        referenciaTipo: 'productos',
                        referenciaId: Number(productoId),
                        usuarioId: req.user?.id ?? null,
                        usuarioNombre: req.user?.nombre ?? null,
                        observaciones: motivo_ajuste || observaciones || 'Actualización básica de producto'
                    });
                } catch (kardexError) {
                    console.warn('No se pudo registrar movimiento de stock:', kardexError.message);
                }
            }

            // Auditar actualización exitosa
            await auditarOperacion(req, {
                accion: 'UPDATE',
                tabla: 'productos',
                registroId: productoId,
                datosAnteriores,
                datosNuevos: { 
                    id: productoId,
                    ...req.body
                },
                detallesAdicionales: `Producto actualizado (básico): ${nombre}${detalleStock}`
            });

            // ✅ FASE 2: Invalidar caché después de actualizar
            invalidate('productos:*');

            res.json({ success: true, message: "Producto actualizado correctamente" });
        });
    } catch (error) {
        console.error('Error al obtener datos anteriores:', error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};

const eliminarProducto = async (req, res) => {
    const productoId = req.params.id;

    const checkQuery = 'SELECT * FROM productos WHERE id = ?';
    db.query(checkQuery, [productoId], async (err, results) => {
        if (err) {
            console.error('Error al verificar el producto:', err);
            return res.status(500).json({ success: false, message: "Error al verificar el producto" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Producto no encontrado" });
        }

        const datosAnteriores = results[0];

        const deleteQuery = 'DELETE FROM productos WHERE id = ?';
        db.query(deleteQuery, [productoId], async (deleteErr) => {
            if (deleteErr) {
                console.error('Error al eliminar el producto:', deleteErr);

                await auditarOperacion(req, {
                    accion: 'DELETE',
                    tabla: 'productos',
                    registroId: productoId,
                    detallesAdicionales: `Error al eliminar producto: ${deleteErr.message}`,
                    datosAnteriores
                });

                return res.status(500).json({
                    success: false,
                    message: deleteErr.code === 'ER_ROW_IS_REFERENCED_2'
                        ? "No se puede eliminar el producto porque tiene registros asociados"
                        : "Error al eliminar el producto"
                });
            }

            await auditarOperacion(req, {
                accion: 'DELETE',
                tabla: 'productos',
                registroId: productoId,
                datosAnteriores,
                detallesAdicionales: `Producto eliminado: ${datosAnteriores.nombre}`
            });

            invalidate('productos:*');

            res.json({ success: true, message: "Producto eliminado correctamente" });
        });
    });
};

/**
 * Actualiza el estado de un remito con transiciones validadas.
 * Pendiente → Activo → Entregado; cualquier estado → Cancelado (solo GERENTE).
 */
const actualizarEstadoRemito = async (req, res) => {
    const remitoId = parseInt(req.params.id, 10);
    const { estado: nuevoEstado } = req.body;

    if (!Number.isInteger(remitoId) || remitoId <= 0) {
        return res.status(400).json({ success: false, message: 'ID de remito inválido' });
    }

    const estadosValidos = ['Pendiente', 'Activo', 'Entregado', 'Cancelado'];
    if (!estadosValidos.includes(nuevoEstado)) {
        return res.status(400).json({ success: false, message: 'Estado inválido' });
    }

    try {
        const rows = await queryPromise(
            'SELECT id, estado, cliente_nombre FROM remitos WHERE id = ?',
            [remitoId]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Remito no encontrado' });
        }

        const remito = rows[0];
        const estadoActual = remito.estado;

        if (estadoActual === nuevoEstado) {
            return res.json({ success: true, message: 'El remito ya tiene ese estado', data: remito });
        }

        const esGerente = req.user?.rol === 'GERENTE';
        const transicionesPermitidas = {
            Pendiente: ['Activo', 'Entregado', 'Cancelado'],
            Activo: ['Entregado', 'Cancelado'],
            Entregado: ['Cancelado'],
            Cancelado: []
        };

        const permitidas = transicionesPermitidas[estadoActual] || [];
        if (!permitidas.includes(nuevoEstado)) {
            return res.status(422).json({
                success: false,
                message: `No se puede pasar de "${estadoActual}" a "${nuevoEstado}"`
            });
        }

        if (nuevoEstado === 'Cancelado' && !esGerente) {
            return res.status(403).json({
                success: false,
                message: 'Solo un gerente puede anular remitos'
            });
        }

        await queryPromise('UPDATE remitos SET estado = ? WHERE id = ?', [nuevoEstado, remitoId]);

        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'remitos',
            registroId: remitoId,
            datosAnteriores: { estado: estadoActual },
            datosNuevos: { estado: nuevoEstado },
            detallesAdicionales: `Remito #${remitoId} (${remito.cliente_nombre}): ${estadoActual} → ${nuevoEstado}`
        });

        res.json({
            success: true,
            message: `Estado actualizado a ${nuevoEstado}`,
            data: { id: remitoId, estado: nuevoEstado }
        });
    } catch (error) {
        console.error('Error al actualizar estado del remito:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el estado del remito' });
    }
};

/**
 * Stock reservado en pedidos activos (estado Exportado).
 */
const obtenerStockReservado = async (req, res) => {
    const productoId = parseInt(req.params.id, 10);

    if (!Number.isInteger(productoId) || productoId <= 0) {
        return res.status(400).json({ success: false, message: 'ID de producto inválido' });
    }

    try {
        const result = await new Promise((resolve, reject) => {
            db.query(
                `SELECT COALESCE(SUM(pc.cantidad), 0) AS reservado
                 FROM pedidos_cont pc
                 JOIN pedidos p ON p.id = pc.pedido_id
                 WHERE pc.producto_id = ? AND p.estado = 'Exportado'`,
                [productoId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                }
            );
        });

        const reservado = result?.length ? parseFloat(result[0].reservado) : 0;

        return res.json({
            success: true,
            data: { reservado }
        });
    } catch (error) {
        console.error('Error al obtener stock reservado:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener stock reservado' });
    }
};

/**
 * Obtiene el producto "FLETE DE HACIENDA" por nombre exacto (no LIKE).
 * Usado en Venta Directa para agregar líneas de flete personalizadas.
 * Si hay varios con nombre similar, solo devuelve el que coincide exactamente.
 */
const getProductoFleteHacienda = (req, res) => {
    const query = `
        SELECT * FROM productos
        WHERE TRIM(nombre) = ?
        LIMIT 1
    `;
    db.query(query, [NOMBRE_PRODUCTO_FLETE_HACIENDA], (err, results) => {
        if (err) {
            console.error('Error al obtener producto FLETE DE HACIENDA:', err);
            return res.status(500).json({ success: false, message: 'Error al obtener el producto de flete' });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No se encontró el producto "${NOMBRE_PRODUCTO_FLETE_HACIENDA}". Debe existir en la tabla productos con ese nombre exacto.`
            });
        }
        res.json({ success: true, data: results[0] });
    });
};

module.exports = {
    nuevoProducto,
    buscarProducto,
    getProductoFleteHacienda, 
    actualizarProducto,
    nuevoRemito,
    obtenerCategorias,
    obtenerRemitos,
    filtrarProductosRemito,
    actualizarEstadoRemito,
    generarPdfRemito,
    generarPdfRemitosMultiples,
    obtenerStock,
    obtenerStockReservado,
    actualizarProductoBasico,
    obtenerTodosProductos,
    eliminarProducto,
};