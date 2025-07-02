// controllers/db.js - VERSIÓN CORREGIDA SIN WARNINGS
const mysql = require('mysql2');
require('dotenv').config();

// ✅ CONFIGURACIÓN SIMPLE Y VÁLIDA
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT || 3306,
    // ✅ Solo opciones VÁLIDAS para mysql2
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: 'local'
});

// ✅ Eventos del pool para debugging
pool.on('connection', function (connection) {
    console.log('🔗 Nueva conexión MySQL establecida como id ' + connection.threadId);
});

pool.on('error', function(err) {
    console.error('🔴 Error en pool MySQL:', err);
    if(err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('💔 Conexión MySQL perdida');
    }
});

// ✅ Test de conexión inicial
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos:', err);
        return;
    }
    console.log('✅ Conectado a la base de datos MySQL');
    connection.release();
});

// ✅ Exportar pool y métodos de compatibilidad
module.exports = {
    // Método query principal para compatibilidad
    query: (sql, params, callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        pool.query(sql, params, callback);
    },
    
    // Método execute para promesas
    execute: (sql, params) => {
        return new Promise((resolve, reject) => {
            pool.execute(sql, params, (err, results) => {
                if (err) return reject(err);
                resolve([results]);
            });
        });
    },
    
    // Obtener conexión directa
    getConnection: (callback) => pool.getConnection(callback),
    
    // Método connect para compatibilidad
    connect: (callback) => {
        pool.getConnection((err, connection) => {
            if (connection) connection.release();
            if (callback) callback(err);
        });
    },
    
    // Transacciones
    beginTransaction: (callback) => {
        pool.getConnection((err, connection) => {
            if (err) return callback(err);
            connection.beginTransaction((err) => {
                if (err) {
                    connection.release();
                    return callback(err);
                }
                callback(null, connection);
            });
        });
    },
    
    // Cerrar pool
    end: () => {
        return new Promise((resolve, reject) => {
            pool.end((err) => {
                if (err) return reject(err);
                console.log('🔌 Pool MySQL cerrado');
                resolve();
            });
        });
    },
    
    // Acceso directo al pool
    pool: pool
};