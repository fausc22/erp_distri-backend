require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const port = process.env.PORT || 3001;
const app = express();

// Controladores routes
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

// CORS configuration - Optimizado para VPS
const allowedOrigins = [
    'http://localhost:3000', 
    'https://vertimar.vercel.app',
    // Agrega aquí tu dominio de VPS cuando lo tengas configurado
    // 'https://tu-dominio.com',
    // 'https://www.tu-dominio.com'
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200 // Para navegadores legacy
};

// Middlewares
const { middlewareAuditoria } = require('./middlewares/auditoriaMiddleware');

app.use(cors(corsOptions));
app.use(cookieParser());    
app.use(express.json({ limit: '10mb' })); // Límite para PDFs grandes
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint optimizado para VPS
app.get('/health', async (req, res) => {
    try {
        // Test básico de conexión a BD
        const db = require('./controllers/dbPromise');
        const startTime = Date.now();
        await db.execute('SELECT 1');
        const dbResponseTime = Date.now() - startTime;
        
        
        
        res.json({
            status: '✅ VPS Healthy',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            server: {
                platform: 'VPS Hostinger',
                uptime: Math.floor(process.uptime()),
                memory: process.memoryUsage(),
                port: port,
                version: '1.0.0'
            },
            database: {
                status: '✅ Connected',
                responseTime: `${dbResponseTime}ms`
            },
            
        });
    } catch (error) {
        res.status(500).json({
            status: '❌ VPS Error',
            timestamp: new Date().toISOString(),
            server: {
                platform: 'VPS Hostinger',
                uptime: Math.floor(process.uptime()),
                memory: process.memoryUsage()
            },
            database: '❌ Disconnected',
            error: error.message
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: '🚀 API Distri-Back en VPS Hostinger',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        platform: 'VPS Hostinger',
        uptime: Math.floor(process.uptime()),
        endpoints: {
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
            health: '/health',
            
        }
    });
});

// Routes
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

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint no encontrado',
        path: req.originalUrl,
        method: req.method,
        server: 'VPS Hostinger',
        available_endpoints: [
            'GET /',
            'GET /health',
            'GET /puppeteer-status',
            'POST /auth/login',
            'GET /productos/buscar-producto',
            'GET /pedidos/obtener-pedidos',
            'POST /ventas/generarpdf-factura',
            'POST /pedidos/generarpdf-notapedido'
        ]
    });
});

// Middleware global de manejo de errores
app.use((error, req, res, next) => {
    console.error('💥 Error global en VPS:', error);
    
    res.status(error.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Error interno del servidor' 
            : error.message,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        server: 'VPS Hostinger'
    });
});





// Función para graceful shutdown en VPS
const gracefulShutdown = async (signal) => {
    console.log(`🛑 Recibida señal ${signal}, cerrando servidor VPS...`);
    
    try {
        
        
        // Cerrar conexiones de base de datos
        const db = require('./controllers/dbPromise');
        await db.end();
        
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

// Iniciar el servidor en VPS
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor iniciado en VPS Hostinger`);
    console.log(`🌍 Puerto: ${port}`);
    console.log(`🔧 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 URL local: http://localhost:${port}`);
    console.log(`💾 Memoria inicial: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log(`⏰ Iniciado: ${new Date().toLocaleString()}`);
    
    // Log de configuración importante para VPS
    console.log(`📋 Configuración VPS:`);
    console.log(`   - Node.js: ${process.version}`);
    console.log(`   - Plataforma: ${process.platform}`);
    console.log(`   - Arquitectura: ${process.arch}`);
    console.log(`   - PID: ${process.pid}`);
});