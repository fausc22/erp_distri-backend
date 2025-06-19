// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// Middleware para verificar JWT con mejor manejo de errores
const authenticateToken = (req, res, next) => {
    // Acepta tanto 'Bearer TOKEN' como solo 'TOKEN'
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : authHeader;
    
    if (!token) {
        console.log('❌ Token no proporcionado en:', req.originalUrl);
        return res.status(401).json({ 
            message: 'Acceso denegado - Token requerido',
            code: 'NO_TOKEN'
        });
    }

    // Verificar que el JWT_SECRET esté configurado
    if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET no configurado');
        return res.status(500).json({ 
            message: 'Error de configuración del servidor',
            code: 'CONFIG_ERROR'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.log('❌ Error verificando token:', {
                error: err.name,
                message: err.message,
                url: req.originalUrl,
                tokenStart: token.substring(0, 20) + '...'
            });

            // Diferentes tipos de errores de JWT
            switch (err.name) {
                case 'TokenExpiredError':
                    return res.status(401).json({ 
                        message: 'Token expirado - Por favor renueva tu sesión',
                        code: 'TOKEN_EXPIRED',
                        expiredAt: err.expiredAt
                    });
                case 'JsonWebTokenError':
                    return res.status(403).json({ 
                        message: 'Token inválido - Por favor inicia sesión nuevamente',
                        code: 'TOKEN_INVALID'
                    });
                case 'NotBeforeError':
                    return res.status(403).json({ 
                        message: 'Token no activo aún',
                        code: 'TOKEN_NOT_ACTIVE'
                    });
                default:
                    return res.status(403).json({ 
                        message: 'Error de autenticación',
                        code: 'AUTH_ERROR'
                    });
            }
        }

        // Verificar que el token tenga la estructura esperada
        if (!user.id || !user.rol || !user.usuario) {
            console.log('❌ Token con estructura inválida:', user);
            return res.status(403).json({ 
                message: 'Token con formato inválido',
                code: 'TOKEN_FORMAT_INVALID'
            });
        }

        req.user = user;
        
        // Log exitoso en desarrollo
        if (process.env.NODE_ENV === 'development') {
            console.log(`✅ Usuario autenticado: ${user.usuario} (${user.rol}) en ${req.originalUrl}`);
        }
        
        next();
    });
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            console.log('❌ Usuario no autenticado en autorización de rol');
            return res.status(401).json({ 
                message: 'Usuario no autenticado',
                code: 'NOT_AUTHENTICATED'
            });
        }
        
        if (!roles.includes(req.user.rol)) {
            console.log(`❌ Rol no autorizado: ${req.user.rol} necesita ${roles.join(' o ')} para ${req.originalUrl}`);
            return res.status(403).json({ 
                message: `No tienes permisos para esta acción. Rol requerido: ${roles.join(' o ')}`,
                code: 'INSUFFICIENT_ROLE',
                userRole: req.user.rol,
                requiredRoles: roles
            });
        }
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`✅ Rol autorizado: ${req.user.rol} para ${req.originalUrl}`);
        }
        
        next();
    };
};

// Middleware para debug de tokens en desarrollo
const debugToken = (req, res, next) => {
    if (process.env.NODE_ENV === 'development') {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;

        if (token) {
            try {
                // Decodificar sin verificar para debug
                const decoded = jwt.decode(token, { complete: true });
                console.log('🔍 Token debug:', {
                    header: decoded?.header,
                    payload: {
                        ...decoded?.payload,
                        exp: decoded?.payload?.exp ? new Date(decoded.payload.exp * 1000).toISOString() : undefined,
                        iat: decoded?.payload?.iat ? new Date(decoded.payload.iat * 1000).toISOString() : undefined
                    }
                });
            } catch (e) {
                console.log('❌ Token no decodificable:', token.substring(0, 20) + '...');
            }
        }
    }
    next();
};

// Middlewares combinados para casos comunes
const requireManager = [authenticateToken, authorizeRole(['GERENTE'])];
const requireEmployee = [authenticateToken, authorizeRole(['GERENTE', 'VENDEDOR'])];

// Middleware para verificar tokens con renovación automática (opcional)
const authenticateWithRefresh = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : authHeader;
    
    if (!token) {
        return res.status(401).json({ 
            message: 'Token requerido',
            code: 'NO_TOKEN'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err && err.name === 'TokenExpiredError') {
            // Si el token expiró, sugerir renovación
            return res.status(401).json({ 
                message: 'Token expirado',
                code: 'TOKEN_EXPIRED',
                shouldRefresh: true
            });
        } else if (err) {
            return res.status(403).json({ 
                message: 'Token inválido',
                code: 'TOKEN_INVALID'
            });
        }

        req.user = user;
        next();
    });
};

module.exports = { 
    authenticateToken, 
    authorizeRole,
    requireManager,
    requireEmployee,
    debugToken,
    authenticateWithRefresh
};