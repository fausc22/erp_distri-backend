const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Rutas públicas
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

// Rutas protegidas
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
