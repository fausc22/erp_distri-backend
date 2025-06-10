
const db = require('./dbPromise');

/**
 * Obtener registros de auditoría con filtros
 */
const obtenerAuditoria = async (req, res) => {
    try {
        const {
            fecha_desde,
            fecha_hasta,
            usuario_id,
            accion,
            tabla,
            estado,
            limite = 100,
            pagina = 1
        } = req.query;

        let query = `
            SELECT 
                id, fecha_hora, usuario_id, usuario_nombre, accion, 
                tabla_afectada, registro_id, ip_address, endpoint, 
                metodo_http, estado, tiempo_procesamiento, detalles_adicionales
            FROM auditoria 
            WHERE 1=1
        `;
        
        const params = [];

        // Aplicar filtros
        if (fecha_desde) {
            query += ` AND DATE(fecha_hora) >= ?`;
            params.push(fecha_desde);
        }

        if (fecha_hasta) {
            query += ` AND DATE(fecha_hora) <= ?`;
            params.push(fecha_hasta);
        }

        if (usuario_id) {
            query += ` AND usuario_id = ?`;
            params.push(usuario_id);
        }

        if (accion) {
            query += ` AND accion = ?`;
            params.push(accion);
        }

        if (tabla) {
            query += ` AND tabla_afectada = ?`;
            params.push(tabla);
        }

        if (estado) {
            query += ` AND estado = ?`;
            params.push(estado);
        }

        // Calcular offset para paginación
        const offset = (parseInt(pagina) - 1) * parseInt(limite);
        
        // Añadir ORDER BY y LIMIT
        query += ` ORDER BY fecha_hora DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limite), offset);

        const [resultados] = await db.execute(query, params);

        // Obtener total de registros para paginación
        let queryCount = `
            SELECT COUNT(*) as total 
            FROM auditoria 
            WHERE 1=1
        `;
        
        const paramsCount = [];
        
        if (fecha_desde) {
            queryCount += ` AND DATE(fecha_hora) >= ?`;
            paramsCount.push(fecha_desde);
        }

        if (fecha_hasta) {
            queryCount += ` AND DATE(fecha_hora) <= ?`;
            paramsCount.push(fecha_hasta);
        }

        if (usuario_id) {
            queryCount += ` AND usuario_id = ?`;
            paramsCount.push(usuario_id);
        }

        if (accion) {
            queryCount += ` AND accion = ?`;
            paramsCount.push(accion);
        }

        if (tabla) {
            queryCount += ` AND tabla_afectada = ?`;
            paramsCount.push(tabla);
        }

        if (estado) {
            queryCount += ` AND estado = ?`;
            paramsCount.push(estado);
        }

        const [countResult] = await db.execute(queryCount, paramsCount);
        const total = countResult[0].total;

        res.json({
            success: true,
            data: resultados,
            paginacion: {
                pagina_actual: parseInt(pagina),
                total_registros: total,
                total_paginas: Math.ceil(total / parseInt(limite)),
                registros_por_pagina: parseInt(limite)
            }
        });

    } catch (error) {
        console.error('Error obteniendo registros de auditoría:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros de auditoría'
        });
    }
};

/**
 * Obtener detalle completo de un registro de auditoría
 */
const obtenerDetalleAuditoria = async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT * FROM auditoria WHERE id = ?
        `;

        const [resultados] = await db.execute(query, [id]);

        if (resultados.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registro de auditoría no encontrado'
            });
        }

        const registro = resultados[0];

        // Parsear JSON si existe
        if (registro.datos_anteriores) {
            try {
                registro.datos_anteriores = JSON.parse(registro.datos_anteriores);
            } catch (e) {
                // Mantener como string si no se puede parsear
            }
        }

        if (registro.datos_nuevos) {
            try {
                registro.datos_nuevos = JSON.parse(registro.datos_nuevos);
            } catch (e) {
                // Mantener como string si no se puede parsear
            }
        }

        res.json({
            success: true,
            data: registro
        });

    } catch (error) {
        console.error('Error obteniendo detalle de auditoría:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener detalle de auditoría'
        });
    }
};

/**
 * Obtener estadísticas de auditoría
 */
