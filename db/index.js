const mysql = require('mysql2/promise');
require('dotenv').config();

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
    this.poolConfig = {
      connectionLimit: 10,
      queueLimit: 0
    };

    this.initializePool();
  }

  initializePool() {
    try {
      this.poolConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        idleTimeout: 60000,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        charset: 'utf8mb4',
        timezone: 'local',
        connectTimeout: 10000,
        multipleStatements: false,
        namedPlaceholders: false
      };

      this.pool = mysql.createPool(this.poolConfig);

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

  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Máximo número de intentos de reconexión alcanzado (${this.maxReconnectAttempts})`);
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

    setTimeout(() => {
      this.initializePool();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  async _runWithRetry(runQuery, label = 'consulta') {
    const maxRetries = 3;
    let currentRetry = 0;

    while (currentRetry < maxRetries) {
      try {
        if (!this.pool) {
          throw new Error('Pool de base de datos no inicializado');
        }

        const queryPromise = runQuery();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Query timeout: la consulta excedió 30 segundos')), 30000);
        });

        const [results] = await Promise.race([queryPromise, timeoutPromise]);
        return [results];
      } catch (error) {
        currentRetry++;
        console.error(`❌ Error en ${label} MySQL (intento ${currentRetry}/${maxRetries}):`, error.message);

        if (error.message.includes('timeout')) {
          console.error('⏱️ Query timeout - consulta muy lenta o bloqueada');
          throw new Error('La consulta está tardando demasiado. Por favor, intente nuevamente.');
        }

        if (
          (error.code === 'PROTOCOL_CONNECTION_LOST' ||
            error.code === 'ECONNREFUSED' ||
            error.fatal) &&
          currentRetry < maxRetries
        ) {
          console.log('🔄 Reintentando consulta en 2 segundos...');
          await new Promise((resolve) => setTimeout(resolve, 2000));

          if (!this.isConnected) {
            this.initializePool();
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }

          continue;
        }

        throw error;
      }
    }
  }

  /** Prepared statements (pool.execute) — evitar LIMIT/OFFSET como placeholders */
  async execute(query, params = []) {
    return this._runWithRetry(() => this.pool.execute(query, params), 'consulta preparada');
  }

  /** Text protocol (pool.query) — compatible con paginación LIMIT/OFFSET */
  async query(sql, params = []) {
    return this._runWithRetry(() => this.pool.query(sql, params), 'consulta');
  }

  async getConnection() {
    if (!this.pool) {
      throw new Error('Pool de base de datos no inicializado');
    }
    return this.pool.getConnection();
  }

  async end() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      console.log('🔌 Pool de MySQL cerrado correctamente');
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      poolExists: Boolean(this.pool),
      poolConfig: this.poolConfig
        ? {
            connectionLimit: this.poolConfig.connectionLimit || 10,
            queueLimit: this.poolConfig.queueLimit || 0
          }
        : null
    };
  }

  async getPoolStats() {
    if (!this.pool) {
      return { error: 'Pool no inicializado' };
    }

    try {
      const allConnections = this.pool._allConnections || [];
      const freeConnections = this.pool._freeConnections || [];
      const acquiringConnections = this.pool._acquiringConnections || [];

      return {
        totalConnections: allConnections.length,
        freeConnections: freeConnections.length,
        acquiringConnections: acquiringConnections.length,
        connectionLimit: this.poolConfig?.connectionLimit || 10,
        queueLimit: this.poolConfig?.queueLimit || 0
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas del pool:', error);
      return {
        error: 'Error al obtener estadísticas',
        message: error.message
      };
    }
  }
}

const dbManager = new DatabaseManager();

module.exports = {
  execute: (query, params) => dbManager.execute(query, params),
  query: (query, params) => dbManager.query(query, params),
  getConnection: () => dbManager.getConnection(),
  end: () => dbManager.end(),
  getStatus: () => dbManager.getStatus(),
  getPoolStats: () => dbManager.getPoolStats(),
  ...dbManager
};
