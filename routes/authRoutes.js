const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Rate limiting para login (permisivo; sistema interno 4-5 usuarios)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Demasiados intentos de login desde esta IP, por favor intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    validate: { xForwardedForHeader: false }
});

// Rutas públicas
router.post('/login', loginLimiter, authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

// Rutas protegidas
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
