// middleware/auth.js
const jwt = require('jsonwebtoken');

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
    // Acepta tanto 'Bearer TOKEN' como solo 'TOKEN'
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : authHeader;
    
    if (!token) return res.status(401).json({ message: 'Acceso denegado' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token inválido' });
        req.user = user; // Incluye: id, rol, nombre, apellido, usuario
        next();
    });
};

const authorizeRole = (roles) => {
    return (req, res, next) => {
        
        
        if (!roles.includes(req.user.rol)) {
            
            return res.status(403).json({ message: 'No tienes permisos para esta acción' });
        }
        
        
        next();
    };
};

// Middlewares combinados para casos comunes
const requireManager = [authenticateToken, authorizeRole(['GERENTE'])];
const requireEmployee = [authenticateToken, authorizeRole(['GERENTE', 'VENDEDOR'])];

module.exports = { 
    authenticateToken, 
    authorizeRole,
    requireManager,
    requireEmployee
};