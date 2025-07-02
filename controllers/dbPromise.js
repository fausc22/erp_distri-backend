const mysql = require('mysql2/promise');
require('dotenv').config();

class DatabaseManager {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 segundos
        
        this.initializePool();
    }

    initializePool() {
        try {
            this.pool = mysql.createPool({
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_DATABASE,
                port: process.env.DB_PORT || 3306,
                // ✅ Configuraciones VÁLIDAS para mysql2
                waitForConnections: true,
                connectionLimit: 10,
                maxIdle: 10,
                idleTimeout: 60000,
                queueLimit: 0,
                enableKeepAlive: true,
                keepAliveInitialDelay: 0,
                charset: 'utf8mb4',
                timezone: 'local',
                // ✅ Configuraciones específicas de mysql2
                multipleStatements: false,
                namedPlaceholders: false
            });

            // ✅ Manejar eventos del pool
            this.pool.on('connection', (connection) => {
                console.log('🔗 Nueva conexión MySQL establecida como id ' + connection.threadId);
                this.isConnected = true;
                this.reconnectAttempts = 0;
            });

            this.pool.on('error', (err) => {
                console.error('🔴 Error en el pool de MySQL:', err);
                this.isConnected = false;
                
                if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.fatal) {
                    console.log('💔 Conexión perdida, intentando reconectar...');
                    this.handleReconnect();
                }
            });

            // ✅ Test inicial de conexión
            this.testConnection();

        } catch (error) {
            console.error('❌ Error inicializando pool de MySQL:', error);
            this.handleReconnect();
        }
    }

    async testConnection() {
        try {
            const connection = await this.pool.getConnection();
            await connection.ping();
            connection.release();
            
            console.log('✅ Conexión a MySQL establecida correctamente');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
        } catch (error) {
            console.error('❌ Error al probar conexión MySQL:', error);
            this.isConnected = false;
            this.handleReconnect();
        }
    }

    async handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`❌ Máximo número de intentos de reconexión alcanzado (${this.maxReconnectAttempts})`);
            return;
        }

        this.reconnectAttempts++;
        console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

        setTimeout(() => {
            this.initializePool();
        }, this.reconnectDelay * this.reconnectAttempts); // Backoff exponencial
    }

    async execute(query, params = []) {
        const maxRetries = 3;
        let currentRetry = 0;

        while (currentRetry < maxRetries) {
            try {
                if (!this.pool) {
                    throw new Error('Pool de base de datos no inicializado');
                }

                const [results] = await this.pool.execute(query, params);
                return [results];

            } catch (error) {
                currentRetry++;
                console.error(`❌ Error en consulta MySQL (intento ${currentRetry}/${maxRetries}):`, error.message);

                // Si es un error de conexión y no hemos agotado los reintentos
                if ((error.code === 'PROTOCOL_CONNECTION_LOST' || 
                     error.code === 'ECONNREFUSED' || 
                     error.fatal) && currentRetry < maxRetries) {
                    
                    console.log(`🔄 Reintentando consulta en 2 segundos...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Reinicializar pool si es necesario
                    if (!this.isConnected) {
                        this.initializePool();
                        await new Promise(resolve => setTimeout(resolve, 3000)); // Esperar inicialización
                    }
                    
                    continue;
                }

                // Si no es un error de conexión o hemos agotado reintentos, lanzar error
                throw error;
            }
        }
    }

    async query(sql, params = []) {
        // Alias para compatibilidad
        return this.execute(sql, params);
    }

    async getConnection() {
        if (!this.pool) {
            throw new Error('Pool de base de datos no inicializado');
        }
        return await this.pool.getConnection();
    }

    async end() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.isConnected = false;
            console.log('🔌 Pool de MySQL cerrado correctamente');
        }
    }

    // ✅ Método para verificar estado de la conexión
    getStatus() {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            poolExists: !!this.pool,
            poolConfig: this.pool ? {
                connectionLimit: this.pool.config.connectionLimit,
                queueLimit: this.pool.config.queueLimit
            } : null
        };
    }

    // ✅ Método para obtener estadísticas del pool
    async getPoolStats() {
        if (!this.pool) {
            return { error: 'Pool no inicializado' };
        }

        return {
            totalConnections: this.pool._allConnections?.length || 0,
            freeConnections: this.pool._freeConnections?.length || 0,
            acquiringConnections: this.pool._acquiringConnections?.length || 0,
            connectionLimit: this.pool.config.connectionLimit,
            queueLimit: this.pool.config.queueLimit
        };
    }
}

// ✅ Crear instancia única
const dbManager = new DatabaseManager();

// ✅ Exportar métodos del manager
module.exports = {
    execute: (query, params) => dbManager.execute(query, params),
    query: (query, params) => dbManager.query(query, params),
    getConnection: () => dbManager.getConnection(),
    end: () => dbManager.end(),
    getStatus: () => dbManager.getStatus(),
    getPoolStats: () => dbManager.getPoolStats(),
    
    // Para compatibilidad con código existente
    ...dbManager
};