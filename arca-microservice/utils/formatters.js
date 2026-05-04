import { PORCENTAJES_IVA, ALICUOTAS_IVA, esExento, esNotaCredito, esNotaDebito } from '../types/billing.types.js';

/**
 * FORMATEADORES DE DATOS PARA ARCA/AFIP
 */

/**
 * Obtener fecha actual en formato YYYYMMDD
 */
export function obtenerFechaActual() {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  
  return parseInt(`${año}${mes}${dia}`);
}

/**
 * Convertir fecha de YYYYMMDD a YYYY-MM-DD
 */
export function formatearFecha(fechaYYYYMMDD) {
  const str = fechaYYYYMMDD.toString();
  return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
}

/**
 * Convertir fecha de Date a YYYYMMDD
 */
export function dateAFormatoARCA(fecha) {
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  
  return parseInt(`${año}${mes}${dia}`);
}

/**
 * Redondear a 2 decimales
 */
export function redondear(numero) {
  return Math.round(numero * 100) / 100;
}

/**
 * Calcular IVA desde un precio neto
 */
export function calcularIVA(precioNeto, alicuotaId) {
  const porcentaje = PORCENTAJES_IVA[alicuotaId] || 0;
  return redondear(precioNeto * (porcentaje / 100));
}

/**
 * Calcular precio total (neto + IVA)
 */
export function calcularPrecioTotal(precioNeto, alicuotaId) {
  const iva = calcularIVA(precioNeto, alicuotaId);
  return redondear(precioNeto + iva);
}

/**
 * Agrupar items por alícuota de IVA
 * ✅ ACTUALIZADO: Maneja casos de EXENTO (sin IVA)
 */
export function agruparIVAPorAlicuota(items, condicionIVAReceptor) {
  const agrupado = {};
  
  // ✅ CAMBIO CRÍTICO: Si es exento, usar alícuota 3 (0%) en lugar de array vacío
  if (esExento(condicionIVAReceptor)) {
    const baseTotal = items.reduce((acc, item) => {
      return acc + (item.cantidad * item.precioUnitario);
    }, 0);
    
    return [{
      Id: 3,              // Alícuota 3 = 0% (Exento)
      BaseImp: redondear(baseTotal),
      Importe: 0          // IVA = 0 para exentos
    }];
  }

  // Para NO exentos, agrupar normalmente
  items.forEach(item => {
    const alicuotaId = item.alicuotaIVA;
    const precioNeto = item.cantidad * item.precioUnitario;
    const iva = calcularIVA(precioNeto, alicuotaId);
    
    if (!agrupado[alicuotaId]) {
      agrupado[alicuotaId] = {
        Id: alicuotaId,
        BaseImp: 0,
        Importe: 0
      };
    }
    
    agrupado[alicuotaId].BaseImp += precioNeto;
    agrupado[alicuotaId].Importe += iva;
  });
  
  return Object.values(agrupado).map(alicuota => ({
    Id: alicuota.Id,
    BaseImp: redondear(alicuota.BaseImp),
    Importe: redondear(alicuota.Importe)
  }));
}

/**
 * Calcular totales de un array de items
 * ✅ ACTUALIZADO: Maneja casos de EXENTO
 */
export function calcularTotales(items, condicionIVAReceptor) {
  let totalNeto = 0;
  let totalIVA = 0;
  
  items.forEach(item => {
    const precioNeto = item.cantidad * item.precioUnitario;
    totalNeto += precioNeto;
    
    // ✅ Si está EXENTO, no calcular IVA
    if (!esExento(condicionIVAReceptor)) {
      const iva = calcularIVA(precioNeto, item.alicuotaIVA);
      totalIVA += iva;
    }
  });
  
  return {
    totalNeto: redondear(totalNeto),
    totalIVA: redondear(totalIVA),
    total: redondear(totalNeto + totalIVA)
  };
}

/**
 * Formatear número de documento eliminando puntos y guiones
 */
export function formatearDocumento(documento) {
  return documento.toString().replace(/[.-]/g, '');
}

/**
 * Transformar datos de entrada del usuario al formato ARCA
 * ✅ ACTUALIZADO: Maneja todos los casos (RI, Monotributo, Consumidor Final, Exento)
 */
