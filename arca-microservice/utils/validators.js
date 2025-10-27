import { 
  TIPOS_COMPROBANTE, 
  TIPOS_DOCUMENTO, 
  CONDICIONES_IVA,
  CONCEPTOS,
  validarCombinaciónComprobanteIVA,
  esExento,
  esNotaCredito
} from '../types/billing.types.js';

/**
 * VALIDADORES DE DATOS DE FACTURACIÓN
 */

/**
 * Validar CUIT
 */
export function validarCUIT(cuit) {
  const cuitLimpio = cuit.toString().replace(/-/g, '');
  
  if (!/^\d{11}$/.test(cuitLimpio)) {
    return { valido: false, error: 'CUIT debe tener 11 dígitos' };
  }
  
  // Validar dígito verificador
  const digitos = cuitLimpio.split('').map(Number);
  const multiplicadores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    suma += digitos[i] * multiplicadores[i];
  }
  
  const verificador = 11 - (suma % 11);
  const digitoVerificador = verificador === 11 ? 0 : verificador === 10 ? 9 : verificador;
  
  if (digitoVerificador !== digitos[10]) {
    return { valido: false, error: 'CUIT inválido (dígito verificador incorrecto)' };
  }
  
  return { valido: true };
}

/**
 * Validar DNI
 */
export function validarDNI(dni) {
  const dniLimpio = dni.toString().replace(/\./g, '');
  
  if (!/^\d{7,8}$/.test(dniLimpio)) {
    return { valido: false, error: 'DNI debe tener 7 u 8 dígitos' };
  }
  
  return { valido: true };
}

/**
 * Validar fecha
 */
export function validarFecha(fecha) {
  const fechaStr = fecha.toString();
  
  if (!/^\d{8}$/.test(fechaStr)) {
    return { valido: false, error: 'Fecha debe estar en formato YYYYMMDD' };
  }
  
  const año = parseInt(fechaStr.substring(0, 4));
  const mes = parseInt(fechaStr.substring(4, 6));
  const dia = parseInt(fechaStr.substring(6, 8));
  
  if (mes < 1 || mes > 12) {
    return { valido: false, error: 'Mes inválido' };
  }
  
  if (dia < 1 || dia > 31) {
    return { valido: false, error: 'Día inválido' };
  }
  
  const fechaDate = new Date(año, mes - 1, dia);
  const hoy = new Date();
  const diferenciaDias = Math.abs((fechaDate - hoy) / (1000 * 60 * 60 * 24));
  
  if (diferenciaDias > 10) {
    return { 
      valido: false, 
      error: 'La fecha debe estar dentro de los 10 días anteriores o posteriores a hoy' 
    };
  }
  
  return { valido: true };
}

/**
 * Validar punto de venta
 */
export function validarPuntoVenta(puntoVenta) {
  const pv = parseInt(puntoVenta);
  
  if (isNaN(pv) || pv < 1 || pv > 9999) {
    return { valido: false, error: 'Punto de venta debe ser entre 1 y 9999' };
  }
  
  return { valido: true };
}

/**
 * Validar importes
 */
export function validarImporte(importe, nombre = 'Importe') {
  const imp = parseFloat(importe);
  
  if (isNaN(imp)) {
    return { valido: false, error: `${nombre} debe ser un número` };
  }
  
  if (imp < 0) {
    return { valido: false, error: `${nombre} no puede ser negativo` };
  }
  
  if (!/^\d+(\.\d{1,2})?$/.test(importe.toString())) {
    return { valido: false, error: `${nombre} debe tener máximo 2 decimales` };
  }
  
  return { valido: true };
}

/**
 * Validar estructura completa de un comprobante
 * ✅ ACTUALIZADO: Valida correctamente EXENTOS (sin IVA)
 */
