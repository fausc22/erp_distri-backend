// utils/cache.js - Sistema de caché en memoria para endpoints de lectura frecuente
// ✅ FASE 2: Caché solo para lectura, TTL corto, invalidación automática
// ✅ FASE 3: Integración con métricas

const NodeCache = require('node-cache');
const metrics = require('./metrics');

// ✅ Configuración de caché
const cacheConfig = {
    stdTTL: 120, // TTL por defecto: 120 segundos (2 minutos)
    checkperiod: 60, // Verificar expiración cada 60 segundos
    useClones: false, // Mejor performance, no clonar objetos
    deleteOnExpire: true, // Eliminar automáticamente al expirar
    maxKeys: 1000 // Máximo de keys en caché
};

// ✅ Crear instancia de caché
const cache = new NodeCache(cacheConfig);

// ✅ Estadísticas del caché
let stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
};

/**
 * Obtener valor del caché
 * @param {string} key - Clave del caché
 * @returns {any|null} - Valor cacheado o null si no existe
 */
const get = (key) => {
    const value = cache.get(key);
    if (value !== undefined) {
        stats.hits++;
        metrics.recordCacheHit(); // ✅ FASE 3: Registrar hit en métricas
        return value;
    }
    stats.misses++;
    metrics.recordCacheMiss(); // ✅ FASE 3: Registrar miss en métricas
    return null;
};

/**
 * Guardar valor en caché
 * @param {string} key - Clave del caché
 * @param {any} value - Valor a cachear
 * @param {number} ttl - TTL en segundos (opcional, usa default si no se especifica)
 * @returns {boolean} - true si se guardó correctamente
 */
const set = (key, value, ttl = null) => {
    const success = cache.set(key, value, ttl || cacheConfig.stdTTL);
    if (success) {
        stats.sets++;
    }
    return success;
};

/**
 * Eliminar valor del caché
 * @param {string} key - Clave del caché
 * @returns {number} - Número de keys eliminadas
 */
const del = (key) => {
    const deleted = cache.del(key);
    if (deleted > 0) {
        stats.deletes++;
    }
    return deleted;
};

/**
 * Eliminar múltiples keys que coincidan con un patrón
 * @param {string} pattern - Patrón para buscar keys (ej: 'productos:*')
 * @returns {number} - Número de keys eliminadas
 */
const delPattern = (pattern) => {
    const keys = cache.keys();
    const regex = new RegExp(pattern.replace('*', '.*'));
    let deleted = 0;
    
    keys.forEach(key => {
        if (regex.test(key)) {
            deleted += cache.del(key);
        }
    });
    
    if (deleted > 0) {
        stats.deletes += deleted;
    }
    
    return deleted;
};

/**
 * Limpiar todo el caché
 */
const flush = () => {
    cache.flushAll();
    stats.deletes += cache.keys().length;
};

/**
 * Obtener estadísticas del caché
 * @returns {object} - Estadísticas de uso
 */
const getStats = () => {
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? ((stats.hits / total) * 100).toFixed(2) : 0;
    
    return {
        ...stats,
        totalRequests: total,
        hitRate: `${hitRate}%`,
        keysCount: cache.keys().length,
        cacheSize: cache.getStats().keys
    };
};

/**
 * Resetear estadísticas
 */
const resetStats = () => {
    stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0
    };
};

/**
 * Middleware helper para cachear respuestas de endpoints
 * @param {string} key - Clave del caché
 * @param {number} ttl - TTL en segundos (opcional)
 * @returns {Function} - Middleware function
 */
const cacheMiddleware = (key, ttl = null) => {
    return (req, res, next) => {
        // Intentar obtener del caché
        const cached = get(key);
        
        if (cached !== null) {
            // ✅ Respuesta cacheada encontrada
            return res.json(cached);
        }
        
        // ✅ No hay caché, continuar con el handler normal
        // Interceptar la respuesta para cachearla
        const originalJson = res.json.bind(res);
        res.json = function(data) {
            // Cachear solo si es exitoso
            if (res.statusCode >= 200 && res.statusCode < 300) {
                set(key, data, ttl);
            }
            return originalJson(data);
        };
        
        next();
    };
};

/**
 * Invalidar caché de un endpoint específico
 * @param {string} pattern - Patrón de keys a invalidar (ej: 'productos:*')
 */
const invalidate = (pattern) => {
    if (pattern.includes('*')) {
        delPattern(pattern);
    } else {
        del(pattern);
    }
};

module.exports = {
    get,
    set,
    del,
    delPattern,
    flush,
    getStats,
    resetStats,
    cacheMiddleware,
    invalidate,
    // Exportar instancia para uso avanzado
    cache
};

