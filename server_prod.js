require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const port = process.env.PORT || 3001;
const app = express();


// ==============================================
// INICIALIZACIÓN DE CRONJOBS (serverIma)
// ==============================================
const CronJobs = require('./serverIma/cronJobs');

console.log('🚀 Inicializando CronJobs...');
const cronJobs = new CronJobs();
console.log('🔧 CronJobs creado:', cronJobs ? 'SÍ' : 'NO');
const fileCheck = cronJobs.checkFiles();
if (!fileCheck.valid) {
  console.error('❌ Archivos faltantes en serverIma:', fileCheck.missing);
  console.log('📋 Asegúrate de que estos archivos estén en la carpeta serverIma/');
} else {
  // Solo inicializar si todos los archivos están presentes
  cronJobs.initDailyReport();
}


// ==============================================
// IMPORTACIÓN DE RUTAS
// ==============================================

// Rutas principales
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

// Rutas serverIma
const recibosRoutes = require('./serverIma/routes/recibos');
const stockRoutes = require('./serverIma/routes/stock');

// Rutas Fletes
const authRoutesFletes = require('./routes/fletes/authRoutes');
const camionesRoutes = require('./routes/fletes/camionesRoutes');
const dineroRoutes = require('./routes/fletes/dineroRoutes');
const viajesRoutes = require('./routes/fletes/viajesRoutes');
const reportesRoutes = require('./routes/fletes/reportesRoutes');


// ==============================================
// CONFIGURACIÓN CORS - PRODUCCIÓN VPS
// ==============================================
const allowedOrigins = [
  // Desarrollo local
  'http://localhost:3000', 
  
  // Producción principal
  'https://vertimar.vercel.app',
  'https://www.vertimar.vercel.app/',
  'http://vertimar.vercel.app',
  'https://www.distri-facturacion.vercel.app',
  'https://distri-facturacion.vercel.app',
  'https://distri-facturacion.vercel.app/',
  
  // API VPS
  'https://distri-api.duckdns.org',
  'http://distri-api.duckdns.org',
  
  // Otros servicios
  'https://recibos-caradvice.vercel.app',
  'https://fletes-fc.vercel.app',
  'https://excel-ima.vercel.app',
];



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


// ==============================================
// MIDDLEWARES
// ==============================================
const { middlewareAuditoria } = require('./middlewares/auditoriaMiddleware');

app.use(cors(corsOptions));
app.use(cookieParser());    
app.use(express.json({ limit: '10mb' })); // Límite para PDFs grandes
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


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
// ENDPOINTS IMA (serverIma)
// ==============================================

// Endpoint de prueba
app.get('/ima/test', (req, res) => {
  console.log('🧪 Endpoint de prueba llamado');
  res.json({
    success: true,
    message: 'El servidor y cronJobs funcionan',
    cronJobsStatus: cronJobs ? 'Inicializado' : 'NO inicializado',
    timestamp: new Date().toISOString()
  });
});

// Endpoint para ejecutar script IMA manual
app.get('/ima/generar-reporte', async (req, res) => {
  console.log(`\n🔧 [${new Date().toISOString()}] Ejecución manual solicitada`);
  
  try {
    // Verificar archivos antes de ejecutar
    const fileCheck = cronJobs.checkFiles();
    if (!fileCheck.valid) {
      return res.status(400).json({
        success: false,
        message: 'Archivos faltantes en serverIma',
        missingFiles: fileCheck.missing
      });
    }
    
    const result = await cronJobs.executeManually();
    
    res.json({
      success: true,
      message: 'Reporte ejecutado exitosamente',
      data: result
    });

  } catch (error) {
    console.error('❌ Error en ejecución manual:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error al ejecutar el reporte',
      error: error.error || error.message,
      details: error.stderr || null,
      data: error
    });
  }
});


// ==============================================
// HEALTH CHECK
// ==============================================
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
            environment: process.env.NODE_ENV || 'production',
            server: {
                platform: 'VPS Hostinger',
                uptime: Math.floor(process.uptime()),
                memory: process.memoryUsage(),
                port: port,
                version: '1.1.0'
            },
            database: {
                status: '✅ Connected',
                responseTime: `${dbResponseTime}ms`
            },
            cronJobs: {
                status: cronJobs ? '✅ Activo' : '❌ Inactivo'
            }
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


// ==============================================
// ROOT ENDPOINT
// ==============================================
app.get('/', (req, res) => {
    res.json({
        message: '🚀 API Distri-Back en VPS Hostinger',
        version: '1.1.0',
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
            
            // ServerIma
            recibos: '/recibosCarAdvice',
            stock: '/stockCarAdvice',
            
            // Fletes
            authFletes: '/authFletes',
            camiones: '/camiones',
            dinero: '/dinero',
            viajes: '/viajes',
            reportes: '/reportes',
            
            // Sistema
            health: '/health',
            imaTest: '/ima/test',
            imaReporte: '/ima/generar-reporte'
        }
    });
});


// ==============================================
// RUTAS PRINCIPALES
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


// ==============================================
// RUTAS SERVERIMAUSER (Car Advice)
// ==============================================
app.use('/recibosCarAdvice', recibosRoutes);
app.use('/stockCarAdvice', stockRoutes);


// ==============================================
// RUTAS FLETES
// ==============================================
app.use('/authFletes', authRoutesFletes);
app.use('/camiones', camionesRoutes);
app.use('/dinero', dineroRoutes);
app.use('/viajes', viajesRoutes);
app.use('/reportes', reportesRoutes);


// ==============================================
// MIDDLEWARE 404
// ==============================================
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint no encontrado',
        path: req.originalUrl,
        method: req.method,
        server: 'VPS Hostinger',
        available_endpoints: [
            'GET /',
            'GET /health',
            'POST /auth/login',
            'GET /productos/buscar-producto',
            'GET /pedidos/obtener-pedidos',
            'POST /ventas/generarpdf-factura',
            'POST /pedidos/generarpdf-notapedido',
            'GET /arca/*',
            'GET /ciudades/*',
            'GET /listados/*',
            'GET /ima/test',
            'GET /ima/generar-reporte'
        ]
    });
});


// ==============================================
// MIDDLEWARE GLOBAL DE ERRORES
// ==============================================
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
const server = app.listen(port, '0.0.0.0', () => {
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
    console.log(`   - CronJobs: ${cronJobs ? '✅ Activo' : '❌ Inactivo'}`);
    console.log('\n🔗 Endpoints disponibles:');
    console.log(`   - Health: http://localhost:${port}/health`);
    console.log(`   - API Docs: http://localhost:${port}/`);
    console.log(`   - IMA Test: http://localhost:${port}/ima/test`);
    console.log('='.repeat(60) + '\n');
});

