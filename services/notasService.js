const db = require('../db/legacyAdapter');
const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');
const axios = require('axios');
const { roundFacturacion } = require('../utils/rounding');
const { registrarMovimientoStock } = require('../utils/stockMovement');
const fondosRepository = require('../repositories/fondosRepository');

const queryWithConnection = async (connection, sql, params = []) => {
    const [rows] = await connection.query(sql, params);
    return rows;
};

/**
 * ✅ OBTENER SIGUIENTE NÚMERO DE NOTA (NUMERACIÓN LOCAL)
 * 
 * Para Notas de Crédito y Débito, el punto de venta es 0004
 * y la numeración empieza en 00001
 */
const obtenerSiguienteNumeroNota = async (connection, tipoNota, tipoFiscal, puntoVenta = '0004') => {
    try {
        const puntoVentaFormateado = String(puntoVenta).padStart(4, '0');
        
        // ✅ Tipo de nota: 'NOTA_DEBITO' o 'NOTA_CREDITO'
        // ✅ Tipo fiscal: 'A', 'B' o 'X'
        // ✅ Clave única: punto_venta + tipo_nota + tipo_fiscal
        const tipoCompleto = `${tipoNota}_${tipoFiscal}`;
        
        console.log(`🔢 Obteniendo siguiente número para ${tipoNota} ${tipoFiscal} - Punto de Venta: ${puntoVentaFormateado} (LOCAL)`);
        
        // ✅ 1. VERIFICAR SI EXISTE EN control_numeracion_facturas
        // Usamos la misma tabla pero con tipo_factura = tipoCompleto
        const checkQuery = `
            SELECT ultimo_numero 
            FROM control_numeracion_facturas 
            WHERE punto_venta = ? AND tipo_factura = ?
        `;
        
        let checkResults = await queryWithConnection(connection, checkQuery, [puntoVentaFormateado, tipoCompleto]);
        
        console.log(`🔍 Número actual en BD:`, checkResults[0]?.ultimo_numero || 'No existe');
        
        // ✅ 2. SI NO EXISTE, CREARLO CON VALOR 0 (empezará en 1)
        if (!checkResults || checkResults.length === 0) {
            console.log(`⚠️ Creando control para ${tipoCompleto} en PV ${puntoVentaFormateado}...`);
            
            const insertQuery = `
                INSERT INTO control_numeracion_facturas (punto_venta, tipo_factura, ultimo_numero)
                VALUES (?, ?, 0)
            `;
            
            await queryWithConnection(connection, insertQuery, [puntoVentaFormateado, tipoCompleto]);
            console.log(`✅ Control creado - Empezará en 1`);
        }
        
        // ✅ 3. INCREMENTAR
        const updateQuery = `
            UPDATE control_numeracion_facturas 
            SET ultimo_numero = ultimo_numero + 1
            WHERE punto_venta = ? AND tipo_factura = ?
        `;
        
        await queryWithConnection(connection, updateQuery, [puntoVentaFormateado, tipoCompleto]);
        console.log(`✅ Número incrementado en BD`);
        
        // ✅ 4. OBTENER EL NUEVO NÚMERO
        const selectQuery = `
            SELECT ultimo_numero 
            FROM control_numeracion_facturas 
            WHERE punto_venta = ? AND tipo_factura = ?
            LIMIT 1
        `;
        
        const results = await queryWithConnection(connection, selectQuery, [puntoVentaFormateado, tipoCompleto]);
        
        if (!results || !results[0] || typeof results[0].ultimo_numero === 'undefined') {
            throw new Error(`No se pudo obtener el número de nota para ${tipoCompleto} en PV ${puntoVentaFormateado}`);
        }
        
        const numeroNota = results[0].ultimo_numero;
        
        // ✅ FORMATO: "0004-00001" (5 dígitos para el número, SIN tipo fiscal al inicio)
        // IMPORTANTE: Las notas NO llevan el tipo fiscal al inicio como las facturas
        const numeroCompleto = `${puntoVentaFormateado}-${String(numeroNota).padStart(5, '0')}`;
        
        console.log(`✅ Número asignado (LOCAL): ${numeroCompleto}`);
        
        return {
            numeroNota,
            numeroCompleto,
            puntoVenta: puntoVentaFormateado
        };
        
    } catch (error) {
        console.error('❌ Error obteniendo número de nota:', error);
        throw error;
    }
};

