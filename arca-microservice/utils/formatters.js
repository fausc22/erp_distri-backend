import documento from '../../dominio/calculo/documento.js';
import { PORCENTAJES_IVA, ALICUOTAS_IVA, esNotaCredito, esNotaDebito } from '../types/billing.types.js';

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
 * Agrupar items por alícuota de IVA.
 * La condición del receptor no cambia la tasa: un sujeto exento sigue
 * gravado al 21 % (id 5), 10,5 % (id 4) o 0 % (id 3) según el producto.
 */
export function agruparIVAPorAlicuota(items, _condicionIVAReceptor) {
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
 * Calcular totales de un array de items.
 * El IVA sale de la alícuota de cada ítem, también si el receptor es exento.
 */
export function calcularTotales(items, _condicionIVAReceptor) {
  let totalNeto = 0;
  let totalIVA = 0;
  
  items.forEach(item => {
    const precioNeto = item.cantidad * item.precioUnitario;
    totalNeto += precioNeto;
    totalIVA += calcularIVA(precioNeto, item.alicuotaIVA);
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
  // Operaciones v1: trasladar el cálculo persistido, sin reconstruir ni corregir precios.
  if (datosUsuario.reglaCalculo === 'v1') {
    const { centavos } = documento;
    const tasas = { 3: 0n, 4: 1050n, 5: 2100n, 6: 2700n };
    const alicuotas = datosUsuario.ivaCalculado;
    if (!Array.isArray(alicuotas) || !alicuotas.length) throw new Error('Falta desglose IVA del cálculo');
    let neto = 0n, iva = 0n;
    const ids = new Set();
    for (const a of alicuotas) {
      const base = centavos(a.BaseImp), impuesto = centavos(a.Importe);
      if (!(a.Id in tasas) || ids.has(a.Id) || base < 0n || impuesto < 0n) throw new Error('Alícuota inválida');
      ids.add(a.Id);
      if ((base * tasas[a.Id] + 5000n) / 10000n !== impuesto) throw new Error('IVA diferente del cálculo por alícuota');
      neto += base; iva += impuesto;
    }
    if (neto !== centavos(datosUsuario.impNeto) || iva !== centavos(datosUsuario.impIVA) || neto + iva !== centavos(datosUsuario.impTotal)) {
      throw new Error('Importes v1 inconsistentes: envío bloqueado');
    }
    for (const field of ['impOpEx', 'impTotConc', 'impTrib']) {
      if (centavos(datosUsuario[field] ?? 0) !== 0n) throw new Error('Componente no soportado en cálculo v1');
    }
    const data = {
      CantReg: 1, PtoVta: puntoVenta, CbteTipo: datosUsuario.tipoComprobante,
      Concepto: datosUsuario.concepto || 1, DocTipo: datosUsuario.cliente.tipoDocumento,
      DocNro: Number(formatearDocumento(datosUsuario.cliente.numeroDocumento)) || 0,
      CbteDesde: numeroComprobante, CbteHasta: numeroComprobante,
      CbteFch: Number(datosUsuario.fecha),
      ImpNeto: Number(datosUsuario.impNeto), ImpIVA: Number(datosUsuario.impIVA), ImpTotal: Number(datosUsuario.impTotal),
      ImpOpEx: 0, ImpTotConc: 0, ImpTrib: 0, MonId: 'PES', MonCotiz: 1,
      CondicionIVAReceptorId: datosUsuario.cliente.condicionIVA,
      Iva: alicuotas.map(a => ({ Id: a.Id, BaseImp: Number(a.BaseImp), Importe: Number(a.Importe) }))
    };
    if (esNotaCredito(data.CbteTipo) || esNotaDebito(data.CbteTipo)) {
      data.CbtesAsoc = formatearComprobantesAsociados(datosUsuario.comprobantesAsociados);
      if (!data.CbtesAsoc.length) throw new Error('Nota sin comprobante asociado');
    }
    return data;
  }
  const condicionIVAReceptor = datosUsuario.cliente.condicionIVA;
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

  // Si la cabecera redondeada no coincide con el detalle por alícuota, usar detalle.
  if (ivaAgrupado.length > 0) {
    const sumaBaseAlic = redondear(ivaAgrupado.reduce((acc, al) => acc + (parseFloat(al.BaseImp) || 0), 0));
    const sumaIvaAlic = redondear(ivaAgrupado.reduce((acc, al) => acc + (parseFloat(al.Importe) || 0), 0));
    if (Math.abs(sumaBaseAlic - impNeto) > 0.01 || Math.abs(sumaIvaAlic - impIVA) > 0.01) {
      // No debería ocurrir si los ítems viajan con el neto ya descontado.
      console.warn(
        `[ARCA formatter] Divergencia ítems vs cabecera: ` +
        `neto items=${sumaBaseAlic} vs cabecera=${impNeto}, ` +
        `iva items=${sumaIvaAlic} vs cabecera=${impIVA}. ` +
        `Se usa suma de ítems — verificar que precios unitarios incluyan descuentos.`
      );
      impNeto = sumaBaseAlic;
      impIVA = sumaIvaAlic;
    }
  }

  if (impTotalInput !== null) {
    const sumaActual = redondear(impNeto + impIVA + impTotConc + impOpEx + impTrib);
    const diferencia = redondear(impTotalInput - sumaActual);
    if (Math.abs(diferencia) > 0.01) {
      console.warn(
        `[ARCA formatter] ImpTotal explícito ${impTotalInput} no cierra con la suma ${sumaActual}. Se usa la suma.`
      );
    }
  }

  const sumaComponentes = redondear(impNeto + impIVA + impTotConc + impOpEx + impTrib);
  const impTotal = sumaComponentes;

  let ivaFinal = ivaAgrupado;

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