/**
 * @deprecated La consulta a AFIP (padrón/constancia) se realiza desde arca-microservice
 * (services/afip.service.js + controllers/billing.controller.js consultaContribuyente).
 * Este archivo se mantiene solo por referencia; no se usa en personasController.
 *
 * Servicio de consulta a AFIP/ARCA para padrón de contribuyentes.
 * Usa la API REST de Afip SDK (app.afipsdk.com).
 */

const axios = require('axios');

const AFIP_SDK_BASE = 'https://app.afipsdk.com/api/v1/afip';

/**
 * Obtiene el entorno (dev/prod) según variables de entorno.
 */
function getEnvironment() {
  const afipProd = process.env.AFIP_PRODUCTION === 'true' || process.env.AFIP_PRODUCTION === true;
  const nodeProd = process.env.NODE_ENV === 'prod' || process.env.NODE_ENV === 'production';
  return (afipProd || nodeProd) ? 'prod' : 'dev';
}

/**
 * Obtiene token y sign para un web service de AFIP.
 * @param {string} wsid - ID del web service (ej: ws_sr_padron_a13, ws_sr_constancia_inscripcion)
 * @returns {Promise<{ token: string, sign: string }>}
 */
async function getAuth(wsid) {
  const accessToken = process.env.AFIP_ACCESS_TOKEN;
  const cuit = (process.env.AFIP_CUIT || '').replace(/\D/g, '');

  if (!accessToken) {
    throw new Error('AFIP_ACCESS_TOKEN no configurado en .env');
  }
  if (!cuit || cuit.length !== 11) {
    throw new Error('AFIP_CUIT debe ser un CUIT de 11 dígitos');
  }

  const env = getEnvironment();
  const { data } = await axios.post(
    `${AFIP_SDK_BASE}/auth`,
    {
      environment: env,
      tax_id: cuit,
      wsid
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 15000
    }
  );

  if (!data || !data.token || !data.sign) {
    throw new Error('Respuesta de auth AFIP inválida');
  }
  return { token: data.token, sign: data.sign };
}

/**
 * Obtiene el CUIT asociado a un DNI usando Padrón Alcance 13.
 * @param {string|number} dni - DNI (7 u 8 dígitos)
 * @returns {Promise<string|null>} CUIT de 11 dígitos o null si no existe en el padrón
 */
async function getCuitPorDni(dni) {
  const dniStr = String(dni).replace(/\D/g, '');
  const dniNum = parseInt(dniStr, 10);
  if (isNaN(dniNum) || dniStr.length < 7 || dniStr.length > 8) {
    throw new Error('DNI debe tener 7 u 8 dígitos');
  }

  const { token, sign } = await getAuth('ws_sr_padron_a13');
  const cuitRepresentadaStr = (process.env.AFIP_CUIT || '').replace(/\D/g, '');
  const cuitRepresentada = cuitRepresentadaStr.length === 11 ? parseInt(cuitRepresentadaStr, 10) : 0;

  const { data } = await axios.post(
    `${AFIP_SDK_BASE}/requests`,
    {
      environment: getEnvironment(),
      method: 'getIdPersonaListByDocumento',
      wsid: 'ws_sr_padron_a13',
      params: {
        token,
        sign,
        cuitRepresentada,
        documento: dniNum
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AFIP_ACCESS_TOKEN}`
      },
      timeout: 15000
    }
  );

  // La respuesta puede ser { idPersona: 20123456789 } o { personaReturn: { idPersona: ... } } o array
  let idPersona = null;
  if (data && typeof data.idPersona !== 'undefined') {
    idPersona = data.idPersona;
  } else if (data && data.personaReturn && typeof data.personaReturn.idPersona !== 'undefined') {
    idPersona = data.personaReturn.idPersona;
  } else if (Array.isArray(data) && data.length > 0) {
    idPersona = data[0].idPersona ?? data[0];
  } else if (data && typeof data === 'object') {
    const firstKey = Object.keys(data)[0];
    if (firstKey && data[firstKey] && typeof data[firstKey].idPersona !== 'undefined') {
      idPersona = data[firstKey].idPersona;
    }
  }

  if (idPersona == null) {
    return null;
  }
  const cuit = String(idPersona).replace(/\D/g, '');
  return cuit.length === 11 ? cuit : null;
}

/**
 * Obtiene los datos del contribuyente por CUIT usando Constancia de Inscripción.
 * @param {string|number} cuit - CUIT (11 dígitos)
 * @returns {Promise<object|null>} Respuesta cruda de getPersona_v2 o null
 */
async function getDatosConstancia(cuit) {
  const cuitStr = String(cuit).replace(/\D/g, '');
  if (cuitStr.length !== 11) {
    throw new Error('CUIT debe tener 11 dígitos');
  }
  const idPersona = parseInt(cuitStr, 10);

  const { token, sign } = await getAuth('ws_sr_constancia_inscripcion');
  const cuitRepresentadaStr = (process.env.AFIP_CUIT || '').replace(/\D/g, '');
  const cuitRepresentada = cuitRepresentadaStr.length === 11 ? parseInt(cuitRepresentadaStr, 10) : 0;

  const { data } = await axios.post(
    `${AFIP_SDK_BASE}/requests`,
    {
      environment: getEnvironment(),
      method: 'getPersona_v2',
      wsid: 'ws_sr_constancia_inscripcion',
      params: {
        token,
        sign,
        cuitRepresentada,
        idPersona
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AFIP_ACCESS_TOKEN}`
      },
      timeout: 15000
    }
  );

  if (!data) return null;

  // La respuesta puede venir en data.personaReturn o directamente en data
  const personaReturn = data.personaReturn || data;
  const datosGenerales = personaReturn.datosGenerales;
  if (!datosGenerales) return null;

  return personaReturn;
}

