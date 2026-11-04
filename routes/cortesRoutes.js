const express = require('express');
const router = express.Router();

// Cortes persistidos (reportes_cortes) no están desplegados. No consultar esas tablas.
const noDisponible = (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'Los cortes persistidos no están disponibles. Use reportes financieros.'
  });
};

router.post('/', noDisponible);
router.get('/:id', noDisponible);

module.exports = router;
