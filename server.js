// ✅ FASE 3: Validar variables de entorno al inicio (fallar rápido si faltan)
const { validateEnv } = require('./utils/envValidator');
validateEnv();

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const port = process.env.PORT || 3001;
const app = express();

// ✅ FIX: Activar trust proxy porque el tráfico llega por proxy (nginx/Cloudflare en VPS).
// Sin esto, express-rate-limit lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR cuando existe X-Forwarded-For.
app.set('trust proxy', 1);

// ==============================================
// IMPORTACIÓN DE RUTAS
// ==============================================

// Rutas principales del ERP
const personasRoutes = require('./routes/personasRouter');
const authRoutes = require('./routes/authRoutes');
const ventasRoutes = require('./routes/ventasRoutes'); 
const pedidosRoutes = require('./routes/pedidosRoutes');
const empleadosRoutes = require('./routes/empleadosRoutes');
const productosRoutes = require('./routes/productosRoutes'); 
const finanzasRoutes = require('./routes/finanzasRoutes'); 
const comprasRoutes = require('./routes/comprasRoutes'); 
const auditoriaRoutes = require('./routes/auditoriaRoutes');
const comprobantesRoutes = require('./routes/comprobantesRoutes'); 

// Rutas nuevas (de desarrollo)
const arcaRoutes = require('./routes/arcaRoutes');
const ciudadesRoutes = require('./routes/ciudadesRoutes');
const listadosRoutes = require('./routes/listadosRoutes');
const notasRoutes = require('./routes/notasRoutes');
const scriptsRoutes = require('./routes/scriptsRoutes');


// ==============================================
// CONFIGURACIÓN CORS - PRODUCCIÓN VPS
// ==============================================
const allowedOrigins = [
    // Desarrollo local
    'http://localhost:3000',
    'http://localhost:3001',
    
    'https://vertimar.online',
    'https://www.vertimar.online',
    
    
    
    
    'https://api.vertimar.online',
    'http://api.vertimar.online',
    
    // Otros servicios
    'https://excel-ima.vercel.app',
    'https://beta.vertimar.online'
];

// En desarrollo, permitir cualquier origen localhost
if (process.env.NODE_ENV === 'development') {
    allowedOrigins.push(/^http:\/\/localhost:\d+$/);    
    allowedOrigins.push(/^http:\/\/127\.0\.0\.1:\d+$/);
}

const corsOptions = {
    origin: (origin, callback) => {
        // Permitir requests sin origen (apps móviles, Postman, etc.)
        if (!origin) return callback(null, true);
        
        // Verificar si el origen está en la lista permitida
        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (typeof allowedOrigin === 'string') {
                return allowedOrigin === origin;
            }
            // Para RegExp
            return allowedOrigin.test(origin);
        });
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.log(`❌ CORS bloqueado para origen: ${origin}`);
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-no-compression'],
    credentials: true,
    optionsSuccessStatus: 200 // Para navegadores legacy
};


// ==============================================
// MIDDLEWARES
// ==============================================
const { middlewareAuditoria } = require('./middlewares/auditoriaMiddleware');
const { metricsMiddleware } = require('./middlewares/metricsMiddleware');
const metrics = require('./utils/metrics');
const { log } = require('./utils/logger');

// ✅ FASE 3: Headers de seguridad con Helmet
app.use(helmet({
    contentSecurityPolicy: false, // Deshabilitado para no bloquear recursos PWA
    crossOriginEmbedderPolicy: false, // Compatible con PWA
    crossOriginResourcePolicy: { policy: "cross-origin" } // Permitir recursos cross-origin para PWA
}));

// ✅ FASE 1: Compresión HTTP para reducir tamaño de respuestas
app.use(compression({
    filter: (req, res) => {
        // Comprimir todo excepto PDFs y otros binarios
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    level: 6 // Balance entre compresión y CPU (0-9, 6 es óptimo)
}));

app.use(cors(corsOptions));
app.use(cookieParser());    
app.use(express.json({ limit: '10mb' })); // Límite para PDFs grandes
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ FIX: Logging temprano para diagnosticar requests que no aparecen
// Debe ir ANTES de otros middlewares para capturar TODOS los requests
// Usa log.info para que además llegue a Discord (canal consola)
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const forwardedFor = req.headers['x-forwarded-for'] || 'none';
    const msg = `📥 ${req.method} ${req.path} | IP: ${clientIP} | Origin: ${req.headers.origin || 'none'}`;
    log.info(msg, { timestamp, xForwardedFor: forwardedFor });
    req.startTime = Date.now();
    next();
});

