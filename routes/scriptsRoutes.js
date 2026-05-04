const express = require('express');
const scriptsController = require('../controllers/scriptsController');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');

const router = express.Router();

router.get(
    '/update-productos',
    middlewareAuditoria({ accion: 'UPDATE', tabla: 'productos', incluirQuery: true }),
    scriptsController.executeProductsUpdate
);

// GET /scripts/update-clientes o POST /scripts/update-clientes (también /update-clientes si el router se monta en /)
router.get(
    '/update-clientes',
    middlewareAuditoria({ accion: 'INSERT', tabla: 'clientes', incluirQuery: true }),
    scriptsController.executeClientesUpdate
);
router.post(
    '/update-clientes',
    middlewareAuditoria({ accion: 'INSERT', tabla: 'clientes', incluirQuery: true }),
    scriptsController.executeClientesUpdate
);

module.exports = router;
