const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// ✅ FASE 3: Rate limiting estricto para login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Solo 10 intentos de login por IP cada 15 minutos
    message: 'Demasiados intentos de login desde esta IP, por favor intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // No contar requests exitosos
});

// Rutas públicas
router.post('/login', loginLimiter, authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

// Rutas protegidas
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