// ✅ FASE 3: Middleware de métricas (debe ir después de body parsers)
app.use(metricsMiddleware);

// ✅ Rate limiting muy permisivo - Sistema interno (4-5 usuarios). Con trust proxy, req.ip ya es la IP real.
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000000, // Prácticamente sin límite
    message: 'Demasiados requests desde esta IP, por favor intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return req.path === '/health' || req.path === '/ping' || req.path === '/metrics';
    },
    // Desactivar validación X-Forwarded-For por si en algún entorno no hay proxy
    validate: { xForwardedForHeader: false }
});

// Aplicar rate limiter general
app.use(generalLimiter);


// ==============================================
// SERVIR ARCHIVOS ESTÁTICOS
// ==============================================
const staticOptions = {
    maxAge: '1d', // Cache por 1 día
    etag: true,
    lastModified: true
};

app.use('/static', express.static('public', staticOptions));


// ==============================================
// ENDPOINTS DEL SISTEMA
// ==============================================

// ✅ FIX: Endpoint liviano para verificación de conectividad (no verifica DB)
// Usado por ConnectionManager para detectar si hay red + backend disponible
app.get('/ping', (req, res) => {
    // Solo verificar que el servidor responde, sin verificar DB ni cache
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'Backend disponible'
    });
});

// ✅ FASE 3: Health check mejorado con más información
app.get('/health', async (req, res) => {
    try {
        const startTime = Date.now();
        
        // Test de conexión a BD
        const db = require('./controllers/dbPromise');
        const dbStartTime = Date.now();
        await db.execute('SELECT 1');
        const dbResponseTime = Date.now() - dbStartTime;
        
        // Estado del caché
        const cacheStats = require('./utils/cache').getStats();
        
        // Uso de memoria
        const memoryUsage = process.memoryUsage();
        const memoryMB = {
            rss: Math.round(memoryUsage.rss / 1024 / 1024),
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            external: Math.round(memoryUsage.external / 1024 / 1024)
        };
        
        // Estado del pool de conexiones
        const poolStats = await db.getPoolStats();
        
        const totalResponseTime = Date.now() - startTime;
        
        res.json({
            status: '✅ Healthy',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'production',
            responseTime: `${totalResponseTime}ms`,
            server: {
                platform: 'VPS Hostinger',
                uptime: Math.floor(process.uptime()),
                uptimeFormatted: formatUptime(process.uptime()),
                memory: memoryMB,
                nodeVersion: process.version,
                platform: process.platform,
                port: port,
                version: '1.2.0'
            },
            database: {
                status: '✅ Connected',
                responseTime: `${dbResponseTime}ms`,
                pool: poolStats || 'N/A'
            },
            cache: {
                status: '✅ Active',
                keys: cacheStats.keysCount || 0,
                hitRate: cacheStats.hitRate || '0%'
            }
        });
    } catch (error) {
        // ✅ Obtener información de la base de datos de forma segura
        let dbStatus = '❌ Disconnected';
        let dbError = error.message;
        
        try {
            const db = require('./controllers/dbPromise');
            const dbStatusInfo = db.getStatus();
            if (dbStatusInfo.poolExists && !dbStatusInfo.isConnected) {
                dbStatus = '❌ Pool inicializado pero desconectado';
            } else if (!dbStatusInfo.poolExists) {
                dbStatus = '❌ Pool no inicializado';
            }
        } catch (dbError) {
            dbError = dbError.message || error.message;
        }
        
        res.status(500).json({
            status: '❌ Unhealthy',
            timestamp: new Date().toISOString(),
            server: {
                platform: 'VPS Hostinger',
                uptime: Math.floor(process.uptime()),
                uptimeFormatted: formatUptime(process.uptime()),
                memory: {
                    rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
                    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
                }
            },
            database: {
                status: dbStatus,
                error: dbError
            },
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
        });
    }
});

// Helper para formatear uptime
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

// ✅ FASE 3: Endpoint de métricas (solo accesible en entornos seguros)
app.get('/metrics', (req, res) => {
    // Solo permitir en desarrollo o con autenticación en producción
    if (process.env.NODE_ENV === 'production') {
        // En producción, requerir autenticación básica o token
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        // Verificar token simple (puedes mejorar esto)
        const token = authHeader.slice(7);
        if (token !== process.env.METRICS_TOKEN) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }
    
    res.json(metrics.getMetrics());
});