/**
 * ✅ CREAR NOTA DE DÉBITO O CRÉDITO
 * POST /notas/crear-nota
 */
const crearNota = async (req, res) => {
    const {
        tipoNota, // 'NOTA_DEBITO' o 'NOTA_CREDITO'
        ventaReferenciaId, // ID de venta de referencia (opcional)
        cliente_id,
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        cliente_ciudad,
        cliente_provincia,
        cliente_condicion,
        cliente_cuit,
        cuentaId,
        tipoFiscal, // 'A', 'B' o 'X'
        subtotalSinIva,
        ivaTotal,
        exento,
        totalConIva,
        productos,
        observaciones,
        empleado_id,
        empleado_nombre
    } = req.body;

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  📝 Creando ${tipoNota} - Tipo: ${tipoFiscal}      ║`);
    console.log(`╚══════════════════════════════════════════╝`);

    // ✅ VALIDACIONES
    if (!tipoNota || !['NOTA_DEBITO', 'NOTA_CREDITO'].includes(tipoNota)) {
        return res.status(400).json({
            success: false,
            message: 'Tipo de nota inválido. Debe ser NOTA_DEBITO o NOTA_CREDITO'
        });
    }

    if (!['A', 'B', 'X'].includes(tipoFiscal)) {
        return res.status(400).json({
            success: false,
            message: 'Tipo fiscal inválido. Debe ser A, B o X'
        });
    }

    if (!productos || productos.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Debe proporcionar al menos un producto'
        });
    }

    const productoInvalido = productos.find((producto) => {
        const nombre = (producto?.nombre || producto?.producto_nombre || '').toString().trim();
        const cantidad = parseFloat(producto?.cantidad);
        const precio = parseFloat(producto?.precio);
        const subtotal = parseFloat(producto?.subtotal);
        const iva = parseFloat(producto?.iva ?? producto?.iva_calculado ?? 0);

        return !(
            nombre &&
            Number.isFinite(cantidad) && cantidad > 0 &&
            Number.isFinite(precio) && precio >= 0 &&
            Number.isFinite(subtotal) && subtotal > 0 &&
            Number.isFinite(iva) && iva >= 0
        );
    });

    if (productoInvalido) {
        return res.status(400).json({
            success: false,
            message: 'Se detectaron líneas de productos inválidas en la nota'
        });
    }

    // ✅ Si no hay venta de referencia, debe tener cliente
    if (!ventaReferenciaId && !cliente_id) {
        return res.status(400).json({
            success: false,
            message: 'Debe proporcionar una venta de referencia o un cliente'
        });
    }

    let connection;
    try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // ✅ 1. Si hay venta de referencia, obtener datos del cliente de esa venta
            let clienteFinal = {};
            if (ventaReferenciaId) {
                const ventaQuery = `SELECT * FROM ventas WHERE id = ?`;
                const ventaResult = await queryWithConnection(connection, ventaQuery, [ventaReferenciaId]);

                if (ventaResult.length === 0) {
                    throw new Error('Venta de referencia no encontrada');
                }

                const ventaRef = ventaResult[0];
                clienteFinal = {
                    id: ventaRef.cliente_id,
                    nombre: ventaRef.cliente_nombre,
                    telefono: ventaRef.cliente_telefono,
                    direccion: ventaRef.cliente_direccion,
                    ciudad: ventaRef.cliente_ciudad,
                    provincia: ventaRef.cliente_provincia,
                    condicion: ventaRef.cliente_condicion,
                    cuit: ventaRef.cliente_cuit
                };
            } else {
                // ✅ Usar cliente proporcionado
                clienteFinal = {
                    id: cliente_id,
                    nombre: cliente_nombre,
                    telefono: cliente_telefono || '',
                    direccion: cliente_direccion || '',
                    ciudad: cliente_ciudad || '',
                    provincia: cliente_provincia || '',
                    condicion: cliente_condicion || '',
                    cuit: cliente_cuit || ''
                };
            }

            // ✅ 2. OBTENER SIGUIENTE NÚMERO DE NOTA
            const { numeroCompleto, puntoVenta } = await obtenerSiguienteNumeroNota(
                connection,
                tipoNota,
                tipoFiscal,
                '0004'
            );

            console.log(`📄 Número de nota asignado: ${numeroCompleto}`);

            // ✅ 3. Política fiscal unificada:
            // EXENTO => exento = iva_total
            // NO EXENTO => exento = 0
            const esClienteExento = clienteFinal.condicion?.toUpperCase() === 'EXENTO';

            // ✅ Redondeo para facturación: ,01–,59 mantienen; ,60–,99 suben
            const subtotalR = roundFacturacion(subtotalSinIva);
            const ivaTotalR = roundFacturacion(ivaTotal);
            const exentoR = esClienteExento ? ivaTotalR : 0;
            const totalR = roundFacturacion(totalConIva);

            // ✅ 4. CREAR LA NOTA EN LA TABLA VENTAS
            // ✅ Incluir venta_referencia_id si existe
            const notaQuery = `
                INSERT INTO ventas 
                (fecha, numero_factura, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, 
                 cliente_ciudad, cliente_provincia, cliente_condicion, cliente_cuit, 
                 cuenta_id, tipo_doc, tipo_f, venta_referencia_id, subtotal, iva_total, exento, total, estado, 
                 observaciones, empleado_id, empleado_nombre)
                VALUES 
                (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturada', ?, ?, ?)
            `;

            const notaValues = [
                numeroCompleto,  // numero_factura
                clienteFinal.id,
                clienteFinal.nombre,
                clienteFinal.telefono,
                clienteFinal.direccion,
                clienteFinal.ciudad,
                clienteFinal.provincia,
                clienteFinal.condicion,
                clienteFinal.cuit,
                cuentaId,
                tipoNota,  // tipo_doc: 'NOTA_DEBITO' o 'NOTA_CREDITO'
                tipoFiscal,
                ventaReferenciaId || null,  // ✅ ID de la venta de referencia (si existe)
                subtotalR,
                ivaTotalR,
                exentoR,
                totalR,
                observaciones || 'sin observaciones',
                empleado_id,
                empleado_nombre
            ];

            const notaResult = await queryWithConnection(connection, notaQuery, notaValues);

            const notaId = notaResult.insertId;
            console.log(`✅ Nota creada con ID: ${notaId} - Número: ${numeroCompleto}`);

            // ✅ 5. INSERTAR PRODUCTOS EN ventas_cont
            for (const producto of productos) {
                const productoQuery = `
                    INSERT INTO ventas_cont 
                    (venta_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const productoId = producto.esManual ? null : producto.id; // null para productos manuales
                const productoNombre = producto.nombre || producto.producto_nombre;
                const productoUM = producto.unidad_medida || producto.producto_um || 'Unidad';
                const cantidad = parseFloat(producto.cantidad) || 1;
                const precio = parseFloat(producto.precio) || 0;
                const iva = parseFloat(producto.iva || producto.iva_calculado) || 0;
                const subtotal = parseFloat(producto.subtotal) || 0;

                const tipoLinea = producto.esManual ? 'manual' : 'referencia';
                console.log(
                    `🧾 Línea ${tipoLinea} en nota ${numeroCompleto}: ` +
                    `${productoNombre} | cant=${cantidad} | precio=${precio} | subtotal=${subtotal} | iva=${iva}`
                );

                await queryWithConnection(
                    connection,
                    productoQuery,
                    [notaId, productoId, productoNombre, productoUM, cantidad, precio, iva, subtotal]
                );

                // Devolución de mercadería al stock solo en Nota de Crédito y líneas con producto de catálogo
                if (tipoNota === 'NOTA_CREDITO' && productoId != null) {
                    const stockRows = await queryWithConnection(
                        connection,
                        `SELECT stock_actual FROM productos WHERE id = ?`,
                        [productoId]
                    );
                    const stockAntes = stockRows?.length ? parseFloat(stockRows[0].stock_actual) : 0;

                    await queryWithConnection(
                        connection,
                        `UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?`,
                        [cantidad, productoId]
                    );

                    await registrarMovimientoStock(connection, {
                        productoId,
                        delta: cantidad,
                        stockAntes,
                        stockDespues: stockAntes + cantidad,
                        tipoOperacion: 'NOTA_CREDITO',
                        referenciaTipo: 'ventas',
                        referenciaId: notaId,
                        usuarioId: req.user?.id ?? null,
                        usuarioNombre: req.user?.nombre ?? null,
                        observaciones: `Nota de crédito #${notaId}`
                    });
                }
            }

            console.log(`✅ ${productos.length} productos insertados`);

            // ✅ 6. Si hay cuenta, registrar movimiento de fondos (trazable)
            // Nota de Débito: INGRESO (aumenta saldo)
            // Nota de Crédito: EGRESO (disminuye saldo)
            if (cuentaId) {
                const tipoMov = tipoNota === 'NOTA_DEBITO' ? 'INGRESO' : 'EGRESO';
                const montoAbs = Math.abs(parseFloat(totalR));

                await fondosRepository.obtenerCuentaPorIdForUpdate(connection, cuentaId);
                await fondosRepository.registrarMovimiento(connection, {
                    cuenta_id: cuentaId,
                    tipo: tipoMov,
                    origen: 'notas',
                    monto: montoAbs,
                    referencia_id: notaId
                });
                const delta = tipoMov === 'INGRESO' ? montoAbs : -montoAbs;
                await fondosRepository.actualizarSaldo(connection, cuentaId, delta);

                console.log(`✅ Cuenta ${cuentaId} actualizada con movimiento ${tipoMov}: ${delta > 0 ? '+' : ''}${montoAbs.toFixed(2)}`);
            }

            // ✅ 7. COMMIT
            await connection.commit();

            // ✅ AUDITAR
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'ventas',
                registroId: notaId,
                datosNuevos: {
                    tipo_doc: tipoNota,
                    numero_factura: numeroCompleto,
                    cliente_nombre: clienteFinal.nombre,
                    total: totalR
                },
                detallesAdicionales: `${tipoNota} creada - Cliente: ${clienteFinal.nombre} - Total: $${totalR}`
            });

            return res.json({
                success: true,
                message: `${tipoNota} creada exitosamente`,
                data: {
                    notaId,
                    numeroCompleto,
                    tipoNota
                }
            });
        } catch (error) {
            console.error('Error creando nota:', error);
            if (connection) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Error realizando rollback de nota:', rollbackError);
                }
            }
            return res.status(500).json({
                success: false,
                message: error.message || 'Error al crear la nota'
            });
        } finally {
            connection?.release();
        }
};

/**
 * ✅ BUSCAR VENTAS PARA REFERENCIA
 * GET /notas/buscar-ventas
 */
const buscarVentas = async (req, res) => {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
        return res.json({
            success: true,
            data: []
        });
    }

    try {
        const query = `
            SELECT 
                id, numero_factura, fecha, 
                cliente_id, cliente_nombre, cliente_cuit, cliente_condicion,
                cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia,
                tipo_doc, tipo_f, subtotal, iva_total, total
            FROM ventas
            WHERE (cliente_nombre LIKE ? OR numero_factura LIKE ?)
            AND tipo_doc = 'FACTURA'
            ORDER BY fecha DESC
            LIMIT 20
        `;

        const searchTerm = `%${q}%`;

        db.query(query, [searchTerm, searchTerm], (err, results) => {
            if (err) {
                console.error('Error buscando ventas:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Error al buscar ventas'
                });
            }

            res.json({
                success: true,
                data: results
            });
        });
    } catch (error) {
        console.error('Error en buscarVentas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al buscar ventas'
        });
    }
};

module.exports = {
    crearNota,
    buscarVentas,
    obtenerSiguienteNumeroNota
};
