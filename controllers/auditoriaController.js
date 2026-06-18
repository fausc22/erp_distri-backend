// controllers/auditoriaController.js - VERSIÓN CORREGIDA CON PARÁMETROS SEGUROS
const db = require('../db');

/**
 * Obtener registros de auditoría - CON PARÁMETROS SEGUROS Y LIMIT/OFFSET CORREGIDOS
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

        // ✅ Arrays para construir la query dinámicamente de forma segura
        let whereConditions = [];
        let queryParams = [];

        // ✅ Query base con parámetros seguros
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

        // ✅ Aplicar filtros con parámetros preparados
        if (fecha_desde && fecha_desde.trim() !== '') {
            whereConditions.push('DATE(fecha_hora) >= ?');
            queryParams.push(fecha_desde.trim());
        }

        if (fecha_hasta && fecha_hasta.trim() !== '') {
            whereConditions.push('DATE(fecha_hora) <= ?');
            queryParams.push(fecha_hasta.trim());
        }

        if (usuario_nombre && usuario_nombre.trim() !== '') {
            whereConditions.push('usuario_nombre = ?');
            queryParams.push(usuario_nombre.trim());
        }

        if (accion && accion.trim() !== '') {
            whereConditions.push('accion = ?');
            queryParams.push(accion.trim());
        }

        if (metodo_http && metodo_http.trim() !== '') {
            whereConditions.push('metodo_http = ?');
            queryParams.push(metodo_http.trim());
        }

        if (estado && estado.trim() !== '') {
            whereConditions.push('estado = ?');
            queryParams.push(estado.trim());
        }

        // ✅ Agregar condiciones WHERE si existen
        if (whereConditions.length > 0) {
            query += ' AND ' + whereConditions.join(' AND ');
        }

        // ✅ Ordenar y paginar de forma segura - LIMIT/OFFSET VAN DIRECTO EN QUERY
        query += ` ORDER BY fecha_hora DESC`;
        
        const limiteNum = Math.min(parseInt(limite) || 50, 100);
        const paginaNum = Math.max(parseInt(pagina) || 1, 1);
        const offset = (paginaNum - 1) * limiteNum;

        // ✅ AGREGAR LIMIT Y OFFSET DIRECTAMENTE EN LA QUERY (NO COMO PARÁMETROS)
        query += ` LIMIT ${limiteNum}`;
        if (offset > 0) {
            query += ` OFFSET ${offset}`;
        }

        console.log('🔍 Query final con parámetros:', query);
        console.log('📋 Parámetros:', queryParams);

        // ✅ Ejecutar con parámetros seguros (sin limit/offset)
        const [resultados] = await db.execute(query, queryParams);

        // ✅ Query de conteo con los mismos filtros
        let queryCount = `SELECT COUNT(*) as total FROM auditoria WHERE 1=1`;
        let countParams = [...queryParams]; // Copiar los mismos parámetros

        // Reutilizar las mismas condiciones para el conteo
        if (whereConditions.length > 0) {
            queryCount += ' AND ' + whereConditions.join(' AND ');
        }

        const [countResult] = await db.execute(queryCount, countParams);
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

        // ✅ Validación de entrada
        if (!id || isNaN(parseInt(id))) {
            return res.status(400).json({
                success: false,
                message: 'ID de registro inválido'
            });
        }

        const idNum = parseInt(id);
        
        // ✅ Query con parámetro seguro
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
            WHERE id = ?
        `;

        console.log('🔍 Query detalle con parámetro:', query);

        const [resultados] = await db.execute(query, [idNum]);

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

        // ✅ Queries con límites seguros y sin parámetros (no hay entrada del usuario)
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

        // ✅ Ejecutar queries sin parámetros (son consultas fijas)
        const [usuarios] = await db.execute(queryUsuarios);
        const [acciones] = await db.execute(queryAcciones);
        const [metodos] = await db.execute(queryMetodos);

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
 * Obtener registros de auditoría con filtros avanzados
 */