export function validarDatosComprobante(datos) {
  const errores = [];
  
  // 1. Validar campos obligatorios
  if (!datos.CantReg) errores.push('CantReg es obligatorio');
  if (!datos.PtoVta) errores.push('PtoVta es obligatorio');
  if (!datos.CbteTipo) errores.push('CbteTipo es obligatorio');
  if (!datos.Concepto) errores.push('Concepto es obligatorio');
  if (!datos.DocTipo) errores.push('DocTipo es obligatorio');
  if (datos.DocNro === undefined) errores.push('DocNro es obligatorio');
  if (!datos.CbteDesde) errores.push('CbteDesde es obligatorio');
  if (!datos.CbteHasta) errores.push('CbteHasta es obligatorio');
  if (!datos.ImpTotal) errores.push('ImpTotal es obligatorio');
  if (datos.ImpNeto === undefined) errores.push('ImpNeto es obligatorio');
  if (datos.ImpIVA === undefined) errores.push('ImpIVA es obligatorio');
  if (!datos.MonId) errores.push('MonId es obligatorio');
  if (datos.MonCotiz === undefined) errores.push('MonCotiz es obligatorio');
  
  
  // 2. Validar punto de venta
  const validPV = validarPuntoVenta(datos.PtoVta);
  if (!validPV.valido) errores.push(validPV.error);
  
  // 3. Validar fecha si está presente
  if (datos.CbteFch) {
    const validFecha = validarFecha(datos.CbteFch);
    if (!validFecha.valido) errores.push(validFecha.error);
  }
  
  // 4. Validar documento según el tipo
  if (datos.DocTipo === TIPOS_DOCUMENTO.CUIT && datos.DocNro !== 0) {
    const validCUIT = validarCUIT(datos.DocNro);
    if (!validCUIT.valido) errores.push(validCUIT.error);
  } else if (datos.DocTipo === TIPOS_DOCUMENTO.DNI && datos.DocNro !== 0) {
    const validDNI = validarDNI(datos.DocNro);
    if (!validDNI.valido) errores.push(validDNI.error);
  }
  
  // 5. Validar importes
  const validImpTotal = validarImporte(datos.ImpTotal, 'ImpTotal');
  if (!validImpTotal.valido) errores.push(validImpTotal.error);
  
  const validImpNeto = validarImporte(datos.ImpNeto, 'ImpNeto');
  if (!validImpNeto.valido) errores.push(validImpNeto.error);
  
  const validImpIVA = validarImporte(datos.ImpIVA, 'ImpIVA');
  if (!validImpIVA.valido) errores.push(validImpIVA.error);
  const validNC = validarNotaCredito(datos);
if (!validNC.valido) {
  errores.push(...validNC.errores);
}
  
  // 6. Validar coherencia de importes
  const impNetoParsed = parseFloat(datos.ImpNeto);
  const impIVAParsed = parseFloat(datos.ImpIVA);
  const impTotConcParsed = parseFloat(datos.ImpTotConc || 0);
  const impOpExParsed = parseFloat(datos.ImpOpEx || 0);
  const impTribParsed = parseFloat(datos.ImpTrib || 0);
  const impTotalParsed = parseFloat(datos.ImpTotal);
  
  const totalCalculado = impNetoParsed + impIVAParsed + impTotConcParsed + impOpExParsed + impTribParsed;
  
  if (Math.abs(totalCalculado - impTotalParsed) > 0.01) {
    errores.push(
      `ImpTotal (${impTotalParsed}) no coincide con la suma de componentes (${totalCalculado.toFixed(2)})`
    );
  }
  
  // ✅ 7. Validar IVA (TODOS deben tener array Iva)
const esReceptorExento = esExento(datos.CondicionIVAReceptorId);

// SIEMPRE debe tener array Iva si ImpNeto > 0
if (datos.ImpNeto > 0 && (!datos.Iva || datos.Iva.length === 0)) {
  errores.push('Si ImpNeto > 0, debe incluir el array Iva (usar alícuota 3 con Importe 0 para exentos)');
}

if (datos.Iva && datos.Iva.length > 0) {
  let sumaBaseImp = 0;
  let sumaIVA = 0;
  
  datos.Iva.forEach((alicuota, index) => {
    if (!alicuota.Id) errores.push(`Iva[${index}].Id es obligatorio`);
    if (alicuota.BaseImp === undefined) errores.push(`Iva[${index}].BaseImp es obligatorio`);
    if (alicuota.Importe === undefined) errores.push(`Iva[${index}].Importe es obligatorio`);
    
    sumaBaseImp += parseFloat(alicuota.BaseImp || 0);
    sumaIVA += parseFloat(alicuota.Importe || 0);
  });
  
  if (Math.abs(sumaBaseImp - impNetoParsed) > 0.01) {
    errores.push(
      `La suma de BaseImp en Iva (${sumaBaseImp.toFixed(2)}) debe coincidir con ImpNeto (${impNetoParsed})`
    );
  }
  
  if (Math.abs(sumaIVA - impIVAParsed) > 0.01) {
    errores.push(
      `La suma de Importe en Iva (${sumaIVA.toFixed(2)}) debe coincidir con ImpIVA (${impIVAParsed})`
    );
  }
  
  // ✅ Para exentos, validar que use alícuota 3 con Importe 0
  if (esReceptorExento) {
    const tieneAlicuotaExento = datos.Iva.some(alicuota => alicuota.Id === 3);
    if (!tieneAlicuotaExento) {
      errores.push('Para receptores EXENTOS debe usar alícuota ID 3 (0%)');
    }
    if (impIVAParsed !== 0) {
      errores.push('Para receptores EXENTOS, ImpIVA debe ser 0');
    }
  }
}
  
  // 8. Validar combinación de tipo de comprobante y condición IVA
  if (datos.CondicionIVAReceptorId) {
    const validCombo = validarCombinaciónComprobanteIVA(
      datos.CbteTipo,
      datos.CondicionIVAReceptorId
    );
    
    if (!validCombo) {
      errores.push('La combinación de tipo de comprobante y condición IVA no es válida');
    }
  }
  
  // 9. Validar fechas de servicio si el concepto lo requiere
  if ([CONCEPTOS.SERVICIOS, CONCEPTOS.PRODUCTOS_Y_SERVICIOS].includes(datos.Concepto)) {
    if (!datos.FchServDesde || !datos.FchServHasta) {
      errores.push('Para servicios debe incluir FchServDesde y FchServHasta');
    }
  }
  
  return {
    valido: errores.length === 0,
    errores
  };
}

