// utils/logger.js - Sistema de logging optimizado para producción
const pino = require('pino');

// ✅ Configuración según entorno
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

// ✅ Nivel de log según entorno
// En producción: solo error, warn, info
// En desarrollo: incluye debug
const logLevel = isProduction ? 'info' : 'debug';

// ✅ Configuración de logger
const loggerConfig = {
  level: logLevel,
  // En producción: formato JSON para mejor parsing
  // En desarrollo: formato legible
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname'
      }
    }
  })
};

// ✅ Crear instancia del logger
const logger = pino(loggerConfig);

// ✅ Métodos de logging con contexto
const log = {
  // Error: errores críticos que requieren atención
  error: (message, context = {}) => {
    logger.error({ ...context }, message);
  },

  // Warn: advertencias que no bloquean pero son importantes
  warn: (message, context = {}) => {
    logger.warn({ ...context }, message);
  },

  // Info: información general de operaciones importantes
  info: (message, context = {}) => {
    logger.info({ ...context }, message);
  },

  // Debug: solo en desarrollo, información detallada
  debug: (message, context = {}) => {
    if (!isProduction) {
      logger.debug({ ...context }, message);
    }
  }
};

// ✅ Helper para migración gradual desde console.log
// Permite reemplazar console.log sin romper funcionalidad
const migrateFromConsole = {
  // Reemplazar console.log -> logger.info
  log: (message, ...args) => {
    if (isProduction) {
      // En producción, solo loguear si es importante
      return;
    }
    logger.info({ args }, message);
  },

  // Reemplazar console.error -> logger.error
  error: (message, ...args) => {
    logger.error({ args }, message);
  },

  // Reemplazar console.warn -> logger.warn
  warn: (message, ...args) => {
    logger.warn({ args }, message);
  }
};

module.exports = {
  logger,
  log,
  migrateFromConsole
};