const obtenerAuditoriaConFiltros = async (req, res) => {
    try {
        console.log('🔍 Obteniendo registros con filtros avanzados...');
        
        const {
            fecha_desde,
            fecha_hasta,
            usuarios = [], // Array de usuarios
            acciones = [], // Array de acciones
            metodos_http = [], // Array de métodos HTTP
            estados = [], // Array de estados
            busqueda_texto, // Búsqueda en texto libre
            limite = 50,
            pagina = 1
        } = req.body; // Usar POST para filtros complejos

        let whereConditions = [];
        let queryParams = [];

        // ✅ Query base
        let query = `
            SELECT 
                id, fecha_hora, usuario_id, usuario_nombre, accion, 
                tabla_afectada, registro_id, ip_address, endpoint, 
                metodo_http, estado, tiempo_procesamiento, detalles_adicionales
            FROM auditoria 
            WHERE 1=1
        `;

        // ✅ Filtros de fecha
        if (fecha_desde && fecha_desde.trim() !== '') {
            whereConditions.push('DATE(fecha_hora) >= ?');
            queryParams.push(fecha_desde.trim());
        }

        if (fecha_hasta && fecha_hasta.trim() !== '') {
            whereConditions.push('DATE(fecha_hora) <= ?');
            queryParams.push(fecha_hasta.trim());
        }

        // ✅ Filtros con arrays (IN clauses)
        if (usuarios && usuarios.length > 0) {
            const placeholders = usuarios.map(() => '?').join(',');
            whereConditions.push(`usuario_nombre IN (${placeholders})`);
            queryParams.push(...usuarios);
        }

        if (acciones && acciones.length > 0) {
            const placeholders = acciones.map(() => '?').join(',');
            whereConditions.push(`accion IN (${placeholders})`);
            queryParams.push(...acciones);
        }

        if (metodos_http && metodos_http.length > 0) {
            const placeholders = metodos_http.map(() => '?').join(',');
            whereConditions.push(`metodo_http IN (${placeholders})`);
            queryParams.push(...metodos_http);
        }

        if (estados && estados.length > 0) {
            const placeholders = estados.map(() => '?').join(',');
            whereConditions.push(`estado IN (${placeholders})`);
            queryParams.push(...estados);
        }

        // ✅ Búsqueda de texto libre (en múltiples campos)
        if (busqueda_texto && busqueda_texto.trim() !== '') {
            whereConditions.push(`(
                usuario_nombre LIKE ? OR 
                accion LIKE ? OR 
                tabla_afectada LIKE ? OR 
                endpoint LIKE ? OR
                detalles_adicionales LIKE ?
            )`);
            const searchTerm = `%${busqueda_texto.trim()}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // ✅ Aplicar condiciones WHERE
        if (whereConditions.length > 0) {
            query += ' AND ' + whereConditions.join(' AND ');
        }

        // ✅ Ordenar y paginar - LIMIT/OFFSET DIRECTO EN QUERY
        query += ` ORDER BY fecha_hora DESC`;
        
        const limiteNum = Math.min(parseInt(limite) || 50, 100);
        const paginaNum = Math.max(parseInt(pagina) || 1, 1);
        const offset = (paginaNum - 1) * limiteNum;

        query += ` LIMIT ${limiteNum}`;
        if (offset > 0) {
            query += ` OFFSET ${offset}`;
        }

        console.log('🔍 Query con filtros avanzados:', query);
        console.log('📋 Parámetros:', queryParams);

        const [resultados] = await db.execute(query, queryParams);

        // ✅ Conteo con los mismos filtros
        let queryCount = `SELECT COUNT(*) as total FROM auditoria WHERE 1=1`;
        
        if (whereConditions.length > 0) {
            queryCount += ' AND ' + whereConditions.join(' AND ');
        }

        const [countResult] = await db.execute(queryCount, queryParams);
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
        console.error('❌ Error en filtros avanzados:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener registros con filtros avanzados',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Obtener estadísticas básicas
 */
const obtenerEstadisticasSimples = async (req, res) => {
    try {
        console.log('📊 Obteniendo estadísticas simples...');

        // ✅ Query fija sin parámetros de usuario
        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN estado = 'EXITOSO' THEN 1 END) as exitosos,
                COUNT(CASE WHEN estado = 'FALLIDO' THEN 1 END) as fallidos,
                COUNT(DISTINCT usuario_nombre) as usuarios_unicos,
                COUNT(DISTINCT accion) as acciones_unicas,
                MIN(fecha_hora) as primera_auditoria,
                MAX(fecha_hora) as ultima_auditoria
            FROM auditoria
        `;

        const [resultado] = await db.execute(query);

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

/**
 * Testing simple para verificar conexión
 */
const obtenerAuditoriaSimple = async (req, res) => {
    try {
        console.log('🔍 TEST: Obteniendo registros simples...');

        // ✅ Query fija y segura
        const query = `
            SELECT 
                id, fecha_hora, usuario_nombre, accion, 
                tabla_afectada, endpoint, metodo_http, estado
            FROM auditoria 
            ORDER BY fecha_hora DESC 
            LIMIT 10
        `;

        console.log('🔍 Query simple:', query);

        const [resultados] = await db.execute(query);

        console.log(`✅ TEST: ${resultados.length} registros encontrados`);

        res.json({
            success: true,
            data: resultados,
            message: `TEST exitoso: ${resultados.length} registros`,
            debug: {
                queryUsada: query,
                parametros: 'NINGUNO (query fija)'
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

module.exports = {
    obtenerAuditoria,
    obtenerDetalleAuditoria,
    obtenerDatosFiltros,
    obtenerEstadisticasSimples,
    obtenerAuditoriaSimple,
    obtenerAuditoriaConFiltros // ✅ Nueva función para filtros avanzados
};