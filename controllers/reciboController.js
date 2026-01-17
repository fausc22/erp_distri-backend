// controllers/reciboController.js
const googleSheetsService = require('../services/googleSheetsService');

/**
 * Obtener el próximo número de recibo
 */
const getNextNumber = async (req, res) => {
  try {
    const nextNumber = await googleSheetsService.getNextReceiptNumber();
    
    res.json({
      success: true,
      nextNumber: nextNumber
    });
  } catch (error) {
    console.error('Error en getNextNumber:', error);
    res.status(500).json({
      success: false,
      error: 'No se pudo obtener el próximo número de recibo',
      details: error.message
    });
  }
};

/**
 * Crear un nuevo recibo (escribir en Sheets)
 */
const createReceipt = async (req, res) => {
  try {
    // Validar que lleguen los datos necesarios
    const requiredFields = ['nro', 'fecha', 'cliente', 'monto'];
    const missingFields = requiredFields.filter(field => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Faltan campos obligatorios',
        missingFields: missingFields
      });
    }

    // Extraer datos del body
    const receiptData = {
      nro: req.body.nro,
      fecha: req.body.fecha,
      cliente: req.body.cliente,
      localidad: req.body.localidad || '',
      doc: req.body.doc || '',
      direccion: req.body.direccion || '',
      concepto: req.body.concepto || '',
      moneda: req.body.moneda || 'ARS',
      monto: req.body.monto,
      medio: req.body.medio || 'Efectivo',
      detalles: req.body.detalles || '',
      vendedor: req.body.vendedor || '',
      vehiculo: req.body.vehiculo || '',
      ts: req.body.ts || new Date().toISOString()
    };

    // Escribir en Google Sheets
    const result = await googleSheetsService.writeReceipt(receiptData);

    res.json({
      success: true,
      message: 'Recibo guardado correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error en createReceipt:', error);
    res.status(500).json({
      success: false,
      error: 'No se pudo guardar el recibo',
      details: error.message
    });
  }
};

/**
 * Test de conexión (opcional, para debugging)
 */
const testConnection = async (req, res) => {
  try {
    const result = await googleSheetsService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getNextNumber,
  createReceipt,
  testConnection
};