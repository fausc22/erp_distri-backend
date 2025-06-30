const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./dbPromise');
const { auditarAuth, limpiarDatosSensibles } = require('../middlewares/auditoriaMiddleware');

// ✅ Configuración mejorada de tiempos de token
const getTokenExpiration = () => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    return {
        accessToken: isDevelopment ? '2h' : '1h',      // Reducido para mayor seguridad
        refreshToken: isDevelopment ? '30d' : '30d'    // Mantenemos 30 días para "recuérdame"
    };
};

// ✅ Validar que los secrets estén configurados correctamente
const validateSecrets = () => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        console.error('❌ JWT_SECRET debe tener al menos 32 caracteres');
        process.exit(1);
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
        console.error('❌ JWT_REFRESH_SECRET debe tener al menos 32 caracteres');
        process.exit(1);
    }
};

// Validar secrets al inicio
validateSecrets();

// ✅ Función helper para crear tokens
const createTokens = (empleado, remember = false) => {
    const { accessToken: accessExp, refreshToken: refreshExp } = getTokenExpiration();

    const tokenPayload = { 
        id: empleado.id, 
        rol: empleado.rol,
        nombre: empleado.nombre,
        apellido: empleado.apellido,
        usuario: empleado.usuario,
        iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: accessExp });
    
    // Solo crear refresh token si el usuario marca "recuérdame"
    let refreshToken = null;
    if (remember) {
        refreshToken = jwt.sign(
            { id: empleado.id, iat: Math.floor(Date.now() / 1000) }, 
            process.env.JWT_REFRESH_SECRET, 
            { expiresIn: refreshExp }
        );
    }

    return { accessToken, refreshToken, accessExp, refreshExp };
};

// ✅ Función helper para configurar cookies
const setRefreshTokenCookie = (res, refreshToken, remember) => {
    if (!refreshToken) {
        // Limpiar cookie si no hay refresh token
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
        });
        return;
    }

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: remember ? (30 * 24 * 60 * 60 * 1000) : undefined // 30 días si remember, sino session
    };

    res.cookie('refreshToken', refreshToken, cookieOptions);
};

exports.login = async (req, res) => {
    const { username, password, remember = false } = req.body;

    if (!username || !password) {
        await auditarAuth(req, {
            accion: 'LOGIN_FAILED',
            usuarioNombre: username || 'DESCONOCIDO',
            estado: 'FALLIDO',
            detallesAdicionales: 'Datos incompletos - usuario y/o contraseña faltante'
        });
        
        return res.status(400).json({ message: 'Usuario y contraseña son obligatorios' });
    }

    try {
        // Buscar empleado activo por usuario
        const [empleados] = await db.execute(
            'SELECT * FROM empleados WHERE usuario = ? AND activo = 1', 
            [username]
        );

        if (empleados.length === 0) {
            await auditarAuth(req, {
                accion: 'LOGIN_FAILED',
                usuarioNombre: username,
                estado: 'FALLIDO',
                detallesAdicionales: 'Usuario no encontrado o inactivo'
            });
            
            return res.status(401).json({ message: 'Usuario no encontrado o inactivo' });
        }

        const empleado = empleados[0];

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, empleado.password);
        if (!validPassword) {
            await auditarAuth(req, {
                accion: 'LOGIN_FAILED',
                usuarioId: empleado.id,
                usuarioNombre: `${empleado.nombre} ${empleado.apellido}`,
                estado: 'FALLIDO',
                detallesAdicionales: 'Contraseña incorrecta'
            });
            
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        // ✅ Crear tokens con configuración mejorada
        const { accessToken, refreshToken, accessExp } = createTokens(empleado, remember);

        // ✅ Configurar cookie de refresh token
        setRefreshTokenCookie(res, refreshToken, remember);

        // ✅ Auditar login exitoso con más detalles
        await auditarAuth(req, {
            accion: 'LOGIN',
            usuarioId: empleado.id,
            usuarioNombre: `${empleado.nombre} ${empleado.apellido}`,
            estado: 'EXITOSO',
            detallesAdicionales: `Login exitoso - Rol: ${empleado.rol}, Remember: ${remember ? 'Sí' : 'No'}, TokenExp: ${accessExp}, RefreshToken: ${refreshToken ? 'Sí' : 'No'}`
        });

        console.log(`✅ Login exitoso para ${empleado.usuario} - Remember: ${remember} - Token expira en: ${accessExp}`);

        // ✅ Respuesta con información del empleado
        res.json({ 
            token: accessToken,
            expiresIn: accessExp,
            hasRefreshToken: !!refreshToken,
            empleado: {
                id: empleado.id,
                nombre: empleado.nombre,
                apellido: empleado.apellido,
                usuario: empleado.usuario,
                rol: empleado.rol,
                email: empleado.email,
                telefono: empleado.telefono
            }
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        
        await auditarAuth(req, {
            accion: 'LOGIN_FAILED',
            usuarioNombre: username,
            estado: 'FALLIDO',
            detallesAdicionales: `Error interno del servidor: ${error.message}`
        });
        
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.refreshToken = async (req, res) => {
    // ✅ Manejo seguro de cookies con verificación
    const refreshToken = req.cookies?.refreshToken;
    
    if (!refreshToken) {
        console.log('❌ No se encontró refresh token en cookies');
        return res.status(401).json({ 
            message: 'No autorizado - Refresh token requerido',
            code: 'NO_REFRESH_TOKEN'
        });
    }

    try {
        console.log('🔄 Intentando renovar token...');
        
        // ✅ Verificar refresh token con manejo de errores específicos
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        } catch (jwtError) {
            console.log('❌ Error verificando refresh token:', jwtError.message);
            
            // Limpiar cookie inválida
            res.clearCookie('refreshToken');
            
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    message: 'Refresh token expirado - Por favor inicia sesión nuevamente',
                    code: 'REFRESH_TOKEN_EXPIRED'
                });
            }
            
            return res.status(403).json({ 
                message: 'Refresh token inválido',
                code: 'REFRESH_TOKEN_INVALID'
            });
        }
        
        // ✅ Obtener información actualizada del empleado
        const [empleados] = await db.execute(
            'SELECT * FROM empleados WHERE id = ? AND activo = 1', 
            [decoded.id]
        );
        
        if (empleados.length === 0) {
            await auditarAuth(req, {
                accion: 'LOGIN_FAILED',
                usuarioId: decoded.id,
                estado: 'FALLIDO',
                detallesAdicionales: 'Refresh token - Empleado no encontrado o inactivo'
            });
            
            res.clearCookie('refreshToken');
            return res.status(404).json({ 
                message: 'Empleado no encontrado o inactivo',
                code: 'USER_NOT_FOUND'
            });
        }

        const empleado = empleados[0];

        // ✅ Generar nuevo access token (mantener refresh token existente)
        const { accessToken: accessExp } = getTokenExpiration();
        const tokenPayload = { 
            id: empleado.id, 
            rol: empleado.rol,
            nombre: empleado.nombre,
            apellido: empleado.apellido,
            usuario: empleado.usuario,
            iat: Math.floor(Date.now() / 1000)
        };

        const newAccessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: accessExp });
        
        // ✅ Auditar refresh exitoso
        await auditarAuth(req, {
            accion: 'TOKEN_REFRESH',
            usuarioId: empleado.id,
            usuarioNombre: `${empleado.nombre} ${empleado.apellido}`,
            estado: 'EXITOSO',
            detallesAdicionales: `Token renovado exitosamente - Exp: ${accessExp}`
        });

        console.log(`✅ Token renovado para ${empleado.usuario} - Expira en: ${accessExp}`);
        
        res.json({ 
            accessToken: newAccessToken,
            expiresIn: accessExp,
            empleado: {
                id: empleado.id,
                nombre: empleado.nombre,
                apellido: empleado.apellido,
                usuario: empleado.usuario,
                rol: empleado.rol,
                email: empleado.email,
                telefono: empleado.telefono
            }
        });

    } catch (error) {
        console.error('❌ Error en refresh token:', error);
        
        // Limpiar cookie inválida
        res.clearCookie('refreshToken');
        
        // ✅ Auditar error en refresh
        await auditarAuth(req, {
            accion: 'TOKEN_REFRESH_FAILED',
            estado: 'FALLIDO',
            detallesAdicionales: `Error en refresh token: ${error.message}`
        });
        
        res.status(500).json({ 
            message: 'Error interno del servidor',
            code: 'INTERNAL_ERROR'
        });
    }
};