/**
 * Mapea la respuesta de Constancia de Inscripción al formato cliente del ERP.
 * @param {object} personaReturn - Respuesta de getPersona_v2 (personaReturn)
 * @param {string} [dniOpcional] - DNI ingresado por el usuario (para Consumidor Final por DNI)
 * @returns {object} { nombre, cuit, dni, condicion_iva, direccion, ciudad, provincia }
 */
function mapConstanciaToCliente(personaReturn, dniOpcional) {
  const dg = personaReturn.datosGenerales || {};
  const domicilio = dg.domicilioFiscal || {};
  const monotributo = personaReturn.datosMonotributo;
  const regimenGeneral = personaReturn.datosRegimenGeneral;

  let condicion_iva = 'Consumidor Final';
  const tieneMonotributo = monotributo && (
    (monotributo.categoriaMonotributo && typeof monotributo.categoriaMonotributo === 'object') ||
    (Array.isArray(monotributo.impuesto) && monotributo.impuesto.length > 0) ||
    (monotributo.actividadMonotributista && typeof monotributo.actividadMonotributista === 'object')
  );
  const tieneRegimenGeneral = regimenGeneral && (
    (Array.isArray(regimenGeneral.impuesto) && regimenGeneral.impuesto.length > 0) ||
    (Array.isArray(regimenGeneral.regimen) && regimenGeneral.regimen.length > 0)
  );
  if (tieneMonotributo) {
    condicion_iva = 'Monotributo';
  } else if (tieneRegimenGeneral) {
    condicion_iva = 'Responsable Inscripto';
  }

  const idPersona = dg.idPersona != null ? String(dg.idPersona).replace(/\D/g, '') : '';
  const cuitFormateado = idPersona.length === 11
    ? `${idPersona.slice(0, 2)}-${idPersona.slice(2, 10)}-${idPersona.slice(10)}`
    : '';

  let nombre = '';
  if (dg.razonSocial) {
    nombre = dg.razonSocial.trim();
  } else if (dg.apellido || dg.nombre) {
    nombre = [dg.apellido, dg.nombre].filter(Boolean).join(' ').trim();
  }

  const direccion = (domicilio.direccion || '').trim();
  const ciudad = (domicilio.localidad || '').trim();
  const provincia = (domicilio.descripcionProvincia || '').trim();

  const dni = dniOpcional != null && String(dniOpcional).trim() !== ''
    ? String(dniOpcional).replace(/\D/g, '')
    : (idPersona.length === 11 ? idPersona.slice(2, 10).replace(/^0+/, '') || idPersona.slice(2, 10) : '');

  return {
    nombre,
    cuit: cuitFormateado || idPersona,
    dni: dni || '',
    condicion_iva,
    direccion,
    ciudad,
    provincia
  };
}

module.exports = {
  getEnvironment,
  getAuth,
  getCuitPorDni,
  getDatosConstancia,
  mapConstanciaToCliente
};
