// middlewares/errorHandler.js - Manejo centralizado de errores
// ✅ FASE 3: Normalizar respuestas de error y loguear con contexto

const metrics = require('../utils/metrics');
const { log } = require('../utils/logger');

/**
 * Middleware para manejo centralizado de errores
 */
const errorHandler = (err, req, res, next) => {
    const startTime = req.startTime || Date.now();
    const responseTime = Date.now() - startTime;
    
    // Determinar tipo de error
    let statusCode = err.statusCode || err.status || 500;
    let errorType = 'INTERNAL_ERROR';
    let message = err.message || 'Error interno del servidor';
    
    // Clasificar errores
    if (statusCode >= 400 && statusCode < 500) {
        errorType = 'CLIENT_ERROR';
    } else if (statusCode >= 500) {
        errorType = 'SERVER_ERROR';
    }
    
    // Normalizar mensaje según entorno
    if (process.env.NODE_ENV === 'production' && statusCode >= 500) {
        // En producción, no exponer detalles de errores internos
        message = 'Error interno del servidor';
    }
    
    // Registrar error en métricas
    metrics.recordError(errorType, req.originalUrl || req.path, message);
    
    // Loguear error con contexto
    log.error('Error en request', {
        errorType,
        statusCode,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        endpoint: req.originalUrl || req.path,
        method: req.method,
        responseTime: `${responseTime}ms`,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent']
    });
    
    // Respuesta normalizada
    const errorResponse = {
        success: false,
        error: {
            type: errorType,
            message: message,
            statusCode: statusCode
        },
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.path
    };
    
    // En desarrollo, incluir stack trace
    if (process.env.NODE_ENV === 'development') {
        errorResponse.error.stack = err.stack;
        errorResponse.error.details = err.details || {};
    }
    
    res.status(statusCode).json(errorResponse);
};

/**
 * Middleware para capturar errores 404
 */
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Endpoint no encontrado: ${req.method} ${req.originalUrl}`);
    error.statusCode = 404;
    error.type = 'NOT_FOUND';
    next(error);
};

/**
 * Wrapper para async handlers (evita try-catch repetitivo)
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};

