const v1 = require('./reglas/v1');

function calcular(input = {}) {
  const version = input.regla_version ?? 'v1';
  if (version !== 'v1') {
    return {
      ok: false,
      code: 'REGLA_NO_SOPORTADA',
      regla_version: version,
    };
  }
  return v1.calcular(input);
}

module.exports = {
  calcular,
};