export function transformarAFormatoARCA(datosUsuario, numeroComprobante, puntoVenta) {
  const condicionIVAReceptor = datosUsuario.cliente.condicionIVA;
  const receptorEsExento = esExento(condicionIVAReceptor);
  const toNumber = (value, fallback = 0) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  };
  
  // 1. Calcular totales considerando si es exento
  const totales = calcularTotales(datosUsuario.items, condicionIVAReceptor);
  
  // 2. Agrupar IVA por alícuota (base inicial desde items)
  const ivaAgrupado = agruparIVAPorAlicuota(datosUsuario.items, condicionIVAReceptor);
  
  // 3. Formatear documento del cliente
  const documentoFormateado = formatearDocumento(datosUsuario.cliente.numeroDocumento);
  
  // 4. Obtener o generar fecha
  const fecha = datosUsuario.fecha 
    ? (typeof datosUsuario.fecha === 'number' ? datosUsuario.fecha : dateAFormatoARCA(datosUsuario.fecha))
    : obtenerFechaActual();

  // 4.1 Resolver importes finales (prioriza importes explícitos enviados desde ventas)
  const impTotConc = toNumber(datosUsuario.impTotConc, 0);
  const impTrib = toNumber(datosUsuario.impTrib, 0);
  let impNeto = redondear(toNumber(datosUsuario.impNeto, totales.totalNeto));
  let impIVA = redondear(toNumber(datosUsuario.impIVA, totales.totalIVA));
  let impOpEx = redondear(toNumber(datosUsuario.impOpEx, 0));
  const impTotalInput = Number.isFinite(parseFloat(datosUsuario.impTotal))
    ? redondear(parseFloat(datosUsuario.impTotal))
    : null;

  // Reglas actuales de esta integración: receptor exento viaja con ImpIVA=0 y diferencial en ImpOpEx
  if (receptorEsExento) {
    impIVA = 0;
  }

  // Para no exentos, priorizar consistencia fiscal entre cabecera e Iva.
  // Si la cabecera redondeada no coincide con el detalle por alícuota, usar detalle.
  if (!receptorEsExento && ivaAgrupado.length > 0) {
    const sumaBaseAlic = redondear(ivaAgrupado.reduce((acc, al) => acc + (parseFloat(al.BaseImp) || 0), 0));
    const sumaIvaAlic = redondear(ivaAgrupado.reduce((acc, al) => acc + (parseFloat(al.Importe) || 0), 0));
    if (Math.abs(sumaBaseAlic - impNeto) > 0.01 || Math.abs(sumaIvaAlic - impIVA) > 0.01) {
      impNeto = sumaBaseAlic;
      impIVA = sumaIvaAlic;
    }
  }

  // Si llega ImpTotal explícito y no cierra la suma:
  // - Exentos: ajustar ImpOpEx (regla actual de integración)
  // - No exentos: usar total consistente con cabecera fiscal calculada
  if (impTotalInput !== null) {
    const sumaActual = redondear(impNeto + impIVA + impTotConc + impOpEx + impTrib);
    const diferencia = redondear(impTotalInput - sumaActual);
    if (receptorEsExento && Math.abs(diferencia) > 0.01) {
      impOpEx = redondear(Math.max(0, impOpEx + diferencia));
    }
  }

  const sumaComponentes = redondear(impNeto + impIVA + impTotConc + impOpEx + impTrib);
  const impTotal = (impTotalInput !== null && receptorEsExento)
    ? impTotalInput
    : sumaComponentes;
  
  // 4.2 Construir bloque Iva alineado a la cabecera fiscal.
  // Si existe diferencia entre detalle y cabecera, ARCA debe seguir cabecera.
  let ivaFinal = ivaAgrupado;
  if (receptorEsExento) {
    ivaFinal = [{
      Id: 3,
      BaseImp: impNeto,
      Importe: 0
    }];
  } else if (ivaAgrupado.length > 0) {
    // Para no exentos, conservar el detalle por alícuotas proveniente de items.
    ivaFinal = ivaAgrupado;
  }

  // 5. Construir objeto en formato ARCA
  const datosARCA = {
    CantReg: 1,
    PtoVta: puntoVenta,
    CbteTipo: datosUsuario.tipoComprobante,
    Concepto: datosUsuario.concepto || 1,
    DocTipo: datosUsuario.cliente.tipoDocumento,
    DocNro: parseInt(documentoFormateado) || 0,
    CbteDesde: numeroComprobante,
    CbteHasta: numeroComprobante,
    CbteFch: fecha,
    ImpTotal: impTotal,
    ImpTotConc: impTotConc,
    ImpNeto: impNeto,
    ImpOpEx: impOpEx,
    ImpIVA: impIVA,
    ImpTrib: impTrib,
    MonId: datosUsuario.moneda || 'PES',
    MonCotiz: datosUsuario.cotizacionMoneda || 1,
    CondicionIVAReceptorId: condicionIVAReceptor
  };

  if (ivaFinal.length > 0) {
    datosARCA.Iva = ivaFinal;
  }
  
  // 6. Agregar fechas de servicio si corresponde
  if (datosUsuario.fechaServicioDesde && datosUsuario.fechaServicioHasta) {
    datosARCA.FchServDesde = typeof datosUsuario.fechaServicioDesde === 'number' 
      ? datosUsuario.fechaServicioDesde 
      : dateAFormatoARCA(datosUsuario.fechaServicioDesde);
      
    datosARCA.FchServHasta = typeof datosUsuario.fechaServicioHasta === 'number'
      ? datosUsuario.fechaServicioHasta
      : dateAFormatoARCA(datosUsuario.fechaServicioHasta);
      
    datosARCA.FchVtoPago = datosARCA.FchServHasta;
  }

  if (esNotaCredito(datosUsuario.tipoComprobante) || esNotaDebito(datosUsuario.tipoComprobante)) {
  if (!datosUsuario.comprobantesAsociados || datosUsuario.comprobantesAsociados.length === 0) {
    const tipoNota = esNotaCredito(datosUsuario.tipoComprobante) ? 'Crédito' : 'Débito';
    throw new Error(`Las Notas de ${tipoNota} deben tener al menos un comprobante asociado`);
  }
  
  datosARCA.CbtesAsoc = formatearComprobantesAsociados(datosUsuario.comprobantesAsociados);
  const tipoNota = esNotaCredito(datosUsuario.tipoComprobante) ? 'Crédito' : 'Débito';
  console.log(`✅ ${datosARCA.CbtesAsoc.length} comprobante(s) asociado(s) a la Nota de ${tipoNota}`);
}
  
  // 7. Agregar tributos si existen
  if (datosUsuario.tributos && datosUsuario.tributos.length > 0) {
    datosARCA.Tributos = datosUsuario.tributos;
  }
  
  // 8. Agregar opcionales si existen
  if (datosUsuario.opcionales) {
    datosARCA.Opcionales = datosUsuario.opcionales;
  }
  
  return datosARCA;
}

