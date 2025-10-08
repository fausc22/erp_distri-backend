// routes/ciudadesRoutes.js - CREAR ESTE NUEVO ARCHIVO

const express = require('express');
const ciudadesController = require('../controllers/ciudadesController');
const { requireEmployee } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

// Listar todas las ciudades
router.get('/listar',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ciudades' }),
    ciudadesController.listarCiudades
);

// Obtener ciudad por ID
router.get('/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ciudades' }),
    ciudadesController.obtenerCiudadPorId
);

module.exports = router;