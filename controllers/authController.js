// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./dbPromise');
const { auditarAuth, limpiarDatosSensibles } = require('../middlewares/auditoriaMiddleware');

// Configuración de tiempos según el entorno
const getTokenExpiration = () => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    return {
        accessToken: isDevelopment ? '2h' : '15m',  // 2 horas en dev, 15 min en prod
        refreshToken: isDevelopment ? '30d' : '7d'  // 30 días en dev, 7 días en prod
    };
};





// Validar que los secrets estén configurados correctamente
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



exports.login = async (req, res) => {
    const { username, password, remember } = req.body;

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

        // Obtener configuración de tiempo
        const { accessToken: accessExp, refreshToken: refreshExp } = getTokenExpiration();

        // Generar tokens JWT
        const tokenPayload = { 
            id: empleado.id, 
            rol: empleado.rol,
            nombre: empleado.nombre,
            apellido: empleado.apellido,
            usuario: empleado.usuario,
            iat: Math.floor(Date.now() / 1000) // issued at
        };

        console.log('🔑 Generando tokens con:', {
            secret: process.env.JWT_SECRET.substring(0, 10) + '...',
            accessExp,
            refreshExp,
            payload: { ...tokenPayload, iat: undefined }
        });

        const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: accessExp });
        const refreshToken = jwt.sign(
            { id: empleado.id, iat: Math.floor(Date.now() / 1000) }, 
            process.env.JWT_REFRESH_SECRET, 
            { expiresIn: refreshExp }
        );

        // Configurar cookie del refresh token
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            maxAge: remember ? (parseInt(refreshExp.replace('d', '')) * 24 * 60 * 60 * 1000) : undefined
        };

        if (remember) {
            res.cookie('refreshToken', refreshToken, cookieOptions);
        }

        // Auditar login exitoso
        await auditarAuth(req, {
            accion: 'LOGIN',
            usuarioId: empleado.id,
            usuarioNombre: `${empleado.nombre} ${empleado.apellido}`,
            estado: 'EXITOSO',
            detallesAdicionales: `Login exitoso - Rol: ${empleado.rol}, Remember: ${remember ? 'Sí' : 'No'}, TokenExp: ${accessExp}`
        });

        console.log(`✅ Login exitoso para ${empleado.usuario} - Token expira en: ${accessExp}`);

        // Respuesta con información del empleado
        res.json({ 
            token: accessToken,
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
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
        return res.status(401).json({ message: 'No autorizado - Refresh token requerido' });
    }

    try {
        console.log('🔄 Intentando renovar token...');
        
        // Verificar refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        
        // Obtener información actualizada del empleado
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
            
            // Limpiar cookie inválida
            res.clearCookie('refreshToken');
            return res.status(404).json({ message: 'Empleado no encontrado o inactivo' });
        }

        const empleado = empleados[0];
        const { accessToken: accessExp } = getTokenExpiration();

        // Generar nuevo access token
        const tokenPayload = { 
            id: empleado.id, 
            rol: empleado.rol,
            nombre: empleado.nombre,
            apellido: empleado.apellido,
            usuario: empleado.usuario,
            iat: Math.floor(Date.now() / 1000)
        };

        const newAccessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: accessExp });
        
        // Auditar refresh exitoso
        await auditarAuth(req, {
            accion: 'LOGIN',
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
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Refresh token expirado - Por favor inicia sesión nuevamente' });
        }
        
        res.status(403).json({ message: 'Refresh token inválido' });
    }
};

exports.logout = async (req, res) => {
    try {
        // Auditar logout
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
        
        res.clearCookie('refreshToken');
        res.json({ message: 'Logout exitoso' });
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

        // Auditar cambio exitoso de contraseña
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