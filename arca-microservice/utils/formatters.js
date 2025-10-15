import { PORCENTAJES_IVA, ALICUOTAS_IVA, esExento } from '../types/billing.types.js';

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
  // Si el receptor está exento, no se agrega IVA
  if (esExento(condicionIVAReceptor)) {
    return [];
  }

  const agrupado = {};
  
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
  
  // 1. Calcular totales considerando si es exento
  const totales = calcularTotales(datosUsuario.items, condicionIVAReceptor);
  
  // 2. Agrupar IVA por alícuota (vacío si es exento)
  const ivaAgrupado = agruparIVAPorAlicuota(datosUsuario.items, condicionIVAReceptor);
  
  // 3. Formatear documento del cliente
  const documentoFormateado = formatearDocumento(datosUsuario.cliente.numeroDocumento);
  
  // 4. Obtener o generar fecha
  const fecha = datosUsuario.fecha 
    ? (typeof datosUsuario.fecha === 'number' ? datosUsuario.fecha : dateAFormatoARCA(datosUsuario.fecha))
    : obtenerFechaActual();
  
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
    ImpTotal: totales.total,
    ImpTotConc: datosUsuario.impTotConc || 0,
    ImpNeto: totales.totalNeto,
    ImpOpEx: datosUsuario.impOpEx || 0,
    ImpIVA: totales.totalIVA,
    ImpTrib: datosUsuario.impTrib || 0,
    MonId: datosUsuario.moneda || 'PES',
    MonCotiz: datosUsuario.cotizacionMoneda || 1,
    CondicionIVAReceptorId: condicionIVAReceptor
  };

  // ✅ Solo agregar array Iva si no está exento
  if (!esExento(condicionIVAReceptor) && ivaAgrupado.length > 0) {
    datosARCA.Iva = ivaAgrupado;
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
  formatearRespuestaARCA
};