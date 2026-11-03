const express = require('express');
const alertasController = require('../controllers/alertasController');
const { requireManager } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/fiscales-pendientes', requireManager, alertasController.obtenerAlertasFiscalesPendientes);

module.exports = router;
