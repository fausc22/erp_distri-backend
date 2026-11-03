const express = require('express');
const router = express.Router();
const { requireManager } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const reportesCortes = require('../services/reportesCortes');
const { consultarProyeccion } = require('../consultas/proyeccion');

/**
 * Crear corte gerencial reproducible
 * POST /cortes  { tipo, desde, hasta, estado? }
 */
router.post(
  '/',
  requireManager,
  middlewareAuditoria({ accion: 'INSERT', tabla: 'reportes_cortes', incluirBody: true }),
  async (req, res) => {
    try {
      const { tipo = 'GERENCIAL', desde, hasta, estado = 'GENERADO' } = req.body || {};
      if (!desde || !hasta) {
        return res.status(400).json({ success: false, message: 'desde y hasta son requeridos' });
      }
      const documentos = await consultarProyeccion({ desde, hasta });
      const corte = await reportesCortes.crearCorte({
        tipo,
        desde,
        hasta,
        documentos,
        parametros: { desde, hasta, tipo, usuarioNombre: req.user?.nombre || null },
        usuarioId: req.user?.id || null,
        estado: estado === 'PROVISIONAL' || estado === 'FINAL' ? 'GENERADO' : estado
      });
      return res.json({ success: true, data: corte });
    } catch (error) {
      console.error('Error creando corte:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.get(
  '/:id',
  requireManager,
  async (req, res) => {
    try {
      const corte = await reportesCortes.obtenerCorte(Number(req.params.id));
      if (!corte) return res.status(404).json({ success: false, message: 'Corte no encontrado' });
      return res.json({ success: true, data: corte });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

module.exports = router;