export function formatearComprobantesAsociados(comprobantesAsociados) {
  if (!comprobantesAsociados || comprobantesAsociados.length === 0) {
    return [];
  }
  
  return comprobantesAsociados.map(comp => ({
    Tipo: parseInt(comp.tipo),
    PtoVta: parseInt(comp.puntoVenta),
    Nro: parseInt(comp.numero),
    // ✅ Campos opcionales según SDK
    Cuit: comp.cuit ? parseInt(comp.cuit) : undefined,
    CbteFch: comp.fecha ? parseInt(comp.fecha) : undefined
  }));
}

/**
 * Formatear respuesta de ARCA para el usuario
 */
export function formatearRespuestaARCA(respuestaARCA, datosOriginal) {
  return {
    exito: true,
    comprobante: {
      numero: respuestaARCA.voucher_number || datosOriginal.CbteDesde,
      puntoVenta: datosOriginal.PtoVta,
      tipo: datosOriginal.CbteTipo,
      fecha: formatearFecha(datosOriginal.CbteFch),
      total: datosOriginal.ImpTotal
    },
    autorizacion: {
      cae: respuestaARCA.CAE,
      fechaVencimiento: respuestaARCA.CAEFchVto,
      resultado: respuestaARCA.Resultado || 'A'
    },
    cliente: {
      tipoDocumento: datosOriginal.DocTipo,
      numeroDocumento: datosOriginal.DocNro,
      condicionIVA: datosOriginal.CondicionIVAReceptorId
    },
    importes: {
      neto: datosOriginal.ImpNeto,
      iva: datosOriginal.ImpIVA,
      total: datosOriginal.ImpTotal
    }
  };
}

export default {
  obtenerFechaActual,
  formatearFecha,
  dateAFormatoARCA,
  redondear,
  calcularIVA,
  calcularPrecioTotal,
  agruparIVAPorAlicuota,
  calcularTotales,
  formatearDocumento,
  transformarAFormatoARCA,
  formatearRespuestaARCA,
  formatearComprobantesAsociados 
};