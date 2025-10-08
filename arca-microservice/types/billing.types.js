/**
 * TIPOS Y CONSTANTES PARA FACTURACIÓN ELECTRÓNICA
 * 
 * Este archivo contiene todas las constantes necesarias para
 * interactuar con los web services de ARCA/AFIP
 */

// TIPOS DE COMPROBANTES
// Estos son los códigos que ARCA usa para identificar cada tipo de comprobante
export const TIPOS_COMPROBANTE = {
  FACTURA_A: 1,           // Factura A - Para responsables inscriptos y monotributistas
  NOTA_DEBITO_A: 2,       // Nota de débito A
  NOTA_CREDITO_A: 3,      // Nota de crédito A
  FACTURA_B: 6,           // Factura B - Para consumidores finales y exentos
  NOTA_DEBITO_B: 7,       // Nota de débito B
  NOTA_CREDITO_B: 8,      // Nota de crédito B
  FACTURA_C: 11,          // Factura C - Para operaciones exentas
  NOTA_DEBITO_C: 12,      // Nota de débito C
  NOTA_CREDITO_C: 13,     // Nota de crédito C
  FACTURA_E: 19,          // Factura E - Exportación
  NOTA_DEBITO_E: 20,      // Nota de débito E
  NOTA_CREDITO_E: 21,     // Nota de crédito E
};

// CONCEPTOS DEL COMPROBANTE
// Define si estás vendiendo productos, servicios o ambos
export const CONCEPTOS = {
  PRODUCTOS: 1,             // Solo productos
  SERVICIOS: 2,             // Solo servicios
  PRODUCTOS_Y_SERVICIOS: 3  // Combinación de ambos
};

// TIPOS DE DOCUMENTOS
// Identificación del cliente/comprador
export const TIPOS_DOCUMENTO = {
  CUIT: 80,                 // CUIT (empresas y responsables inscriptos)
  CUIL: 86,                 // CUIL (personas)
  CDI: 87,                  // CDI (Clave de Identificación)
  DNI: 96,                  // DNI
  CONSUMIDOR_FINAL: 99,     // Sin documento (consumidor final)
  PASAPORTE: 94,            // Pasaporte
  CI_EXTRANJERA: 93,        // Cédula de identidad extranjera
};

// CONDICIONES FRENTE AL IVA
// Situación impositiva del receptor/cliente
export const CONDICIONES_IVA = {
  RESPONSABLE_INSCRIPTO: 1,        // Empresa inscripta en IVA
  RESPONSABLE_NO_INSCRIPTO: 2,     // Empresa no inscripta (raro)
  RESPONSABLE_MONOTRIBUTO: 6,      // Monotributista
  EXENTO: 4,                        // Exento de IVA
  CONSUMIDOR_FINAL: 5,              // Consumidor final
  NO_CATEGORIZADO: 7,               // Sin categorizar
  PROVEEDOR_EXTERIOR: 8,            // Del exterior
};

// ALÍCUOTAS DE IVA
// Porcentajes de IVA aplicables
export const ALICUOTAS_IVA = {
  IVA_0: 3,    // 0% (exento)
  IVA_10_5: 4, // 10.5%
  IVA_21: 5,   // 21% (el más común)
  IVA_27: 6,   // 27%
  IVA_5: 8,    // 5%
  IVA_2_5: 9,  // 2.5%
};

// Mapeo de alícuotas a porcentajes reales
export const PORCENTAJES_IVA = {
  3: 0,      // 0%
  4: 10.5,   // 10.5%
  5: 21,     // 21%
  6: 27,     // 27%
  8: 5,      // 5%
  9: 2.5,    // 2.5%
};

// TIPOS DE MONEDA
export const MONEDAS = {
  PESOS: 'PES',           // Pesos argentinos
  DOLARES: 'DOL',         // Dólares estadounidenses
  EUROS: '060',           // Euros
  REALES: '012',          // Reales brasileños
};

// TRIBUTOS/IMPUESTOS ADICIONALES
// Otros impuestos que pueden aplicarse además del IVA
export const TIPOS_TRIBUTO = {
  IMPUESTOS_NACIONALES: 1,
  IMPUESTOS_PROVINCIALES: 2,
  IMPUESTOS_MUNICIPALES: 3,
  IMPUESTOS_INTERNOS: 4,
  PERCEPCIONES_IIBB: 5,    // Ingresos Brutos
  PERCEPCIONES_IVA: 6,
  PERCEPCIONES_OTROS: 7,
  IIBB: 99,                // Ingresos Brutos genérico
};

// OPCIONALES - Códigos para información adicional
export const TIPOS_OPCIONALES = {
  CODIGO_MONEDA_EXTRANJERA: 2,
  OTROS_TRIBUTOS: 4,
};

/**
 * HELPER: Obtener nombre del tipo de comprobante
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
    19: 'Factura E',
    20: 'Nota de Débito E',
    21: 'Nota de Crédito E',
  };
  return nombres[codigo] || 'Comprobante Desconocido';
}

/**
 * HELPER: Validar combinación de tipo de comprobante y condición IVA
 * Algunas combinaciones no son válidas según las normas de ARCA
 */
export function validarCombinaciónComprobanteIVA(tipoComprobante, condicionIVA) {
  // Factura A solo para Responsables Inscriptos
  if ([1, 2, 3].includes(tipoComprobante) && condicionIVA !== CONDICIONES_IVA.RESPONSABLE_INSCRIPTO) {
    return false;
  }
  
  // Factura B para Consumidor Final, Monotributo, Exento
  if ([6, 7, 8].includes(tipoComprobante) && condicionIVA === CONDICIONES_IVA.RESPONSABLE_INSCRIPTO) {
    return false;
  }
  
  return true;
}

export default {
  TIPOS_COMPROBANTE,
  CONCEPTOS,
  TIPOS_DOCUMENTO,
  CONDICIONES_IVA,
  ALICUOTAS_IVA,
  PORCENTAJES_IVA,
  MONEDAS,
  TIPOS_TRIBUTO,
  TIPOS_OPCIONALES,
  getNombreComprobante,
  validarCombinaciónComprobanteIVA
};