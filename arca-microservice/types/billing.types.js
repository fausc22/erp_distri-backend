/**
 * TIPOS Y CONSTANTES PARA FACTURACIÓN ELECTRÓNICA AFIP/ARCA
 */

// ============================================
// TIPOS DE COMPROBANTES AFIP
// ============================================
export const TIPOS_COMPROBANTE = {
  FACTURA_A: 1,           // Para Responsables Inscriptos y Monotributistas
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,           // Para Consumidores Finales y Exentos
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,          // Para operaciones exentas
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
};

// ============================================
// CONCEPTOS DEL COMPROBANTE
// ============================================
export const CONCEPTOS = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3
};

// ============================================
// TIPOS DE DOCUMENTOS
// ============================================
export const TIPOS_DOCUMENTO = {
  CUIT: 80,
  CUIL: 86,
  CDI: 87,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
  PASAPORTE: 94,
  CI_EXTRANJERA: 93,
};

// ============================================
// CONDICIONES FRENTE AL IVA
// ============================================
export const CONDICIONES_IVA = {
  RESPONSABLE_INSCRIPTO: 1,
  RESPONSABLE_NO_INSCRIPTO: 2,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7,
  PROVEEDOR_EXTERIOR: 8,
};

// ============================================
// ALÍCUOTAS DE IVA
// ============================================
export const ALICUOTAS_IVA = {
  IVA_0: 3,    // 0% (exento)
  IVA_2_5: 9,  // 2.5%
  IVA_5: 8,    // 5%
  IVA_10_5: 4, // 10.5%
  IVA_21: 5,   // 21% (el más común)
  IVA_27: 6,   // 27%
};

// Mapeo de alícuotas a porcentajes reales
export const PORCENTAJES_IVA = {
  3: 0,      // 0%
  9: 2.5,    // 2.5%
  8: 5,      // 5%
  4: 10.5,   // 10.5%
  5: 21,     // 21%
  6: 27,     // 27%
};

// ============================================
// TIPOS DE MONEDA
// ============================================
export const MONEDAS = {
  PESOS: 'PES',
  DOLARES: 'DOL',
  EUROS: '060',
  REALES: '012',
};

// ============================================
// MAPEOS ÚTILES
// ============================================

/**
 * Determinar tipo de comprobante según condición IVA del receptor
 */
export const determinarTipoComprobante = (condicionIVAReceptor) => {
  switch (condicionIVAReceptor) {
    case CONDICIONES_IVA.RESPONSABLE_INSCRIPTO:
    case CONDICIONES_IVA.MONOTRIBUTO:
      return TIPOS_COMPROBANTE.FACTURA_A;
    
    case CONDICIONES_IVA.CONSUMIDOR_FINAL:
    case CONDICIONES_IVA.EXENTO:
      return TIPOS_COMPROBANTE.FACTURA_B;
    
    default:
      return TIPOS_COMPROBANTE.FACTURA_B;
  }
};

/**
 * Obtener nombre del tipo de comprobante
 */
export function getNombreComprobante(codigo) {
  const nombres = {
    1: 'Factura A',
    2: 'Nota de Débito A',
    3: 'Nota de Crédito A',
    6: 'Factura B',
    7: 'Nota de Débito B',
    8: 'Nota de Crédito B',
    11: 'Factura C',
    12: 'Nota de Débito C',
    13: 'Nota de Crédito C',
  };
  return nombres[codigo] || 'Comprobante Desconocido';
}

/**
 * Validar combinación de tipo de comprobante y condición IVA
 */
export function validarCombinaciónComprobanteIVA(tipoComprobante, condicionIVA) {
  // Factura A solo para Responsables Inscriptos y Monotributistas
  if ([1, 2, 3].includes(tipoComprobante)) {
    return [CONDICIONES_IVA.RESPONSABLE_INSCRIPTO, CONDICIONES_IVA.MONOTRIBUTO].includes(condicionIVA);
  }
  
  // Factura B para Consumidor Final y Exento
  if ([6, 7, 8].includes(tipoComprobante)) {
    return [CONDICIONES_IVA.CONSUMIDOR_FINAL, CONDICIONES_IVA.EXENTO].includes(condicionIVA);
  }
  
  return true;
}

/**
 * Determinar si el receptor está exento de IVA
 */
export function esExento(condicionIVA) {
  return condicionIVA === CONDICIONES_IVA.EXENTO;
}

/**
 * Determinar tipo de documento según CUIT/DNI
 */
export function determinarTipoDocumento(documento) {
  if (!documento || documento === '0' || documento === '') {
    return TIPOS_DOCUMENTO.CONSUMIDOR_FINAL;
  }
  
  const docLimpio = documento.toString().replace(/[.-]/g, '');
  
  if (docLimpio.length === 11) {
    return TIPOS_DOCUMENTO.CUIT;
  }
  
  if (docLimpio.length >= 7 && docLimpio.length <= 8) {
    return TIPOS_DOCUMENTO.DNI;
  }
  
  return TIPOS_DOCUMENTO.CONSUMIDOR_FINAL;
}

export default {
  TIPOS_COMPROBANTE,
  CONCEPTOS,
  TIPOS_DOCUMENTO,
  CONDICIONES_IVA,
  ALICUOTAS_IVA,
  PORCENTAJES_IVA,
  MONEDAS,
  determinarTipoComprobante,
  getNombreComprobante,
  validarCombinaciónComprobanteIVA,
  esExento,
  determinarTipoDocumento
};