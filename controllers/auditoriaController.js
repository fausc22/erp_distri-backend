// controllers/auditoriaController.js - VERSIÓN SIN PARÁMETROS PREPARADOS
const db = require('./dbPromise');

/**
 * Función para escapar valores SQL manualmente
 */
const escapeSQL = (value) => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    
    // Para strings, escapar comillas
    return "'" + value.toString().replace(/'/g, "''") + "'";
};

/**
 * Obtener registros de auditoría - SIN PARÁMETROS PREPARADOS
 */
const obtenerAuditoria = async (req, res) => {
    try {
        console.log('🔍 Obteniendo registros de auditoría...');
        console.log('📊 Query params recibidos:', req.query);

        const {
            fecha_desde,
            fecha_hasta,
            usuario_nombre,
            accion,
            metodo_http,
            estado,
            limite = 50,
            pagina = 1
        } = req.query;

        // ✅ Query base sin parámetros
        let query = `
            SELECT 
                id, 
                fecha_hora, 
                usuario_id, 
                usuario_nombre, 
                accion, 
                tabla_afectada, 
                registro_id, 
                ip_address, 
                endpoint, 
                metodo_http, 
                estado, 
                tiempo_procesamiento,
                detalles_adicionales
            FROM auditoria 
            WHERE 1=1
        `;

        // ✅ Aplicar filtros directamente en SQL (sin parámetros)
        if (fecha_desde && fecha_desde.trim() !== '') {
            query += ` AND DATE(fecha_hora) >= ${escapeSQL(fecha_desde.trim())}`;
        }

        if (fecha_hasta && fecha_hasta.trim() !== '') {
            query += ` AND DATE(fecha_hora) <= ${escapeSQL(fecha_hasta.trim())}`;
        }

        if (usuario_nombre && usuario_nombre.trim() !== '') {
            query += ` AND usuario_nombre = ${escapeSQL(usuario_nombre.trim())}`;
        }

        if (accion && accion.trim() !== '') {
            query += ` AND accion = ${escapeSQL(accion.trim())}`;
        }

        if (metodo_http && metodo_http.trim() !== '') {
            query += ` AND metodo_http = ${escapeSQL(metodo_http.trim())}`;
        }

        if (estado && estado.trim() !== '') {
            query += ` AND estado = ${escapeSQL(estado.trim())}`;
        }

        // ✅ Ordenar y paginar SIN parámetros
        query += ` ORDER BY fecha_hora DESC`;
        
        const limiteNum = Math.min(parseInt(limite) || 50, 100);
        const paginaNum = Math.max(parseInt(pagina) || 1, 1);
        const offset = (paginaNum - 1) * limiteNum;

        query += ` LIMIT ${limiteNum}`;
        if (offset > 0) {
            query += ` OFFSET ${offset}`;
        }

        console.log('🔍 Query final SIN parámetros:', query);

        // ✅ Ejecutar SIN parámetros
        const [resultados] = await db.execute(query, []);

        // ✅ Query de conteo SIN parámetros
        let queryCount = `SELECT COUNT(*) as total FROM auditoria WHERE 1=1`;

        if (fecha_desde && fecha_desde.trim() !== '') {
            queryCount += ` AND DATE(fecha_hora) >= ${escapeSQL(fecha_desde.trim())}`;
        }

        if (fecha_hasta && fecha_hasta.trim() !== '') {
            queryCount += ` AND DATE(fecha_hora) <= ${escapeSQL(fecha_hasta.trim())}`;
        }

        if (usuario_nombre && usuario_nombre.trim() !== '') {
            queryCount += ` AND usuario_nombre = ${escapeSQL(usuario_nombre.trim())}`;
        }

        if (accion && accion.trim() !== '') {
            queryCount += ` AND accion = ${escapeSQL(accion.trim())}`;
        }

        if (metodo_http && metodo_http.trim() !== '') {
            queryCount += ` AND metodo_http = ${escapeSQL(metodo_http.trim())}`;
        }

        if (estado && estado.trim() !== '') {
            queryCount += ` AND estado = ${escapeSQL(estado.trim())}`;
        }

        const [countResult] = await db.execute(queryCount, []);
        const total = countResult[0].total;

        console.log(`✅ Registros encontrados: ${resultados.length}, Total: ${total}`);

        res.json({
            success: true,
            data: resultados,
            meta: {
                pagina_actual: paginaNum,
                total_registros: total,
                total_paginas: Math.ceil(total / limiteNum),
                registros_por_pagina: limiteNum,
                hay_mas: (paginaNum * limiteNum) < total
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo registros de auditoría:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros de auditoría',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Obtener detalle completo de un registro específico
 */
const obtenerDetalleAuditoria = async (req, res) => {
    try {
        const { id } = req.params;
        console.log('🔍 Obteniendo detalle de auditoría ID:', id);

        if (!id || isNaN(parseInt(id))) {
            return res.status(400).json({
                success: false,
                message: 'ID de registro inválido'
            });
        }

        const idNum = parseInt(id);
        const query = `
            SELECT 
                id, 
                fecha_hora, 
                usuario_id, 
                usuario_nombre, 
                accion, 
                tabla_afectada, 
                registro_id, 
                ip_address, 
                user_agent,
                endpoint, 
                metodo_http, 
                detalles_adicionales,
                estado, 
                tiempo_procesamiento
            FROM auditoria 
            WHERE id = ${idNum}
        `;

        console.log('🔍 Query detalle:', query);

        const [resultados] = await db.execute(query, []);

        if (resultados.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Registro de auditoría no encontrado'
            });
        }

        console.log('✅ Detalle de auditoría obtenido para ID:', id);

        res.json({
            success: true,
            data: resultados[0]
        });

    } catch (error) {
        console.error('❌ Error obteniendo detalle de auditoría:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener detalle de auditoría',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Obtener datos únicos para filtros
 */
const obtenerDatosFiltros = async (req, res) => {
    try {
        console.log('🔍 Obteniendo datos únicos para filtros...');

        const queryUsuarios = `
            SELECT DISTINCT usuario_nombre
            FROM auditoria 
            WHERE usuario_nombre IS NOT NULL 
            AND usuario_nombre != ''
            ORDER BY usuario_nombre ASC
            LIMIT 100
        `;

        const queryAcciones = `
            SELECT DISTINCT accion
            FROM auditoria 
            WHERE accion IS NOT NULL 
            AND accion != ''
            ORDER BY accion ASC
            LIMIT 50
        `;

        const queryMetodos = `
            SELECT DISTINCT metodo_http
            FROM auditoria 
            WHERE metodo_http IS NOT NULL 
            AND metodo_http != ''
            ORDER BY metodo_http ASC
        `;

        const [usuarios] = await db.execute(queryUsuarios, []);
        const [acciones] = await db.execute(queryAcciones, []);
        const [metodos] = await db.execute(queryMetodos, []);

        const usuariosLimpios = usuarios.map(u => u.usuario_nombre).filter(Boolean);
        const accionesLimpias = acciones.map(a => a.accion).filter(Boolean);
        const metodosLimpios = metodos.map(m => m.metodo_http).filter(Boolean);

        console.log('✅ Datos de filtros obtenidos:', {
            usuarios: usuariosLimpios.length,
            acciones: accionesLimpias.length,
            metodos: metodosLimpios.length
        });

        res.json({
            success: true,
            data: {
                usuarios: usuariosLimpios,
                acciones: accionesLimpias,
                metodos_http: metodosLimpios
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo datos para filtros:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener datos para filtros',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * NUEVA FUNCIÓN: Testing ultra simple
 */
const obtenerAuditoriaSimple = async (req, res) => {
    try {
        console.log('🔍 TEST: Obteniendo registros simples...');

        const query = `
            SELECT 
                id, 
                fecha_hora, 
                usuario_nombre, 
                accion, 
                tabla_afectada, 
                endpoint, 
                metodo_http, 
                estado
            FROM auditoria 
            ORDER BY fecha_hora DESC 
            LIMIT 10
        `;

        console.log('🔍 Query simple:', query);

        const [resultados] = await db.execute(query, []);

        console.log(`✅ TEST: ${resultados.length} registros encontrados`);

        res.json({
            success: true,
            data: resultados,
            message: `TEST exitoso: ${resultados.length} registros`,
            debug: {
                queryUsada: query,
                parametros: 'NINGUNO'
            }
        });

    } catch (error) {
        console.error('❌ TEST: Error en consulta simple:', error);
        res.status(500).json({
            success: false,
            message: 'TEST falló',
            error: error.message,
            debug: {
                errorCode: error.code,
                sqlState: error.sqlState
            }
        });
    }
};

/**
 * Obtener estadísticas básicas
 */
const obtenerEstadisticasSimples = async (req, res) => {
    try {
        console.log('📊 Obteniendo estadísticas simples...');

        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN estado = 'EXITOSO' THEN 1 END) as exitosos,
                COUNT(CASE WHEN estado = 'FALLIDO' THEN 1 END) as fallidos,
                COUNT(DISTINCT usuario_nombre) as usuarios_unicos
            FROM auditoria
        `;

        const [resultado] = await db.execute(query, []);

        console.log('✅ Estadísticas obtenidas:', resultado[0]);

        res.json({
            success: true,
            data: resultado[0]
        });

    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    obtenerAuditoria,
    obtenerDetalleAuditoria,
    obtenerDatosFiltros,
    obtenerEstadisticasSimples,
    obtenerAuditoriaSimple
};