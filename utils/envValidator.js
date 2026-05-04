// utils/envValidator.js - Validación de variables de entorno al inicio
// ✅ FASE 3: Validar variables críticas y fallar rápido si faltan

require('dotenv').config();

// ✅ Variables críticas requeridas
const requiredEnvVars = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_DATABASE',
    'JWT_SECRET',
    'PORT'
];

// ✅ Variables opcionales con valores por defecto
const optionalEnvVars = {
    'NODE_ENV': 'development',
    'DB_PORT': '3306',
    'DEFAULT_PUNTO_VENTA': '1'
};

/**
 * Validar que todas las variables críticas estén presentes
 */
const validateEnv = () => {
    const missing = [];
    const warnings = [];

    // Verificar variables requeridas
    requiredEnvVars.forEach(varName => {
        if (!process.env[varName] || process.env[varName].trim() === '') {
            missing.push(varName);
        }
    });

    // Aplicar valores por defecto para opcionales
    Object.entries(optionalEnvVars).forEach(([varName, defaultValue]) => {
        if (!process.env[varName]) {
            process.env[varName] = defaultValue;
            warnings.push(`${varName} no configurado, usando valor por defecto: ${defaultValue}`);
        }
    });

    // Si faltan variables críticas, fallar rápido
    if (missing.length > 0) {
        console.error('❌ ERROR: Variables de entorno faltantes:');
        missing.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        console.error('\n💡 Asegúrate de configurar todas las variables requeridas en el archivo .env');
        process.exit(1);
    }

    // Mostrar advertencias si hay valores por defecto
    if (warnings.length > 0) {
        console.warn('⚠️  Advertencias de configuración:');
        warnings.forEach(warning => {
            console.warn(`   - ${warning}`);
        });
    }

    // Validaciones adicionales
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
        console.warn('⚠️  JWT_SECRET es muy corto. Se recomienda al menos 32 caracteres para producción.');
    }

    if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'your-secret-key') {
        console.error('❌ ERROR: JWT_SECRET no puede ser el valor por defecto en producción');
        process.exit(1);
    }

    console.log('✅ Variables de entorno validadas correctamente');
};

module.exports = {
    validateEnv,
    requiredEnvVars,
    optionalEnvVars
};