const obtenerEstadisticasAuditoria = async (req, res) => {
    try {
        const { fecha_desde, fecha_hasta } = req.query;

        let condicionFecha = '';
        const params = [];

        if (fecha_desde && fecha_hasta) {
            condicionFecha = 'WHERE DATE(fecha_hora) BETWEEN ? AND ?';
            params.push(fecha_desde, fecha_hasta);
        } else if (fecha_desde) {
            condicionFecha = 'WHERE DATE(fecha_hora) >= ?';
            params.push(fecha_desde);
        } else if (fecha_hasta) {
            condicionFecha = 'WHERE DATE(fecha_hora) <= ?';
            params.push(fecha_hasta);
        }

        // Estadísticas por acción
        const queryAcciones = `
            SELECT accion, COUNT(*) as cantidad
            FROM auditoria 
            ${condicionFecha}
            GROUP BY accion
            ORDER BY cantidad DESC
        `;

        // Estadísticas por tabla
        const queryTablas = `
            SELECT tabla_afectada, COUNT(*) as cantidad
            FROM auditoria 
            ${condicionFecha}
            AND tabla_afectada IS NOT NULL
            GROUP BY tabla_afectada
            ORDER BY cantidad DESC
        `;

        // Estadísticas por usuario
        const queryUsuarios = `
            SELECT usuario_nombre, COUNT(*) as cantidad
            FROM auditoria 
            ${condicionFecha}
            AND usuario_nombre IS NOT NULL
            GROUP BY usuario_nombre
            ORDER BY cantidad DESC
            LIMIT 10
        `;

        // Estadísticas por estado
        const queryEstados = `
            SELECT estado, COUNT(*) as cantidad
            FROM auditoria 
            ${condicionFecha}
            GROUP BY estado
        `;

        // Total de registros
        const queryTotal = `
            SELECT COUNT(*) as total
            FROM auditoria 
            ${condicionFecha}
        `;

        const [resultadosAcciones] = await db.execute(queryAcciones, params);
        const [resultadosTablas] = await db.execute(queryTablas, params);
        const [resultadosUsuarios] = await db.execute(queryUsuarios, params);
        const [resultadosEstados] = await db.execute(queryEstados, params);
        const [resultadosTotal] = await db.execute(queryTotal, params);

        res.json({
            success: true,
            data: {
                total_registros: resultadosTotal[0].total,
                por_accion: resultadosAcciones,
                por_tabla: resultadosTablas,
                por_usuario: resultadosUsuarios,
                por_estado: resultadosEstados
            }
        });

    } catch (error) {
        console.error('Error obteniendo estadísticas de auditoría:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas de auditoría'
        });
    }
};

/**
 * Limpiar registros antiguos de auditoría
 */
const limpiarAuditoriaAntigua = async (req, res) => {
    try {
        const { dias = 90 } = req.body;

        if (diasInt < 30) {
            return res.status(400).json({
                success: false,
                message: 'No se pueden eliminar registros con menos de 30 días de antigüedad'
            });
        }

        const query = `
            DELETE FROM auditoria 
            WHERE fecha_hora < DATE_SUB(NOW(), INTERVAL ? DAY)
        `;

        const [resultado] = await db.execute(query, [parseInt(dias)]);

        res.json({
            success: true,
            message: `Se eliminaron ${resultado.affectedRows} registros de auditoría`,
            registros_eliminados: resultado.affectedRows
        });

    } catch (error) {
        console.error('Error limpiando auditoría antigua:', error);
        res.status(500).json({
            success: false,
            message: 'Error al limpiar registros antiguos'
        });
    }
};

/**
 * Exportar registros de auditoría
 */
const exportarAuditoria = async (req, res) => {
    try {
        const {
            fecha_desde,
            fecha_hasta,
            formato = 'json'
        } = req.query;

        let query = `
            SELECT * FROM auditoria 
            WHERE 1=1
        `;
        
        const params = [];

        if (fecha_desde) {
            query += ` AND DATE(fecha_hora) >= ?`;
            params.push(fecha_desde);
        }

        if (fecha_hasta) {
            query += ` AND DATE(fecha_hora) <= ?`;
            params.push(fecha_hasta);
        }

        query += ` ORDER BY fecha_hora DESC LIMIT 10000`; // Límite de seguridad

        const [resultados] = await db.execute(query, params);

        if (formato === 'csv') {
            // Generar CSV
            const campos = Object.keys(resultados[0] || {});
            let csv = campos.join(',') + '\n';
            
            resultados.forEach(fila => {
                const valores = campos.map(campo => {
                    let valor = fila[campo];
                    if (valor === null || valor === undefined) return '';
                    if (typeof valor === 'string' && valor.includes(',')) {
                        return `"${valor.replace(/"/g, '""')}"`;
                    }
                    return valor;
                });
                csv += valores.join(',') + '\n';
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
            res.send(csv);
        } else {
            // JSON por defecto
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="auditoria.json"');
            res.json({
                exportado_en: new Date().toISOString(),
                total_registros: resultados.length,
                filtros: { fecha_desde, fecha_hasta },
                datos: resultados
            });
        }

    } catch (error) {
        console.error('Error exportando auditoría:', error);
        res.status(500).json({
            success: false,
            message: 'Error al exportar registros de auditoría'
        });
    }
};

module.exports = {
    obtenerAuditoria,
    obtenerDetalleAuditoria,
    obtenerEstadisticasAuditoria,
    limpiarAuditoriaAntigua,
    exportarAuditoria
};