require('dotenv').config();

const express = require('express');
const session = require('express-session');

const cors = require('cors'); // Añadido para manejar CORS

const axios = require('axios');

const port = process.env.PORT || 3001; // Puerto en el que correrá la aplicación

const app = express();



const personasRoutes = require('./routes/personasRouter');
const authRoutes = require('./routes/authRoutes');


const empleadosRoutes = require('./routes/empleadosRoutes');

 
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
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));



app.use('/personas', personasRoutes);
app.use('/auth', authRoutes);


app.use('/empleados', empleadosRoutes);



// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});
