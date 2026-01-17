// middlewares/metricsMiddleware.js - Middleware para recopilar métricas
// ✅ FASE 3: Medir tiempo de respuesta y registrar requests

const metrics = require('../utils/metrics');

/**
 * Middleware para medir tiempo de respuesta y registrar métricas
 */
const metricsMiddleware = (req, res, next) => {
    const startTime = Date.now();
    const method = req.method;
    const endpoint = req.originalUrl || req.path;

    // Interceptar el envío de respuesta
    const originalSend = res.send.bind(res);
    res.send = function(data) {
        const responseTime = Date.now() - startTime;
        const statusCode = res.statusCode;

        // Registrar métrica
        metrics.recordRequest(method, endpoint, statusCode, responseTime);

        // Registrar error si es 4xx o 5xx
        if (statusCode >= 400) {
            const errorType = statusCode >= 500 ? '5xx' : '4xx';
            metrics.recordError(errorType, endpoint, `HTTP ${statusCode}`);
        }

        return originalSend(data);
    };

    next();
};

module.exports = {
    metricsMiddleware
};

