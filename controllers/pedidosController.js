const db = require('./db');
const axios = require('axios');
const dotenv = require('dotenv');

const multer = require('multer');

const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const pdfGenerator = require('../utils/pdfGenerator');
const { roundFacturacion } = require('../utils/rounding');

// ✅ FUNCIÓN PARA GENERAR HASH ÚNICO DEL PEDIDO (IDEMPOTENCIA)
const generarHashPedido = (pedidoData) => {
    try {
        // Normalizar datos para hash consistente
        const datosNormalizados = {
            cliente_id: pedidoData.cliente_id,
            subtotal: parseFloat(pedidoData.subtotal || 0).toFixed(2),
            iva_total: parseFloat(pedidoData.iva_total || 0).toFixed(2),
            total: parseFloat(pedidoData.total || 0).toFixed(2),
            empleado_id: pedidoData.empleado_id || 1,
            fecha: new Date().toISOString().split('T')[0],
            // Productos ordenados por ID para consistencia (alineado con frontend/utils/pedidoHash.js)
            productos: (pedidoData.productos || []).map(p => ({
                id: p.id,
                cantidad: parseFloat(p.cantidad || 0),
                precio: parseFloat(p.precio || 0).toFixed(2),
                subtotal: parseFloat(p.subtotal || 0).toFixed(2),
                descuento_porcentaje: parseFloat(p.descuento_porcentaje || 0).toFixed(2)
            })).sort((a, b) => a.id - b.id)
        };

        const stringPedido = JSON.stringify(datosNormalizados);
        
        // Generar hash simple pero efectivo
        let hash = 0;
        for (let i = 0; i < stringPedido.length; i++) {
            const char = stringPedido.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        const fechaHoy = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const hashFinal = `ped_${Math.abs(hash).toString(36)}_${fechaHoy}`;
        
        return hashFinal;
    } catch (error) {
        console.error('❌ Error generando hash del pedido:', error);
        return null;
    }
};

// ✅ FUNCIÓN PARA VERIFICAR DUPLICADOS POR HASH
const verificarPedidoDuplicado = async (hashPedido) => {
    return new Promise((resolve, reject) => {
        if (!hashPedido) {
            return resolve(null);
        }

        // Buscar pedido con el mismo hash en los últimos 7 días
        const query = `
            SELECT id, fecha, cliente_nombre, total, estado
            FROM pedidos
            WHERE hash_pedido = ?
            AND fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY fecha DESC
            LIMIT 1
        `;

        db.query(query, [hashPedido], (err, results) => {
            if (err) {
                console.error('❌ Error verificando duplicado:', err);
                return resolve(null); // En caso de error, continuar (no bloquear)
            }

            if (results.length > 0) {
                console.log(`⚠️ Pedido duplicado detectado: hash ${hashPedido}, pedido ID ${results[0].id}`);
                return resolve(results[0]);
            }

            return resolve(null);
        });
    });
};

// ✅ HELPERS FASE 2: metadata offline + control de edición segura
const getOfflineMeta = (req) => {
    const bodyMeta = req.body?.__offline_meta || {};
    const headerOpId = req.headers['x-offline-op-id'];
    return {
        op_id: bodyMeta.op_id || headerOpId || null,
        client_ts: bodyMeta.client_ts || null,
        base_version: bodyMeta.base_version || null
    };
};

const getPedidoById = (pedidoId) => {
    return new Promise((resolve, reject) => {
        db.query(
            'SELECT id, estado, empleado_id, cliente_nombre FROM pedidos WHERE id = ? LIMIT 1',
            [pedidoId],
            (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            }
        );
    });
};

const canEditPedido = (pedido, user) => {
    if (!pedido) {
        return { allowed: false, status: 404, code: 'PEDIDO_NOT_FOUND', message: 'Pedido no encontrado' };
    }

    if (pedido.estado === 'Facturado' || pedido.estado === 'Anulado') {
        return {
            allowed: false,
            status: 409,
            code: 'PEDIDO_NO_EDITABLE',
            message: `No se puede editar un pedido en estado "${pedido.estado}"`
        };
    }

    if (user?.rol !== 'GERENTE' && Number(pedido.empleado_id) !== Number(user?.id)) {
        return {
            allowed: false,
            status: 403,
            code: 'PEDIDO_SIN_PERMISOS',
            message: 'No tiene permisos para editar este pedido'
        };
    }

    return { allowed: true };
};

/** Queries dentro de una transacción MySQL (misma conexión). */
const queryPromiseWithConnection = (connection, query, params) => {
    return new Promise((resolve, reject) => {
        connection.query(query, params, (err, results) => {
            if (err) {
                console.error('❌ Error en query (pedidos tx):', err.message);
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};



const buscarCliente = (req, res) => {
    const rawSearch = req.query.q || req.query.search || '';
    
    // ✅ FASE 1: Agregar límite y paginación sin cambiar formato de respuesta
    const limit = Math.min(parseInt(req.query.limit) || 100, 500); // Límite por defecto 100, máximo 500
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    
    const hasSearch = !!(rawSearch && rawSearch.trim() !== '');
    const searchTerm = `%${rawSearch}%`;
    const whereClause = hasSearch ? 'WHERE nombre LIKE ?' : '';
    const whereParams = hasSearch ? [searchTerm] : [];

    const queryCount = `SELECT COUNT(*) as total FROM clientes ${whereClause}`;
    const queryData = `
        SELECT * FROM clientes
        ${whereClause}
        ORDER BY nombre ASC
        LIMIT ? OFFSET ?
    `;

    db.query(queryCount, whereParams, (countErr, countRows) => {
        if (countErr) {
            console.error('Error al contar clientes:', countErr);
            return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
        }

        const total = Number(countRows?.[0]?.total || 0);
        const hasMore = offset + limit < total;
        const dataParams = [...whereParams, limit, offset];

        db.query(queryData, dataParams, (err, results) => {
            if (err) {
                console.error('Error al obtener los clientes:', err);
                return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
            }
            console.log(`🔍 Búsqueda clientes "${rawSearch}": ${results.length}/${total} resultados (límite: ${limit}, offset: ${offset})`);
            res.json({
                success: true,
                data: results,
                total,
                limit,
                offset,
                hasMore
            });
        });
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
 * Actualiza stock de forma atómica (evita lost-update entre lecturas concurrentes).
 * @param {object|null} connection Conexión de transacción; si es null usa el pool global.
 */
const actualizarStockProducto = (productoId, cantidadCambio, motivo = 'pedido', connection = null) => {
    return new Promise((resolve, reject) => {
        const runner = connection || db;
        const delta = parseFloat(cantidadCambio);

        if (Number.isNaN(delta)) {
            return reject(new Error(`Cantidad de stock inválida para producto ${productoId}`));
        }

        if (delta < 0) {
            const sql = `
                UPDATE productos
                SET stock_actual = stock_actual + ?
                WHERE id = ? AND stock_actual + ? >= 0
            `;
            runner.query(sql, [delta, productoId, delta], (err, result) => {
                if (err) {
                    console.error(`Error al actualizar stock (atómico) producto ${productoId}:`, err);
                    return reject(err);
                }
                if (!result || result.affectedRows === 0) {
                    runner.query(
                        `SELECT id, stock_actual FROM productos WHERE id = ?`,
                        [productoId],
                        (err2, rows) => {
                            if (err2) return reject(err2);
                            if (!rows || rows.length === 0) {
                                return reject(new Error(`Producto ${productoId} no encontrado`));
                            }
                            const stockActual = rows[0].stock_actual;
                            return reject(
                                new Error(`Stock insuficiente. Stock disponible: ${stockActual}`)
                            );
                        }
                    );
                    return;
                }
                console.log(
                    `✅ Stock actualizado (atómico) - Producto: ${productoId}, Cambio: ${delta}, Motivo: ${motivo}`
                );
                resolve(result);
            });
            return;
        }

        const sqlInc = `UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?`;
        runner.query(sqlInc, [delta, productoId], (err, result) => {
            if (err) {
                console.error(`Error al incrementar stock producto ${productoId}:`, err);
                return reject(err);
            }
            if (!result || result.affectedRows === 0) {
                runner.query(`SELECT id FROM productos WHERE id = ?`, [productoId], (err2, rows) => {
                    if (err2) return reject(err2);
                    if (!rows || rows.length === 0) {
                        return reject(new Error(`Producto ${productoId} no encontrado`));
                    }
                    return reject(new Error(`No se pudo actualizar stock del producto ${productoId}`));
                });
                return;
            }
            console.log(
                `✅ Stock incrementado - Producto: ${productoId}, Cambio: +${delta}, Motivo: ${motivo}`
            );
            resolve(result);
        });
    });
};

const INSERT_PEDIDO_QUERY = `
        INSERT INTO pedidos 
        (cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad, 
         cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, exento, total, 
         estado, observaciones, empleado_id, empleado_nombre, hash_pedido)
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

/** Inserta cabecera de pedido (pool o conexión en transacción). Devuelve insertId. */
const insertPedidoCabecera = async (connection, pedidoData, hashPedido = null) => {
    const {
        cliente_id,
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        cliente_ciudad,
        cliente_provincia,
        cliente_condicion,
        cliente_cuit,
        subtotal,
        iva_total,
        exento,
        total,
        estado,
        empleado_id,
        empleado_nombre,
        observaciones
    } = pedidoData;

    let exentoFinal = 0;
    if (exento !== null && exento !== undefined && exento !== '') {
        const exentoNum = parseFloat(exento);
        exentoFinal = isNaN(exentoNum) ? 0 : exentoNum;
    }
    exentoFinal = Number(exentoFinal);

    const subtotalR = roundFacturacion(subtotal);
    const ivaTotalR = roundFacturacion(iva_total);
    const exentoR = roundFacturacion(exentoFinal);
    const totalR = roundFacturacion(total);

    const pedidoValues = [
        cliente_id,
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        cliente_ciudad,
        cliente_provincia,
        cliente_condicion,
        cliente_cuit,
        subtotalR,
        ivaTotalR,
        exentoR,
        totalR,
        estado,
        observaciones,
        empleado_id,
        empleado_nombre,
        hashPedido || null
    ];

    const result = await queryPromiseWithConnection(connection, INSERT_PEDIDO_QUERY, pedidoValues);
    return result.insertId;
};

// Función para registrar un pedido en la tabla principal (compatibilidad; usa pool sin transacción explícita)
const registrarPedido = (pedidoData, callback, hashPedido = null) => {
    insertPedidoCabecera(db, pedidoData, hashPedido)
        .then((insertId) => {
            console.log(`✅ Pedido insertado con ID: ${insertId}`);
            callback(null, insertId);
        })
        .catch((err) => {
            console.error('❌ Error al insertar el pedido:', err);
            callback(err);
        });
};

// Inserta líneas y descuenta stock en la misma conexión (transacción).
const insertarProductosPedido = async (pedidoId, productos, connection) => {
    const insertProductoQuery = `
        INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal, descuento_porcentaje) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const producto of productos) {
        const { id, nombre, unidad_medida, cantidad, precio, iva, subtotal, descuento_porcentaje } = producto;
        const productoValues = [
            pedidoId,
            id,
            nombre,
            unidad_medida,
            cantidad,
            precio,
            iva,
            subtotal,
            descuento_porcentaje || 0
        ];

        await queryPromiseWithConnection(connection, insertProductoQuery, productoValues);
        await actualizarStockProducto(id, -cantidad, 'nuevo_pedido', connection);
    }
};

// Endpoint para registrar nuevo pedido CON IDEMPOTENCIA
const nuevoPedido = async (req, res) => {
    const { 
        cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
        cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
        subtotal, iva_total, exento, total, estado, empleado_id, empleado_nombre, 
        observaciones, productos, hash_pedido 
    } = req.body;

    console.log('📋 Datos recibidos para nuevo pedido:', req.body);
    console.log('🔍 Exento recibido del frontend:', exento);
    console.log('🔍 Cliente condición:', cliente_condicion);
    console.log('🔍 Hash del pedido recibido:', hash_pedido);

    if (!productos || productos.length === 0) {
        return res.status(400).json({ success: false, message: 'Debe incluir al menos un producto' });
    }

    // ✅ GENERAR O USAR HASH DEL PEDIDO PARA IDEMPOTENCIA
    let hashPedidoFinal = hash_pedido;
    if (!hashPedidoFinal) {
        // Si no viene del frontend, generarlo en el backend
        hashPedidoFinal = generarHashPedido({
            cliente_id,
            subtotal,
            iva_total,
            total,
            empleado_id,
            productos
        });
        console.log(`🔐 Hash generado en backend: ${hashPedidoFinal}`);
    }

    // ✅ VERIFICAR DUPLICADOS ANTES DE INSERTAR
    const pedidoDuplicado = await verificarPedidoDuplicado(hashPedidoFinal);
    if (pedidoDuplicado) {
        console.log(`⚠️ Pedido duplicado detectado, retornando pedido existente ID: ${pedidoDuplicado.id}`);
        
        // Auditar detección de duplicado
        await auditarOperacion(req, {
            accion: 'DUPLICATE_DETECTED',
            tabla: 'pedidos',
            registroId: pedidoDuplicado.id,
            detallesAdicionales: `Intento de duplicar pedido detectado - Hash: ${hashPedidoFinal} - Pedido existente: ID ${pedidoDuplicado.id} - Cliente: ${pedidoDuplicado.cliente_nombre}`
        });

        return res.json({ 
            success: true, 
            message: 'Este pedido ya fue registrado anteriormente',
            pedidoId: pedidoDuplicado.id,
            existing: true, // ✅ INDICADOR DE DUPLICADO
            data: pedidoDuplicado
        });
    }

    // ✅ Política fiscal: EXENTO informa IVA contenido; no EXENTO informa 0.
    // No afecta precio final (total), solo el campo fiscal exento.
    const esClienteExento = cliente_condicion?.toUpperCase() === 'EXENTO';
    const ivaTotalNumerico = Number(iva_total);
    const montoExentoFinal = esClienteExento && Number.isFinite(ivaTotalNumerico)
        ? parseFloat(ivaTotalNumerico.toFixed(2))
        : 0;
    
    console.log(`🔍 Cliente es exento: ${esClienteExento}`);
    console.log(`💰 IVA total recibido: ${iva_total}`);
    console.log(`💾 Preparando para guardar pedido:`);
    console.log(`   - Cliente: ${cliente_nombre}`);
    console.log(`   - Condición: ${cliente_condicion}`);
    console.log(`   - Es exento: ${esClienteExento}`);
    console.log(`   - Monto exento a guardar: $${montoExentoFinal.toFixed(2)} (regla: EXENTO => iva_total; no EXENTO => 0)`);
    console.log(`   - Tipo de montoExentoFinal: ${typeof montoExentoFinal}`);

    const pedidoPayload = {
        cliente_id,
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        cliente_ciudad,
        cliente_provincia,
        cliente_condicion,
        cliente_cuit,
        subtotal,
        iva_total,
        exento: montoExentoFinal,
        total,
        estado: estado || 'Exportado',
        empleado_id,
        empleado_nombre,
        observaciones: observaciones || 'sin observaciones'
    };

    db.beginTransaction(async (txErr, connection) => {
        if (txErr) {
            console.error('Error iniciando transacción nuevo pedido:', txErr);
            return res.status(500).json({ success: false, message: 'Error al iniciar transacción' });
        }

        try {
            const pedidoId = await insertPedidoCabecera(connection, pedidoPayload, hashPedidoFinal);
            await insertarProductosPedido(pedidoId, productos, connection);

            await new Promise((resolve, reject) => {
                connection.commit((commitErr) => {
                    if (commitErr) reject(commitErr);
                    else resolve();
                });
            });

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

            return res.json({
                success: true,
                message: 'Pedido y productos insertados correctamente',
                pedidoId
            });
        } catch (err) {
            await new Promise((resolve) => connection.rollback(() => resolve()));

            const msg = err.message || String(err);

            if (msg.includes('Stock insuficiente')) {
                await auditarOperacion(req, {
                    accion: 'INSERT',
                    tabla: 'pedidos',
                    detallesAdicionales: `Rollback nuevo pedido (stock): ${msg}`,
                    datosNuevos: req.body
                });
                return res.status(400).json({ success: false, message: msg });
            }

            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'pedidos',
                detallesAdicionales: `Error transacción nuevo pedido: ${msg}`,
                datosNuevos: req.body
            });

            return res.status(500).json({
                success: false,
                message: 'Error al registrar el pedido'
            });
        } finally {
            connection.release();
        }
    });
};

// Obtener pedidos con paginación y filtros. Si dias=30: solo últimos 30 días. Si no se envía dias: todo el historial (o filtros).
// Query params: pagina, porPagina, empleado_id, dias, fechaDesde, fechaHasta, cliente, estado, ciudad, empleado_nombre
// Respuesta: { success, data, total, pagina, porPagina }
const obtenerPedidos = (req, res) => {
    const empleadoIdRaw = req.query.empleado_id;
    const diasRaw = req.query.dias;
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    const porPagina = Math.min(200, Math.max(10, parseInt(req.query.porPagina, 10) || 50));
    const offset = (pagina - 1) * porPagina;
    const fechaDesdeParam = (req.query.fechaDesde || '').toString().trim();
    const fechaHastaParam = (req.query.fechaHasta || '').toString().trim();
    const clienteParam = (req.query.cliente || '').toString().trim();
    const estadoParamRaw = (req.query.estado || '').toString().trim();
    const ciudadParam = (req.query.ciudad || '').toString().trim();
    const empleadoNombreParam = (req.query.empleado_nombre || '').toString().trim();

    // Normalizar estado al valor exacto del enum (Exportado, Facturado, Anulado)
    const ESTADOS_VALIDOS = ['Exportado', 'Facturado', 'Anulado'];
    const estadoParam = ESTADOS_VALIDOS.find(e => e.toLowerCase() === estadoParamRaw.toLowerCase()) || estadoParamRaw;

    let empleadoId = null;
    if (empleadoIdRaw && empleadoIdRaw !== 'null' && empleadoIdRaw !== 'undefined') {
        const num = parseInt(empleadoIdRaw, 10);
        if (!isNaN(num) && num > 0) empleadoId = num;
    }

    const usarRangoFechas = fechaDesdeParam.length > 0 || fechaHastaParam.length > 0;
    let fechaDesde = null;
    let fechaHasta = null;
    if (usarRangoFechas) {
        if (fechaDesdeParam) fechaDesde = fechaDesdeParam + ' 00:00:00';
        if (fechaHastaParam) fechaHasta = fechaHastaParam + ' 23:59:59';
    }

    let dias = parseInt(diasRaw, 10);
    const usarFiltroDias = !usarRangoFechas && diasRaw !== undefined && diasRaw !== '' && !isNaN(dias) && dias > 0;
    if (usarFiltroDias && dias > 365) dias = 365;
    if (usarFiltroDias && dias > 30) dias = 30;

    if (req.user?.rol !== 'GERENTE') {
        empleadoId = req.user?.id || empleadoId;
    }

    if (!usarRangoFechas && usarFiltroDias) {
        const from = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
        fechaDesde = from.toISOString().slice(0, 19).replace('T', ' ');
    }

    const conditions = ['1=1'];
    const queryParams = [];

    if (fechaDesde) {
        conditions.push('fecha >= ?');
        queryParams.push(fechaDesde);
    }
    if (fechaHasta) {
        conditions.push('fecha <= ?');
        queryParams.push(fechaHasta);
    }
    if (empleadoId !== null) {
        conditions.push('empleado_id = ?');
        queryParams.push(empleadoId);
    }
    if (clienteParam) {
        conditions.push('cliente_nombre LIKE ?');
        queryParams.push('%' + clienteParam + '%');
    }
    if (estadoParam) {
        conditions.push('estado = ?');
        queryParams.push(estadoParam);
    }
    if (ciudadParam) {
        conditions.push('cliente_ciudad LIKE ?');
        queryParams.push('%' + ciudadParam + '%');
    }
    if (empleadoNombreParam) {
        conditions.push('TRIM(empleado_nombre) = ?');
        queryParams.push(empleadoNombreParam);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');
    const baseQuery = 'FROM pedidos ' + whereClause;
    const countQuery = 'SELECT COUNT(*) as total FROM pedidos ' + whereClause;
    const dataQuery = `
        SELECT 
            id, fecha, 
            cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
            cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
            subtotal, iva_total, exento, total, estado, observaciones, 
            empleado_id, empleado_nombre
        FROM pedidos
        ${whereClause}
        ORDER BY fecha DESC
        LIMIT ? OFFSET ?
    `;
    const dataParams = [...queryParams, porPagina, offset];

    db.query(countQuery, queryParams, (errCount, countRows) => {
        if (errCount) {
            console.error('Error al contar pedidos:', errCount);
            return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
        }
        const total = (countRows && countRows[0] && countRows[0].total) ? countRows[0].total : 0;
        db.query(dataQuery, dataParams, (err, results) => {
            if (err) {
                console.error('Error al obtener pedidos:', err);
                return res.status(500).json({ success: false, message: 'Error al obtener pedidos' });
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

// Obtener detalle de un pedido específico
const obtenerDetallePedido = (req, res) => {
    const pedidoId = req.params.pedidoId;
    
    const queryPedido = `SELECT * FROM pedidos WHERE id = ?`;
    const queryProductos = `
        SELECT 
            pc.id, pc.pedido_id, pc.producto_id, pc.producto_nombre, pc.producto_um, 
            pc.cantidad, pc.precio, pc.IVA as iva, pc.subtotal, pc.descuento_porcentaje,
            COALESCE(p.iva, 21) as porcentaje_iva
        FROM pedidos_cont pc
        LEFT JOIN productos p ON pc.producto_id = p.id
        WHERE pc.pedido_id = ?
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

// Actualizar estado de un pedido (stock primero, luego estado; todo en una transacción)
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

    const obtenerDatosAnterioresPromise = () => {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
    };

    try {
        const datosAnteriores = await obtenerDatosAnterioresPromise();
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        const estadoActual = datosAnteriores.estado;

        const necesitaAjusteStock =
            (estadoActual !== 'Anulado' && estado === 'Anulado') ||
            (estadoActual === 'Anulado' && estado !== 'Anulado');

        db.beginTransaction(async (txErr, connection) => {
            if (txErr) {
                console.error('Error iniciando transacción actualizarEstadoPedido:', txErr);
                return res.status(500).json({ success: false, message: 'Error al iniciar transacción' });
            }

            try {
                if (necesitaAjusteStock) {
                    const productosDelPedido = await queryPromiseWithConnection(
                        connection,
                        `SELECT producto_id, cantidad FROM pedidos_cont WHERE pedido_id = ?`,
                        [pedidoId]
                    );

                    if (!productosDelPedido || productosDelPedido.length === 0) {
                        throw new Error('El pedido no tiene líneas de productos para ajustar stock');
                    }
                }

                if (estadoActual !== 'Anulado' && estado === 'Anulado') {
                    // Ajuste en bloque: devolver unidades al inventario.
                    await queryPromiseWithConnection(
                        connection,
                        `
                            UPDATE productos p
                            JOIN pedidos_cont pc ON pc.producto_id = p.id
                            SET p.stock_actual = p.stock_actual + pc.cantidad
                            WHERE pc.pedido_id = ?
                        `,
                        [pedidoId]
                    );
                } else if (estadoActual === 'Anulado' && estado !== 'Anulado') {
                    // Validar stock antes de reactivar para evitar negativos.
                    const faltantes = await queryPromiseWithConnection(
                        connection,
                        `
                            SELECT pc.producto_id, pc.cantidad, p.stock_actual
                            FROM pedidos_cont pc
                            JOIN productos p ON p.id = pc.producto_id
                            WHERE pc.pedido_id = ?
                              AND p.stock_actual < pc.cantidad
                            LIMIT 1
                        `,
                        [pedidoId]
                    );

                    if (faltantes && faltantes.length > 0) {
                        const f = faltantes[0];
                        throw new Error(
                            `Stock insuficiente para reactivar. Producto ${f.producto_id}: disponible ${f.stock_actual}, requerido ${f.cantidad}`
                        );
                    }

                    await queryPromiseWithConnection(
                        connection,
                        `
                            UPDATE productos p
                            JOIN pedidos_cont pc ON pc.producto_id = p.id
                            SET p.stock_actual = p.stock_actual - pc.cantidad
                            WHERE pc.pedido_id = ?
                        `,
                        [pedidoId]
                    );
                }

                await queryPromiseWithConnection(connection, `UPDATE pedidos SET estado = ? WHERE id = ?`, [
                    estado,
                    pedidoId
                ]);

                await new Promise((resolve, reject) => {
                    connection.commit((commitErr) => {
                        if (commitErr) reject(commitErr);
                        else resolve();
                    });
                });

                await auditarOperacion(req, {
                    accion: 'UPDATE',
                    tabla: 'pedidos',
                    registroId: pedidoId,
                    datosAnteriores,
                    datosNuevos: { ...datosAnteriores, estado },
                    detallesAdicionales: `Estado cambiado de "${estadoActual}" a "${estado}" - Cliente: ${datosAnteriores.cliente_nombre}`
                });

                return res.json({
                    success: true,
                    message: 'Estado del pedido actualizado correctamente y stock ajustado'
                });
            } catch (error) {
                await new Promise((resolve) => connection.rollback(() => resolve()));

                console.error('Error en actualizarEstadoPedido:', error);

                await auditarOperacion(req, {
                    accion: 'UPDATE',
                    tabla: 'pedidos',
                    registroId: pedidoId,
                    detallesAdicionales: `Error al actualizar estado del pedido: ${error.message}`
                });

                if (error.message && error.message.includes('Stock insuficiente')) {
                    return res.status(400).json({
                        success: false,
                        message: `No se puede reactivar el pedido: ${error.message}`
                    });
                }

                return res.status(500).json({
                    success: false,
                    message: 'Error al actualizar el estado del pedido'
                });
            } finally {
                connection.release();
            }
        });
    } catch (error) {
        console.error('Error en actualizarEstadoPedido (previo a tx):', error);
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'pedidos',
            registroId: pedidoId,
            detallesAdicionales: `Error al actualizar estado del pedido: ${error.message}`
        });
        return res.status(500).json({
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

        if (datosAnteriores.estado === 'Facturado') {
            return res.status(400).json({
                success: false,
                message:
                    'No se puede eliminar un pedido facturado. Para anular la operación emita una Nota de Crédito.'
            });
        }

        const debeRestaurarStock = datosAnteriores.estado === 'Exportado';

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

        // Solo Exportado tenía stock descontado; Anulado ya devolvió stock al anularse
        if (debeRestaurarStock && productosDelPedido.length > 0) {
            for (const producto of productosDelPedido) {
                await actualizarStockProducto(
                    producto.producto_id,
                    producto.cantidad,
                    'eliminar_pedido_completo'
                );
            }
        }

        // Auditar eliminación del pedido
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos',
            registroId: pedidoId,
            datosAnteriores,
            detallesAdicionales: `Pedido eliminado completo - Cliente: ${datosAnteriores.cliente_nombre} - Total: $${datosAnteriores.total} - ${productosDelPedido.length} productos${debeRestaurarStock ? ' - stock restaurado' : ' - sin ajuste de stock (estado no Exportado)'}`
        });

        res.json({ 
            success: true, 
            message: debeRestaurarStock
                ? 'Pedido eliminado correctamente y stock restaurado para todos los productos'
                : 'Pedido eliminado correctamente'
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
    const offlineMeta = getOfflineMeta(req);
    
    try {
        const datosAnteriores = await new Promise((resolve, reject) => {
            db.query('SELECT * FROM pedidos WHERE id = ?', [pedidoId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
        }

        const permiso = canEditPedido(datosAnteriores, req.user);
        if (!permiso.allowed) {
            return res.status(permiso.status).json({
                success: false,
                message: permiso.message,
                code: permiso.code,
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
            detallesAdicionales: `Observaciones actualizadas - Cliente: ${datosAnteriores.cliente_nombre}${offlineMeta.op_id ? ` - OfflineOp: ${offlineMeta.op_id}` : ''}`
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
    const offlineMeta = getOfflineMeta(req);

    if (!producto_id || !cantidad || cantidad <= 0) {
        return res.status(400).json({
            success: false,
            message: "Producto ID y cantidad son requeridos, y la cantidad debe ser mayor a 0"
        });
    }

    try {
        const pedido = await getPedidoById(pedidoId);
        const permiso = canEditPedido(pedido, req.user);
        if (!permiso.allowed) {
            return res.status(permiso.status).json({
                success: false,
                message: permiso.message,
                code: permiso.code
            });
        }

        const ivaFinal = iva;

        const queryInsert = `
            INSERT INTO pedidos_cont (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const insertValues = [
            pedidoId,
            producto_id,
            producto_nombre,
            producto_um,
            cantidad,
            precio,
            ivaFinal,
            subtotal
        ];

        const insertResultTx = await new Promise((resolve, reject) => {
            db.beginTransaction(async (txErr, connection) => {
                if (txErr) return reject(txErr);
                try {
                    const stockRows = await queryPromiseWithConnection(
                        connection,
                        `SELECT stock_actual FROM productos WHERE id = ?`,
                        [producto_id]
                    );
                    if (!stockRows || stockRows.length === 0) {
                        throw new Error(`Producto ${producto_id} no encontrado`);
                    }
                    const stockDisp = parseFloat(stockRows[0].stock_actual);
                    if (stockDisp < parseFloat(cantidad)) {
                        throw new Error(
                            `Stock insuficiente. Stock disponible: ${stockDisp}, solicitado: ${cantidad}`
                        );
                    }

                    const insertResult = await queryPromiseWithConnection(
                        connection,
                        queryInsert,
                        insertValues
                    );

                    await actualizarStockProducto(
                        producto_id,
                        -cantidad,
                        'agregar_producto_pedido',
                        connection
                    );

                    const totalesActualizados = await recalcularYActualizarTotalesPedido(
                        pedidoId,
                        null,
                        connection
                    );

                    await new Promise((res, rej) =>
                        connection.commit((e) => (e ? rej(e) : res()))
                    );

                    resolve({ insertResult, totalesActualizados });
                } catch (e) {
                    await new Promise((r) => connection.rollback(() => r()));
                    reject(e);
                } finally {
                    connection.release();
                }
            });
        });

        const insertResult = insertResultTx.insertResult;
        const totalesActualizados = insertResultTx.totalesActualizados;

        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'pedidos_cont',
            registroId: insertResult.insertId,
            datosNuevos: {
                id: insertResult.insertId,
                pedido_id: pedidoId,
                ...req.body
            },
            detallesAdicionales: `Producto agregado al pedido ${pedidoId}: ${producto_nombre} x${cantidad} - Nuevos totales: $${totalesActualizados.total}${offlineMeta.op_id ? ` - OfflineOp: ${offlineMeta.op_id}` : ''}`
        });

        res.json({
            success: true,
            message: 'Producto agregado correctamente, stock y totales actualizados',
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

        if (error.message && error.message.includes('Stock insuficiente')) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error al agregar el producto al pedido'
        });
    }
};

// Actualizar producto de un pedido
const actualizarProductoPedido = async (req, res) => {
    const { cantidad, precio, iva, subtotal, descuento_porcentaje, producto_nombre } = req.body;
    const productId = req.params.productId;
    const offlineMeta = getOfflineMeta(req);

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

        const pedido = await getPedidoById(pedidoId);
        const permiso = canEditPedido(pedido, req.user);
        if (!permiso.allowed) {
            return res.status(permiso.status).json({
                success: false,
                message: permiso.message,
                code: permiso.code
            });
        }

        let ivaFinal = iva;

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

        const nombreFinal = producto_nombre || datosAnteriores.producto_nombre;

        const queryActualizar = `
            UPDATE pedidos_cont
            SET cantidad = ?, precio = ?, IVA = ?, subtotal = ?, descuento_porcentaje = ?, producto_nombre = ?
            WHERE id = ?
        `;

        const totalesActualizados = await new Promise((resolve, reject) => {
            db.beginTransaction(async (txErr, connection) => {
                if (txErr) return reject(txErr);
                try {
                    if (diferenciaCantidad > 0) {
                        const stockRows = await queryPromiseWithConnection(
                            connection,
                            `SELECT stock_actual FROM productos WHERE id = ?`,
                            [productoId]
                        );
                        if (!stockRows || stockRows.length === 0) {
                            throw new Error('Producto no encontrado');
                        }
                        const stockActual = parseFloat(stockRows[0].stock_actual);
                        if (stockActual < diferenciaCantidad) {
                            throw new Error(
                                `Stock insuficiente. Stock disponible: ${stockActual}, necesitas: ${diferenciaCantidad} adicionales`
                            );
                        }
                    }

                    const updResult = await queryPromiseWithConnection(connection, queryActualizar, [
                        cantidad,
                        precio,
                        ivaFinal,
                        subtotal,
                        descuentoFinal,
                        nombreFinal,
                        productId
                    ]);
                    if (!updResult || updResult.affectedRows === 0) {
                        throw new Error('Producto no encontrado');
                    }

                    if (diferenciaCantidad !== 0) {
                        await actualizarStockProducto(
                            productoId,
                            -diferenciaCantidad,
                            'actualizar_cantidad_pedido',
                            connection
                        );
                    }

                    const totales = await recalcularYActualizarTotalesPedido(pedidoId, null, connection);

                    await new Promise((res, rej) =>
                        connection.commit((e) => (e ? rej(e) : res()))
                    );
                    resolve(totales);
                } catch (e) {
                    await new Promise((r) => connection.rollback(() => r()));
                    reject(e);
                } finally {
                    connection.release();
                }
            });
        });

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
                descuento_porcentaje: descuentoFinal,
                producto_nombre: nombreFinal
            },
            detallesAdicionales: `Producto actualizado por ${tipoOperacion} ${req.user?.nombre || 'Desconocido'} en pedido ${pedidoId}: ${datosAnteriores.producto_nombre}${nombreFinal !== datosAnteriores.producto_nombre ? ` → ${nombreFinal}` : ''} - Cantidad: ${cantidadAnterior} → ${cantidad} - Precio: ${datosAnteriores.precio} → ${precio}${descuentoFinal > 0 ? ` - Descuento: ${descuentoFinal}%` : ''} - Nuevos totales: ${totalesActualizados.total}${offlineMeta.op_id ? ` - OfflineOp: ${offlineMeta.op_id}` : ''}`
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
        
        if (error.message && error.message.includes('Stock insuficiente')) {
            return res.status(400).json({ 
                success: false,
                message: error.message
            });
        }

        if (error.message === 'Producto no encontrado') {
            return res.status(404).json({
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
    const offlineMeta = getOfflineMeta(req);

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
        const pedido = await getPedidoById(pedidoId);
        const permiso = canEditPedido(pedido, req.user);
        if (!permiso.allowed) {
            return res.status(permiso.status).json({
                success: false,
                message: permiso.message,
                code: permiso.code
            });
        }

        const queryEliminar = `DELETE FROM pedidos_cont WHERE id = ?`;

        const totalesActualizados = await new Promise((resolve, reject) => {
            db.beginTransaction(async (txErr, connection) => {
                if (txErr) return reject(txErr);
                try {
                    const delRes = await queryPromiseWithConnection(connection, queryEliminar, [productId]);
                    if (!delRes || delRes.affectedRows === 0) {
                        throw new Error('Producto en pedido no encontrado');
                    }

                    await actualizarStockProducto(
                        datosProducto.producto_id,
                        datosProducto.cantidad,
                        'eliminar_producto_pedido',
                        connection
                    );

                    const totales = await recalcularYActualizarTotalesPedido(pedidoId, null, connection);

                    await new Promise((res, rej) =>
                        connection.commit((e) => (e ? rej(e) : res()))
                    );
                    resolve(totales);
                } catch (e) {
                    await new Promise((r) => connection.rollback(() => r()));
                    reject(e);
                } finally {
                    connection.release();
                }
            });
        });

        // Auditar eliminación del producto
        await auditarOperacion(req, {
            accion: 'DELETE',
            tabla: 'pedidos_cont',
            registroId: productId,
            datosAnteriores: datosProducto,
            detallesAdicionales: `Producto eliminado del pedido ${pedidoId}: ${datosProducto.producto_nombre} x${datosProducto.cantidad} - Nuevos totales: $${totalesActualizados.total}${offlineMeta.op_id ? ` - OfflineOp: ${offlineMeta.op_id}` : ''}`
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

        if (error.message === 'Producto en pedido no encontrado') {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }
        
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

// ✅ GENERAR PDFs MÚLTIPLES DE NOTAS DE PEDIDO (misma lógica que el PDF individual: multipágina + placeholders)
const generarPdfNotasPedidoMultiples = async (req, res) => {
    const { pedidosIds } = req.body;
    
    if (!pedidosIds || !Array.isArray(pedidosIds) || pedidosIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de pedido válido" });
    }

    let PDFDocument;
    try {
        ({ PDFDocument } = require('pdf-lib'));
    } catch (e) {
        console.error('❌ Dependencia faltante: pdf-lib');
        return res.status(500).json({
            error: "Falta dependencia para impresión múltiple",
            details: "Instalar 'pdf-lib' en el backend y reiniciar el servicio"
        });
    }

    try {
        console.log(`📄 Iniciando generación de ${pedidosIds.length} notas de pedido múltiples...`);
        const startTime = Date.now();
        const pdfBuffers = [];

        for (const pedidoId of pedidosIds) {
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
                const pdfBufferIndividual = await pdfGenerator.generarNotaPedido(pedido, productos);
                pdfBuffers.push(pdfBufferIndividual);
                console.log(`✅ PDF generado para pedido ID ${pedidoId}`);
            } catch (error) {
                console.error(`❌ Error procesando pedido ID ${pedidoId}:`, error);
            }
        }

        if (pdfBuffers.length === 0) {
            return res.status(404).json({ 
                error: "No se pudieron generar PDFs para las notas de pedido seleccionadas"
            });
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
        console.log(`🎉 ${pdfBuffers.length} notas de pedido generadas y combinadas en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'pedidos',
            detallesAdicionales: `PDFs múltiples generados: ${pdfBuffers.length} notas de pedido combinadas`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Notas_Pedidos_Multiples_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);
        
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
    // Consulta optimizada para ciudades, clientes y empleados únicos desde TODOS los pedidos
    const queryCiudades = `
        SELECT DISTINCT cliente_ciudad AS valor FROM pedidos
        WHERE cliente_ciudad IS NOT NULL AND TRIM(cliente_ciudad) != '' AND cliente_ciudad != 'No especificada'
        ORDER BY cliente_ciudad ASC
        LIMIT 150
    `;
    const queryClientes = `
        SELECT DISTINCT cliente_nombre AS valor FROM pedidos
        WHERE cliente_nombre IS NOT NULL AND TRIM(cliente_nombre) != '' AND cliente_nombre != 'Cliente no especificado'
        ORDER BY cliente_nombre ASC
        LIMIT 300
    `;
    const queryEmpleados = `
        SELECT DISTINCT empleado_nombre AS valor FROM pedidos
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
 * Sugerencias para autocomplete: busca en TODOS los pedidos por tipo (cliente, ciudad, empleado).
 * Query params: tipo (cliente|ciudad|empleado), q (texto). Limita a 25 resultados.
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
        SELECT DISTINCT ${columna} AS valor FROM pedidos
        WHERE ${columna} IS NOT NULL AND TRIM(${columna}) != ''
        AND (${columna} LIKE ?)
        ORDER BY ${columna} ASC
        LIMIT 25
    `;
    db.query(query, [term], (err, rows) => {
        if (err) {
            console.error('Error en sugerencias filtros pedidos:', err);
            return res.status(500).json({ success: false, message: 'Error al buscar sugerencias' });
        }
        const valores = (rows || []).map(r => r.valor);
        res.json({ success: true, data: valores });
    });
};

const recalcularYActualizarTotalesPedido = async (
    pedidoId,
    condicionIvaCliente = null,
    connection = null
) => {
    const execSql = (sql, params = []) =>
        new Promise((resolve, reject) => {
            const runner = connection || db;
            runner.query(sql, params, (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

    let condicionParaExento = condicionIvaCliente;
    if (!condicionParaExento) {
        const pedidoRows = await execSql(
            'SELECT cliente_condicion FROM pedidos WHERE id = ?',
            [pedidoId]
        );
        condicionParaExento = pedidoRows[0]?.cliente_condicion || null;
    }

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

    const productos = await execSql(queryProductos, [pedidoId]);

    if (productos.length === 0) {
        await execSql(
            `UPDATE pedidos SET subtotal = ?, iva_total = ?, exento = ?, total = ? WHERE id = ?`,
            [0, 0, 0, 0, pedidoId]
        );
        console.log(`💰 Totales actualizados a cero para pedido ${pedidoId}`);
        return { subtotal: 0, iva_total: 0, exento: 0, total: 0 };
    }

    if (condicionIvaCliente) {
        console.log(
            `🔄 Recalculando IVA comercial para ${productos.length} productos. Condición cliente: ${condicionIvaCliente}`
        );

        for (const producto of productos) {
            const subtotal = parseFloat(producto.subtotal) || 0;
            const porcentajeIva = parseFloat(producto.porcentaje_iva) || 21;
            const nuevoIva = parseFloat((subtotal * (porcentajeIva / 100)).toFixed(2));
            await execSql('UPDATE pedidos_cont SET IVA = ? WHERE id = ?', [nuevoIva, producto.id]);
        }
    }

    const sumRows = await execSql(
        'SELECT SUM(subtotal) as subtotal_total, SUM(IVA) as iva_total FROM pedidos_cont WHERE pedido_id = ?',
        [pedidoId]
    );

    const subtotalTotal = parseFloat(sumRows[0].subtotal_total) || 0;
    const ivaTotal = parseFloat(sumRows[0].iva_total) || 0;
    const total = subtotalTotal + ivaTotal;

    const esClienteExento = condicionParaExento && condicionParaExento.toUpperCase() === 'EXENTO';
    const montoExento = esClienteExento ? ivaTotal : 0;

    const subtotalR = roundFacturacion(subtotalTotal);
    const ivaTotalR = roundFacturacion(ivaTotal);
    const exentoR = roundFacturacion(montoExento);
    const totalR = roundFacturacion(total);

    await execSql(
        `UPDATE pedidos SET subtotal = ?, iva_total = ?, exento = ?, total = ? WHERE id = ?`,
        [subtotalR, ivaTotalR, exentoR, totalR, pedidoId]
    );

    console.log(
        `💰 Totales recalculados para pedido ${pedidoId}: Subtotal=${subtotalR}, IVA=${ivaTotalR}, Exento=${exentoR}, Total=${totalR} (redondeados)`
    );
    return {
        subtotal: subtotalR,
        iva_total: ivaTotalR,
        exento: exentoR,
        total: totalR
    };
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

        // ✅ Catálogo PWA: stock_real + stock_minimo + disponible para modo offline (buffer)
        const queryProductos = `
            SELECT id, nombre, unidad_medida, precio, iva, stock_minimo,
                   GREATEST(0, stock_actual - COALESCE(stock_minimo, 0)) AS stock_disponible_offline,
                   stock_actual
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
    obtenerSugerenciasFiltros,

    obtenerCatalogoCompleto,
    verificarVersionCatalogo,
    actualizarClientePedido
};