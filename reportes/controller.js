const { resolveReportRequest } = require('./period');
const { readReport } = require('./repository');
const { buildReport } = require('./buildReport');
const { createSnapshotStore } = require('./snapshots');
const snapshots = createSnapshotStore();

function createController({
  getConnection = () => require('../db').getConnection(),
  store = snapshots,
  renderPDF = (data) => require('./pdf').renderPDF(data),
} = {}) {
  const errorResponse = (res, error) => {
    if (!error.status) console.error('Reportes financieros v2:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status
        ? error.message
        : 'No se pudo construir un reporte conciliado. No se muestran importes incompletos.',
    });
  };

  const filenameFor = (data) => {
    if (data.tipo === 'comparacion') {
      const keys = (data.periodos || [])
        .map((p) => p.periodo?.mes || p.periodo?.desde?.slice(0, 7))
        .filter(Boolean)
        .join('_');
      return `reporte_comparacion_${keys || 'meses'}.pdf`;
    }
    if (data.tipo === 'anual') {
      return `reporte_anual_${data.anio || data.periodo?.desde?.slice(0, 4)}.pdf`;
    }
    return `reporte_gerencial_${data.periodo.desde}_${data.periodo.hasta}.pdf`;
  };

  return {
    async get(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      let connection;
      try {
        const request = resolveReportRequest(req.query);
        connection = await getConnection();

        if (request.tipo === 'comparacion') {
          const periodos = [];
          for (const p of request.periodos) {
            const raw = await readReport(connection, p);
            periodos.push({
              ...buildReport(raw, p),
              periodo: { ...p },
            });
          }
          const payload = {
            tipo: 'comparacion',
            generado_en: new Date().toISOString(),
            version: '2.0',
            periodos,
          };
          res.json({ success: true, data: store.put(req.user.id, payload) });
          return;
        }

        if (request.tipo === 'anual') {
          const raw = await readReport(connection, request.periodo);
          const report = {
            ...buildReport(raw, request.periodo),
            tipo: 'anual',
            anio: request.anio,
          };
          res.json({ success: true, data: store.put(req.user.id, report) });
          return;
        }

        const raw = await readReport(connection, request.periodo);
        const report = {
          ...buildReport(raw, request.periodo),
          tipo: 'mensual',
        };
        res.json({ success: true, data: store.put(req.user.id, report) });
      } catch (error) {
        errorResponse(res, error);
      } finally {
        if (connection) connection.release();
      }
    },
    async pdf(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        const data = store.get(req.user.id, req.params.snapshotId);
        const pdf = Buffer.from(await renderPDF(data));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filenameFor(data)}"`
        );
        res.send(pdf);
      } catch (error) {
        errorResponse(res, error);
      }
    },
  };
}
module.exports = { createController };