exports.logout = async (req, res) => {
    try {
        // ✅ Auditar logout
        if (req.user) {
            await auditarAuth(req, {
                accion: 'LOGOUT',
                usuarioId: req.user.id,
                usuarioNombre: `${req.user.nombre} ${req.user.apellido}`,
                estado: 'EXITOSO',
                detallesAdicionales: 'Logout exitoso'
            });
            
            console.log(`👋 Logout para ${req.user.usuario}`);
        }
        
        // ✅ Limpiar cookie de refresh token de forma segura
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
        });
        
        res.json({ 
            message: 'Logout exitoso',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error en logout:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const empleadoId = req.user.id;
        
        const [empleados] = await db.execute(
            'SELECT id, nombre, apellido, dni, telefono, email, usuario, rol FROM empleados WHERE id = ? AND activo = 1', 
            [empleadoId]
        );

        if (empleados.length === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        res.json({ empleado: empleados[0] });

    } catch (error) {
        console.error('❌ Error al obtener perfil:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const empleadoId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Contraseña actual y nueva son obligatorias' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        // Verificar contraseña actual
        const [empleados] = await db.execute(
            'SELECT password FROM empleados WHERE id = ? AND activo = 1', 
            [empleadoId]
        );
        
        if (empleados.length === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        const validPassword = await bcrypt.compare(currentPassword, empleados[0].password);
        if (!validPassword) {
            await auditarAuth(req, {
                accion: 'PASSWORD_CHANGE',
                usuarioId: req.user.id,
                usuarioNombre: `${req.user.nombre} ${req.user.apellido}`,
                estado: 'FALLIDO',
                detallesAdicionales: 'Contraseña actual incorrecta'
            });
            
            return res.status(401).json({ message: 'Contraseña actual incorrecta' });
        }

        // Encriptar nueva contraseña
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // Actualizar contraseña
        await db.execute(
            'UPDATE empleados SET password = ? WHERE id = ?', 
            [hashedNewPassword, empleadoId]
        );

        // ✅ Auditar cambio exitoso de contraseña
        await auditarAuth(req, {
            accion: 'PASSWORD_CHANGE',
            usuarioId: req.user.id,
            usuarioNombre: `${req.user.nombre} ${req.user.apellido}`,
            estado: 'EXITOSO',
            detallesAdicionales: 'Contraseña actualizada exitosamente'
        });

        res.json({ message: 'Contraseña actualizada exitosamente' });

    } catch (error) {
        console.error('❌ Error al cambiar contraseña:', error);
        
        if (req.user) {
            await auditarAuth(req, {
                accion: 'PASSWORD_CHANGE',
                usuarioId: req.user.id,
                usuarioNombre: `${req.user.nombre} ${req.user.apellido}`,
                estado: 'FALLIDO',
                detallesAdicionales: `Error interno: ${error.message}`
            });
        }
        
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};