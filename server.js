require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const axios = require('axios');

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
// const comprobantesRoutes = require('./routes/comprobantesRoutes'); // Comentado - no existe en tu proyecto

// CORS configuration - Incluye Railway
const allowedOrigins = [
    'http://localhost:3000', 
    'https://distri-vertimar.vercel.app',
    'https://distri-back-production.up.railway.app', // Agrega tu dominio de Railway aquí
    /https:\/\/.*\.up\.railway\.app$/ // Permite cualquier subdominio de Railway
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

// Middlewares
const { middlewareAuditoria } = require('./middlewares/auditoriaMiddleware');

app.use(cors(corsOptions)); // ✅ Solo una configuración de CORS
app.use(express.json({ limit: '10mb' })); // Límite para PDFs grandes
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint para Railway
app.get('/health', async (req, res) => {
    try {
        // Test básico de conexión a BD
        const db = require('./controllers/dbPromise');
        await db.execute('SELECT 1');
        
        res.json({
            status: '✅ OK',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            database: '✅ Connected',
            port: port,
            version: '1.0.0'
        });
    } catch (error) {
        res.status(500).json({
            status: '❌ ERROR',
            timestamp: new Date().toISOString(),
            database: '❌ Disconnected',
            error: error.message
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: '🚀 API Distri-Back funcionando correctamente',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
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
            health: '/health'
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
// app.use('/comprobantes', comprobantesRoutes); // Descomentarcuando exista el archivo

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint no encontrado',
        path: req.originalUrl,
        method: req.method,
        available_endpoints: [
            'GET /',
            'GET /health',
            'POST /auth/login',
            'GET /productos/buscar-producto',
            'GET /pedidos/obtener-pedidos',
            // Agrega más endpoints importantes aquí
        ]
    });
});

// Middleware global de manejo de errores
app.use((error, req, res, next) => {
    console.error('💥 Error global:', error);
    
    res.status(error.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Error interno del servidor' 
            : error.message,
        timestamp: new Date().toISOString(),
        path: req.originalUrl
    });
});

// Iniciar el servidor
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor escuchando en el puerto ${port}`);
    console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 URL local: http://localhost:${port}`);
    if (process.env.RAILWAY_STATIC_URL) {
        console.log(`🚂 URL Railway: ${process.env.RAILWAY_STATIC_URL}`);
    }
});