/**
 * Validar datos de entrada de la API
 */
export function validarDatosEntrada(datos) {
  const errores = [];
  
  if (!datos.tipoComprobante) errores.push('tipoComprobante es obligatorio');
  if (!datos.cliente) errores.push('cliente es obligatorio');
  if (!datos.items || datos.items.length === 0) errores.push('Debe incluir al menos un item');
  
  if (datos.cliente) {
    if (!datos.cliente.tipoDocumento) errores.push('cliente.tipoDocumento es obligatorio');
    if (datos.cliente.numeroDocumento === undefined) errores.push('cliente.numeroDocumento es obligatorio');
    if (!datos.cliente.condicionIVA) errores.push('cliente.condicionIVA es obligatorio');
  }
  
  if (datos.items) {
    datos.items.forEach((item, index) => {
      if (!item.descripcion) errores.push(`items[${index}].descripcion es obligatorio`);
      if (!item.cantidad) errores.push(`items[${index}].cantidad es obligatorio`);
      if (!item.precioUnitario) errores.push(`items[${index}].precioUnitario es obligatorio`);
      if (item.alicuotaIVA === undefined) errores.push(`items[${index}].alicuotaIVA es obligatorio`);
    });
  }
  
  return {
    valido: errores.length === 0,
    errores
  };
}

export function validarNotaCredito(datos) {
  const errores = [];
  
  // Si es Nota de Crédito, debe tener comprobante asociado
  if (esNotaCredito(datos.CbteTipo)) {
    if (!datos.CbtesAsoc || datos.CbtesAsoc.length === 0) {
      errores.push('Las Notas de Crédito deben tener al menos un comprobante asociado');
    }
    
    if (datos.CbtesAsoc && datos.CbtesAsoc.length > 0) {
      datos.CbtesAsoc.forEach((asoc, index) => {
        if (!asoc.Tipo) errores.push(`CbtesAsoc[${index}].Tipo es obligatorio`);
        if (!asoc.PtoVta) errores.push(`CbtesAsoc[${index}].PtoVta es obligatorio`);
        if (!asoc.Nro) errores.push(`CbtesAsoc[${index}].Nro es obligatorio`);
      });
    }
  }
  
  return {
    valido: errores.length === 0,
    errores
  };
}

export default {
  validarCUIT,
  validarDNI,
  validarFecha,
  validarPuntoVenta,
  validarImporte,
  validarDatosComprobante,
  validarDatosEntrada,
  validarNotaCredito
};