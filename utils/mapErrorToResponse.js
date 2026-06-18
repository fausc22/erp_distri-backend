const AppError = require('../errors/AppError');

function mapErrorToResponse(error, res) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details || undefined
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Error interno del servidor'
  });
}

module.exports = { mapErrorToResponse };
