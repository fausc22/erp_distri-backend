require('dotenv').config();

const express = require('express');
const session = require('express-session');

const cors = require('cors'); // Añadido para manejar CORS

const axios = require('axios');

const port = process.env.PORT || 3001; // Puerto en el que correrá la aplicación

const app = express();





//controladores routes
const personasRoutes = require('./routes/personasRouter');
const authRoutes = require('./routes/authRoutes');
const ventasRoutes = require('./routes/ventasRoutes'); 
const pedidosRoutes = require('./routes/pedidosRoutes');
const empleadosRoutes = require('./routes/empleadosRoutes');
const productosRoutes = require('./routes/productosRoutes'); 
const finanzasRoutes = require('./routes/finanzasRoutes'); 
const comprasRoutes = require('./routes/comprasRoutes'); 
 const auditoriaRoutes = require('./routes/auditoriaRoutes');

//pongo los fronts BIEN
const allowedOrigins = ['http://localhost:3000', 'https://distri-vertimar.vercel.app'];

const corsOptions = {
    origin: (origin, callback) => {
        if (allowedOrigins.includes(origin) || !origin) {
            callback(null, true);
        } else {
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true
};

app.use(cors(corsOptions));


// Configurar middleware para parsear JSON
//middlewares
const { middlewareAuditoria } = require('./middlewares/auditoriaMiddleware');
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));



app.use('/personas', personasRoutes);
app.use('/auth', authRoutes);
app.use('/productos', productosRoutes); 
app.use('/empleados', empleadosRoutes);
app.use('/pedidos', pedidosRoutes);
app.use('/finanzas', finanzasRoutes); 
app.use('/ventas', ventasRoutes); 
app.use('/compras', comprasRoutes);
app.use('/auditoria', auditoriaRoutes);


// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});
