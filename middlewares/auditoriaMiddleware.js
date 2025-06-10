
const db = require('../controllers/dbPromise');

/**
 * Obtiene la dirección IP real del cliente
 */
const obtenerIpCliente = (req) => {
    return req.headers['x-forwarded-for'] ||
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           'IP_DESCONOCIDA';
};

/**
 * Registra un evento de auditoría en la base de datos
 */
const registrarAuditoria = async ({
    usuarioId = null,
    usuarioNombre = null,
    accion,
    tablaAfectada = null,
    registroId = null,
    datosAnteriores = null,
    datosNuevos = null,
    ipAddress = null,
    userAgent = null,
    endpoint = null,
    metodoHttp = null,
    detallesAdicionales = null,
    estado = 'EXITOSO',
    tiempoProcesamiento = null
}) => {
    try {
        const query = `
            INSERT INTO auditoria (
                usuario_id, usuario_nombre, accion, tabla_afectada, registro_id,
                datos_anteriores, datos_nuevos, ip_address, user_agent, endpoint,
                metodo_http, detalles_adicionales, estado, tiempo_procesamiento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const valores = [
            usuarioId,
            usuarioNombre,
            accion,
            tablaAfectada,
            registroId,
            datosAnteriores ? JSON.stringify(datosAnteriores) : null,
            datosNuevos ? JSON.stringify(datosNuevos) : null,
            ipAddress,
            userAgent,
            endpoint,
            metodoHttp,
            detallesAdicionales,
            estado,
            tiempoProcesamiento
        ];

        await db.execute(query, valores);
    } catch (error) {
        // No queremos que fallos de auditoría afecten la operación principal
        console.error('Error registrando auditoría:', error);
    }
};

/**
 * Middleware para auditoría automática de requests
 */
const middlewareAuditoria = (opciones = {}) => {
    const {
        accion = 'VIEW',
        tabla = null,
        incluirBody = false,
        incluirQuery = false
    } = opciones;

    return async (req, res, next) => {
        const inicioTiempo = Date.now();
        
        // Obtener información del usuario autenticado
        const usuario = req.user || {};
        const ipAddress = obtenerIpCliente(req);
        const userAgent = req.headers['user-agent'] || 'DESCONOCIDO';

        // Interceptar la respuesta para obtener el resultado
        const originalSend = res.send;
        res.send = function(data) {
            const tiempoProcesamiento = Date.now() - inicioTiempo;
            
            // Determinar si la operación fue exitosa
            const estado = res.statusCode >= 200 && res.statusCode < 300 ? 'EXITOSO' : 'FALLIDO';
            
            // Preparar detalles adicionales
            let detallesAdicionales = '';
            if (incluirBody && req.body) {
                detallesAdicionales += `Body: ${JSON.stringify(req.body)} | `;
            }
            if (incluirQuery && req.query) {
                detallesAdicionales += `Query: ${JSON.stringify(req.query)} | `;
            }
            detallesAdicionales += `Status: ${res.statusCode}`;

            // Registrar auditoría de forma asíncrona
            setImmediate(() => {
                registrarAuditoria({
                    usuarioId: usuario.id,
                    usuarioNombre: usuario.nombre ? `${usuario.nombre} ${usuario.apellido}` : null,
                    accion,
                    tablaAfectada: tabla,
                    ipAddress,
                    userAgent,
                    endpoint: req.originalUrl,
                    metodoHttp: req.method,
                    detallesAdicionales,
                    estado,
                    tiempoProcesamiento
                });
            });

            originalSend.call(this, data);
        };

        next();
    };
};

/**
 * Función para auditar operaciones CRUD específicas
 */
const auditarOperacion = async (req, {
    accion,
    tabla,
    registroId = null,
    datosAnteriores = null,
    datosNuevos = null,
    detallesAdicionales = null
}) => {
    const usuario = req.user || {};
    const ipAddress = obtenerIpCliente(req);
    const userAgent = req.headers['user-agent'] || 'DESCONOCIDO';

    await registrarAuditoria({
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombre ? `${usuario.nombre} ${usuario.apellido}` : null,
        accion,
        tablaAfectada: tabla,
        registroId: registroId ? registroId.toString() : null,
        datosAnteriores,
        datosNuevos,
        ipAddress,
        userAgent,
        endpoint: req.originalUrl,
        metodoHttp: req.method,
        detallesAdicionales
    });
};

/**
 * Función para auditar eventos de autenticación
 */
const auditarAuth = async (req, {
    accion,
    usuarioId = null,
    usuarioNombre = null,
    estado = 'EXITOSO',
    detallesAdicionales = null
}) => {
    const ipAddress = obtenerIpCliente(req);
    const userAgent = req.headers['user-agent'] || 'DESCONOCIDO';

    await registrarAuditoria({
        usuarioId,
        usuarioNombre,
        accion,
        ipAddress,
        userAgent,
        endpoint: req.originalUrl,
        metodoHttp: req.method,
        detallesAdicionales,
        estado
    });
};

/**
 * Función para obtener datos anteriores antes de una actualización
 */
const obtenerDatosAnteriores = async (tabla, id, campoId = 'id') => {
    try {
        const query = `SELECT * FROM ${tabla} WHERE ${campoId} = ?`;
        const [results] = await db.execute(query, [id]);
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('Error obteniendo datos anteriores:', error);
        return null;
    }
};

/**
 * Función para limpiar datos sensibles antes del registro
 */
const limpiarDatosSensibles = (datos) => {
    if (!datos || typeof datos !== 'object') return datos;
    
    const datosCopia = { ...datos };
    const camposSensibles = ['password', 'token', 'refresh_token', 'secret'];
    
    camposSensibles.forEach(campo => {
        if (datosCopia[campo]) {
            datosCopia[campo] = '***CENSURADO***';
        }
    });

    return datosCopia;
};

module.exports = {
    middlewareAuditoria,
    auditarOperacion,
    auditarAuth,
    registrarAuditoria,
    obtenerDatosAnteriores,
    limpiarDatosSensibles,
    obtenerIpCliente
};