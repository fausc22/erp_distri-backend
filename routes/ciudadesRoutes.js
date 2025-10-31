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

// Buscar ciudades (DEBE IR ANTES de /:id)
router.get('/buscar',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ciudades', incluirQuery: true }),
    ciudadesController.buscarCiudades
);

// Obtener ciudad por ID (DEBE IR DESPUÉS de rutas específicas)
router.get('/:id',
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ciudades' }),
    ciudadesController.obtenerCiudadPorId
);


module.exports = router;