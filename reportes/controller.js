const { period } = require('./period');
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
  return {
    async get(req, res) {
      res.setHeader('Cache-Control', 'private, no-store');
      let connection;
      try {
        const p = period(req.query);
        connection = await getConnection();
        const data = await readReport(connection, p);
        const report = buildReport(data, p);
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
          `attachment; filename="reporte_gerencial_${data.periodo.desde}_${data.periodo.hasta}.pdf"`
        );
        res.send(pdf);
      } catch (error) {
        errorResponse(res, error);
      }
    },
  };
}
module.exports = { createController };
