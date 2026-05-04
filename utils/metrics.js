// utils/metrics.js - Sistema de métricas lightweight
// ✅ FASE 3: Métricas simples sin APM pesado

class MetricsCollector {
    constructor() {
        // ✅ Métricas de requests
        this.requests = {
            total: 0,
            byMethod: {},
            byEndpoint: {},
            byStatus: {
                '2xx': 0,
                '4xx': 0,
                '5xx': 0
            }
        };

        // ✅ Métricas de tiempo de respuesta
        this.responseTimes = {
            byEndpoint: {},
            total: []
        };

        // ✅ Métricas de caché (integración con cache.js)
        this.cache = {
            hits: 0,
            misses: 0
        };

        // ✅ Métricas de errores
        this.errors = {
            total: 0,
            byType: {},
            recent: [] // Últimos 100 errores
        };

        // ✅ Timestamp de inicio
        this.startTime = Date.now();
    }

    /**
     * Registrar un request
     */
    recordRequest(method, endpoint, statusCode, responseTime) {
        this.requests.total++;
        
        // Por método
        this.requests.byMethod[method] = (this.requests.byMethod[method] || 0) + 1;
        
        // Por endpoint (normalizar)
        const normalizedEndpoint = this.normalizeEndpoint(endpoint);
        this.requests.byEndpoint[normalizedEndpoint] = (this.requests.byEndpoint[normalizedEndpoint] || 0) + 1;
        
        // Por status
        if (statusCode >= 200 && statusCode < 300) {
            this.requests.byStatus['2xx']++;
        } else if (statusCode >= 400 && statusCode < 500) {
            this.requests.byStatus['4xx']++;
        } else if (statusCode >= 500) {
            this.requests.byStatus['5xx']++;
        }

        // Tiempo de respuesta
        if (responseTime !== undefined) {
            this.responseTimes.total.push(responseTime);
            if (this.responseTimes.total.length > 1000) {
                this.responseTimes.total.shift(); // Mantener solo últimos 1000
            }

            if (!this.responseTimes.byEndpoint[normalizedEndpoint]) {
                this.responseTimes.byEndpoint[normalizedEndpoint] = [];
            }
            this.responseTimes.byEndpoint[normalizedEndpoint].push(responseTime);
            if (this.responseTimes.byEndpoint[normalizedEndpoint].length > 100) {
                this.responseTimes.byEndpoint[normalizedEndpoint].shift();
            }
        }
    }

    /**
     * Registrar hit de caché
     */
    recordCacheHit() {
        this.cache.hits++;
    }

    /**
     * Registrar miss de caché
     */
    recordCacheMiss() {
        this.cache.misses++;
    }

    /**
     * Registrar error
     */
    recordError(errorType, endpoint, message) {
        this.errors.total++;
        this.errors.byType[errorType] = (this.errors.byType[errorType] || 0) + 1;
        
        // Agregar a errores recientes
        this.errors.recent.push({
            type: errorType,
            endpoint,
            message,
            timestamp: new Date().toISOString()
        });
        
        // Mantener solo últimos 100 errores
        if (this.errors.recent.length > 100) {
            this.errors.recent.shift();
        }
    }

    /**
     * Normalizar endpoint (remover IDs y parámetros)
     */
    normalizeEndpoint(endpoint) {
        return endpoint
            .replace(/\/\d+/g, '/:id')
            .replace(/\?.*$/, '')
            .split('?')[0];
    }

    /**
     * Calcular estadísticas de tiempo de respuesta
     */
    getResponseTimeStats(endpoint = null) {
        const times = endpoint 
            ? (this.responseTimes.byEndpoint[endpoint] || [])
            : this.responseTimes.total;

        if (times.length === 0) {
            return {
                count: 0,
                avg: 0,
                min: 0,
                max: 0,
                p95: 0,
                p99: 0
            };
        }

        const sorted = [...times].sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];

        return {
            count: times.length,
            avg: Math.round(avg * 100) / 100,
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            p95: Math.round(p95 * 100) / 100,
            p99: Math.round(p99 * 100) / 100
        };
    }

    /**
     * Obtener todas las métricas
     */
    getMetrics() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        
        return {
            uptime: {
                seconds: uptime,
                formatted: this.formatUptime(uptime)
            },
            requests: {
                ...this.requests,
                successRate: this.requests.total > 0 
                    ? ((this.requests.byStatus['2xx'] / this.requests.total) * 100).toFixed(2) + '%'
                    : '0%'
            },
            responseTimes: {
                overall: this.getResponseTimeStats(),
                byEndpoint: Object.keys(this.responseTimes.byEndpoint).reduce((acc, endpoint) => {
                    acc[endpoint] = this.getResponseTimeStats(endpoint);
                    return acc;
                }, {})
            },
            cache: {
                ...this.cache,
                hitRate: (this.cache.hits + this.cache.misses) > 0
                    ? ((this.cache.hits / (this.cache.hits + this.cache.misses)) * 100).toFixed(2) + '%'
                    : '0%'
            },
            errors: {
                ...this.errors,
                recentCount: this.errors.recent.length
            }
        };
    }

    /**
     * Formatear uptime
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m ${secs}s`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Resetear métricas (útil para testing)
     */
    reset() {
        this.requests = {
            total: 0,
            byMethod: {},
            byEndpoint: {},
            byStatus: {
                '2xx': 0,
                '4xx': 0,
                '5xx': 0
            }
        };
        this.responseTimes = {
            byEndpoint: {},
            total: []
        };
        this.cache = {
            hits: 0,
            misses: 0
        };
        this.errors = {
            total: 0,
            byType: {},
            recent: []
        };
        this.startTime = Date.now();
    }
}

// ✅ Instancia única
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;

