// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./dbPromise');

exports.login = async (req, res) => {
    const { username, password, remember } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Usuario y contraseña son obligatorios' });
    }

    try {
        // Buscar empleado activo por usuario
        const [empleados] = await db.execute(
            'SELECT * FROM empleados WHERE usuario = ? AND activo = 1', 
            [username]
        );

        if (empleados.length === 0) {
            return res.status(401).json({ message: 'Usuario no encontrado o inactivo' });
        }

        const empleado = empleados[0];

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, empleado.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        // Generar tokens JWT
        const tokenPayload = { 
            id: empleado.id, 
            rol: empleado.rol,
            nombre: empleado.nombre,
            apellido: empleado.apellido,
            usuario: empleado.usuario
        };

        const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign({ id: empleado.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

        // Si "remember" está activado, guardar el refreshToken en cookies
        if (remember) {
            res.cookie('refreshToken', refreshToken, { 
                httpOnly: true, 
                secure: process.env.NODE_ENV === 'production', 
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
            });
        }

        // Respuesta con información del empleado (sin datos sensibles)
        res.json({ 
            token: accessToken, 
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
        console.error('Error en login:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.refreshToken = async (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
        return res.status(401).json({ message: 'No autorizado - Token requerido' });
    }

    try {
        // Verificar refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        
        // Obtener información actualizada del empleado
        const [empleados] = await db.execute(
            'SELECT * FROM empleados WHERE id = ? AND activo = 1', 
            [decoded.id]
        );
        
        if (empleados.length === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado o inactivo' });
        }

        const empleado = empleados[0];

        // Generar nuevo access token
        const tokenPayload = { 
            id: empleado.id, 
            rol: empleado.rol,
            nombre: empleado.nombre,
            apellido: empleado.apellido,
            usuario: empleado.usuario
        };

        const newAccessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '15m' });
        
        res.json({ 
            accessToken: newAccessToken,
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
        console.error('Error en refresh token:', error);
        res.status(403).json({ message: 'Token inválido' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('refreshToken');
    res.json({ message: 'Logout exitoso' });
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
        console.error('Error al obtener perfil:', error);
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
            return res.status(401).json({ message: 'Contraseña actual incorrecta' });
        }

        // Encriptar nueva contraseña
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // Actualizar contraseña
        await db.execute(
            'UPDATE empleados SET password = ? WHERE id = ?', 
            [hashedNewPassword, empleadoId]
        );

        res.json({ message: 'Contraseña actualizada exitosamente' });

    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};