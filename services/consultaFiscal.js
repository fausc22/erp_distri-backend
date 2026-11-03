const { centavos } = require('../dominio/calculo/documento');

// El contexto identifica la consulta específica enviada al servicio, no un campo
// supuesto de la respuesta. Se conserva separado de la evidencia recibida.
function normalizarConsulta(v, contexto) {
  if (!v) return null;
  const fields = ['CodAutorizacion','EmisionTipo','FchVto','FchProceso','Resultado','Concepto',
    'DocTipo','DocNro','CbteTipo','PtoVta','CbteDesde','CbteHasta','CbteFch','ImpTotal',
    'ImpTotConc','ImpNeto','ImpOpEx','ImpIVA','ImpTrib','MonId','MonCotiz'];
  const result = Object.fromEntries(fields.map(k => [k, v[k] ?? v[k[0].toLowerCase()+k.slice(1)]]));
  // @arcasdk/core usa impIva, no impIVA.
  result.ImpIVA = result.ImpIVA ?? v.impIva;
  result.Observaciones = v.Observaciones ?? v.observaciones;
  result.Iva = v.Iva ?? v.iva;
  result.consulta_identidad = { tipo: contexto.tipo, puntoVenta: contexto.puntoVenta, numero: contexto.numero };
  return result;
}
function validarRecuperacionAutomatica(info, esperado) {
  if (!info || !esperado || !info.CodAutorizacion) throw new Error('Reconciliar: falta evidencia de autorización');
  const ident = { ...info, CbteTipo: info.CbteTipo ?? info.consulta_identidad?.tipo,
    PtoVta: info.PtoVta ?? info.consulta_identidad?.puntoVenta };
  for (const campo of ['CbteTipo','PtoVta','CbteDesde','DocTipo','DocNro','CbteFch']) {
    if (ident[campo] == null || esperado[campo] == null || String(ident[campo]) !== String(esperado[campo])) {
      throw new Error(`Reconciliar: identidad/fecha diferente o incompleta (${campo}); no se asocia CAE`);
    }
  }
  for (const campo of ['ImpTotal','ImpNeto','ImpIVA','ImpTrib','ImpOpEx','ImpTotConc']) {
    if (info[campo] == null || esperado[campo] == null || centavos(info[campo]) !== centavos(esperado[campo])) {
      throw new Error(`Reconciliar: importe diferente o incompleto (${campo}); no se asocia CAE`);
    }
  }
  return true;
}
module.exports = { normalizarConsulta, validarRecuperacionAutomatica };