// ==============================================
// ROOT ENDPOINT
// ==============================================
app.get('/', (req, res) => {
    res.json({
        message: '🚀 API Distri-Back en VPS Hostinger',
        version: '1.2.0',
        environment: process.env.NODE_ENV || 'production',
        platform: 'VPS Hostinger',
        uptime: Math.floor(process.uptime()),
        endpoints: {
            // Principales
            auth: '/auth',
            personas: '/personas',
            productos: '/productos',
            empleados: '/empleados',
            pedidos: '/pedidos',
            ventas: '/ventas',
            finanzas: '/finanzas',
            compras: '/compras',
            auditoria: '/auditoria',
            comprobantes: '/comprobantes',
            
            // Nuevas rutas
            arca: '/arca',
            ciudades: '/ciudades',
            listados: '/listados',
            notas: '/notas',
            scripts: '/scripts',
            
            // Sistema
            health: '/health',
            ping: '/ping',
            metrics: '/metrics'
        }
    });
});


// ==============================================
// RUTAS PRINCIPALES DEL ERP
// ==============================================
app.use('/personas', personasRoutes);
app.use('/auth', authRoutes);
app.use('/productos', productosRoutes); 
app.use('/empleados', empleadosRoutes);
app.use('/pedidos', pedidosRoutes);
app.use('/finanzas', finanzasRoutes); 
app.use('/ventas', ventasRoutes); 
app.use('/compras', comprasRoutes);
app.use('/auditoria', auditoriaRoutes);
app.use('/comprobantes', comprobantesRoutes); 

// Nuevas rutas (de desarrollo)
app.use('/arca', arcaRoutes);
app.use('/ciudades', ciudadesRoutes);
app.use('/listados', listadosRoutes);
app.use('/notas', notasRoutes);
app.use('/scripts', scriptsRoutes);
app.use('/', scriptsRoutes);


// ==============================================
// MANEJO DE ERRORES
// ==============================================
// ✅ FASE 3: Manejo centralizado de errores
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

// Middleware para rutas no encontradas
app.use(notFoundHandler);

// Middleware global de manejo de errores (debe ir al final)
app.use(errorHandler);


// ==============================================
// GRACEFUL SHUTDOWN
// ==============================================
const gracefulShutdown = async (signal) => {
    console.log(`🛑 Recibida señal ${signal}, cerrando servidor VPS...`);
    
    try {
        // Cerrar servidor HTTP
        server.close(() => {
            console.log('✅ Servidor HTTP cerrado');
        });
        
        // Cerrar conexiones de base de datos
        const db = require('./controllers/dbPromise');
        await db.end();
        console.log('✅ Conexión a base de datos cerrada');
        
        console.log('✅ Servidor VPS cerrado correctamente');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error cerrando servidor VPS:', error);
        process.exit(1);
    }
};

// Manejar señales de cierre en VPS
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Manejar errores no capturados en VPS
process.on('uncaughtException', async (error) => {
    console.error('💥 Excepción no capturada en VPS:', error);
    await gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('💥 Promise rechazada no manejada en VPS:', reason);
    await gracefulShutdown('unhandledRejection');
});


// ==============================================
// INICIAR SERVIDOR
// ==============================================
const server = app.listen(port, '0.0.0.0', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVIDOR VPS INICIADO EXITOSAMENTE');
    console.log('='.repeat(60));
    console.log(`🌍 Puerto: ${port}`);
    console.log(`🔧 Entorno: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔗 URL local: http://localhost:${port}`);
    console.log(`💾 Memoria inicial: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log(`⏰ Iniciado: ${new Date().toLocaleString('es-AR')}`);
    console.log('\n📋 Configuración del sistema:');
    console.log(`   - Node.js: ${process.version}`);
    console.log(`   - Plataforma: ${process.platform}`);
    console.log(`   - Arquitectura: ${process.arch}`);
    console.log(`   - PID: ${process.pid}`);
    console.log('\n🔗 Endpoints disponibles:');
    console.log(`   - Health: http://localhost:${port}/health`);
    console.log(`   - Ping: http://localhost:${port}/ping`);
    console.log(`   - Metrics: http://localhost:${port}/metrics`);
    console.log(`   - API Docs: http://localhost:${port}/`);
    console.log('='.repeat(60) + '\n');
});
