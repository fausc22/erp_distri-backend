import { Arca } from '@arcasdk/core';
import { createRequire } from 'module';
import afipConfig from '../config/afip.config.js';

const require = createRequire(import.meta.url);
const discordLogger = require('../../utils/discordLogger.js');

/** Envía log a consola y a Discord (canal ARCA/AFIP). */
function arcaLog(msg, ctx = {}) {
  console.log(msg);
  discordLogger.sendArcaAfip(msg, ctx);
}
function arcaErr(msg, ctx = {}) {
  console.error(msg);
  discordLogger.sendArcaAfip(msg, ctx);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHttpStatus(error) {
  return error?.response?.status || error?.status || null;
}

function esErrorTransitorio(error) {
  const status = getHttpStatus(error);
  if (status && status >= 500) return true;

  const code = error?.code;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('socket hang up');
}

/** CAEFchVto como yyyy-mm-dd (misma convención que @afipsdk/afip.js). */
function formatCaeFchVto(dateVal) {
  if (dateVal == null || dateVal === '') return '';
  const s = String(dateVal);
  return s.replace(/(\d{4})(\d{2})(\d{2})/, (_, y, m, d) => `${y}-${m}-${d}`);
}

/**
 * Normaliza la respuesta de createVoucher de @arcasdk/core al shape { CAE, CAEFchVto, Resultado }
 * esperado por billing.service / formatters (compatible con @afipsdk/afip.js).
 */
function normalizeCreateVoucherResult(arcasdkResult) {
  const response = arcasdkResult?.response;
  if (response?.Errors?.Err) {
    const errs = Array.isArray(response.Errors.Err) ? response.Errors.Err : [response.Errors.Err];
    const errorMessages = errs.map(e => `[${e.Code}] ${e.Msg}`).join(', ');
    throw new Error(`Error de ARCA: ${errorMessages}`);
  }

  const fec = response?.FeDetResp?.FECAEDetResponse;
  const det = Array.isArray(fec) ? fec[0] : fec;

  if (!det) {
    throw new Error('Error de ARCA: respuesta sin detalle de comprobante');
  }

  if (det.Resultado !== 'A') {
    let obsMessages = '';
    const obs = det.Observaciones?.Obs;
    if (obs) {
      const arr = Array.isArray(obs) ? obs : [obs];
      obsMessages = arr.map(o => `[${o.Code}] ${o.Msg}`).join(', ');
    } else {
      obsMessages = 'Sin observaciones específicas';
    }
    throw new Error(`Comprobante rechazado (${det.Resultado || 'Desconocido'}): ${obsMessages}`);
  }

  return {
    CAE: det.CAE,
    CAEFchVto: formatCaeFchVto(det.CAEFchVto),
    Resultado: det.Resultado
  };
}

/** Convierte getVoucherInfo de @arcasdk/core a un objeto con claves tipo ResultGet de AFIP (PascalCase). */
function voucherInfoToLegacyShape(v) {
  if (!v) return null;
  return {
    CodAutorizacion: v.codAutorizacion,
    EmisionTipo: v.emisionTipo,
    FchVto: v.fchVto,
    FchProceso: v.fchProceso,
    Resultado: v.resultado,
    Concepto: v.concepto,
    DocTipo: v.docTipo,
    DocNro: v.docNro,
    CbteDesde: v.cbteDesde,
    CbteHasta: v.cbteHasta,
    CbteFch: v.cbteFch,
    ImpTotal: v.impTotal,
    ImpTotConc: v.impTotConc,
    ImpNeto: v.impNeto,
    ImpOpEx: v.impOpEx,
    ImpIVA: v.impIVA,
    ImpTrib: v.impTrib,
    MonId: v.monId,
    MonCotiz: v.monCotiz,
    observacionesMsg: v.observaciones,
    Observaciones: v.observaciones
  };
}

/**
 * SERVICIO PRINCIPAL DE AFIP/ARCA
 *
 * Motor: @arcasdk/core (conexión directa a ARCA). Rollback: restaurar afip.service.backup.js.
 */
class AfipService {
  constructor() {
    const config = afipConfig.getArcaSDKConfig();

    try {
      this.arca = new Arca(config);
      this.config = afipConfig;

      if (process.env.NODE_ENV === 'development') {
        const ambiente = config.production ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN';
        arcaLog(`✅ ARCA @arcasdk/core inicializado (${ambiente}, CUIT: ${config.cuit})`);
      }
    } catch (error) {
      arcaErr(`❌ Error al inicializar @arcasdk/core: ${error.message}`);
      throw error;
    }
  }

  /**
   * @param {number} puntoVenta
   * @param {number} tipoComprobante
   * @returns {Promise<number>}
   */
  async obtenerUltimoComprobante(puntoVenta, tipoComprobante) {
    const maxIntentos = 3;
    const esperaBaseMs = 700;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        arcaLog(
          `📊 Consultando último comprobante - PV: ${puntoVenta}, Tipo: ${tipoComprobante} (intento ${intento}/${maxIntentos})`
        );

        const res = await this.arca.electronicBillingService.getLastVoucher(puntoVenta, tipoComprobante);
        if (res.errors?.err?.length) {
          const msg = res.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
          throw new Error(`Error de ARCA: ${msg}`);
        }
        const ultimoNumero = res.cbteNro ?? 0;

        arcaLog(`✓ Último comprobante: ${ultimoNumero}`);
        return ultimoNumero;
      } catch (error) {
        const status = getHttpStatus(error);
        const esTransitorio = esErrorTransitorio(error);
        const ultimoIntento = intento === maxIntentos;
        const detalle = `status=${status || 'N/A'} code=${error?.code || 'N/A'} msg=${error.message}`;

        if (!esTransitorio || ultimoIntento) {
          arcaErr(`❌ Error al obtener último comprobante (${detalle})`);
          throw new Error(`Error al consultar último comprobante: ${error.message}`);
        }

        const esperaMs = esperaBaseMs * (2 ** (intento - 1));
        arcaLog(`⚠️ Falla transitoria consultando último comprobante (${detalle}). Reintentando en ${esperaMs}ms...`);
        await sleep(esperaMs);
      }
    }
  }

  /**
   * @param {Object} datosComprobante
   * @param {boolean} _respuestaCompleta ignorado (compatibilidad con firma anterior)
   */
  async crearComprobante(datosComprobante, _respuestaCompleta = false) {
    const maxIntentos = 3;
    const esperaBaseMs = 700;
    const ptoVta = datosComprobante?.PtoVta;
    const cbteTipo = datosComprobante?.CbteTipo;
    const cbteDesde = datosComprobante?.CbteDesde;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        // Antes de reintentar: si AFIP ya autorizó el nº, recuperar CAE (no re-emitir)
        if (intento > 1 && ptoVta != null && cbteTipo != null && cbteDesde != null) {
          const recuperado = await this._intentarRecuperarComprobanteAutorizado(
            ptoVta,
            cbteTipo,
            cbteDesde
          );
          if (recuperado) {
            return recuperado;
          }
        }

        arcaLog(`📝 Creando comprobante en ARCA... (intento ${intento}/${maxIntentos})`);

        const raw = await this.arca.electronicBillingService.createVoucher(datosComprobante);
        const resultado = normalizeCreateVoucherResult(raw);

        arcaLog(`✓ Comprobante creado exitosamente | CAE: ${resultado.CAE} | Vto: ${resultado.CAEFchVto}`);
        return resultado;
      } catch (error) {
        if (String(error?.message || '').includes('Reconciliar')) {
          throw error;
        }

        const status = getHttpStatus(error);
        const esTransitorio = esErrorTransitorio(error);
        const ultimoIntento = intento === maxIntentos;
        const detalle = `status=${status || 'N/A'} code=${error?.code || 'N/A'} msg=${error.message}`;

        if (!esTransitorio || ultimoIntento) {
          // Último intento: intentar recuperar si el comprobante ya quedó autorizado
          if (esTransitorio && ptoVta != null && cbteTipo != null && cbteDesde != null) {
            const recuperado = await this._intentarRecuperarComprobanteAutorizado(
              ptoVta,
              cbteTipo,
              cbteDesde
            );
            if (recuperado) {
              return recuperado;
            }
          }

          arcaErr('❌ Error al crear comprobante: ' + error.message);

          if (error.response?.data) {
            const errData = error.response.data;
            throw new Error(`Error de ARCA: ${errData.Errors || error.message}`);
          }

          throw new Error(`Error al crear comprobante: ${error.message}`);
        }

        const esperaMs = esperaBaseMs * (2 ** (intento - 1));
        arcaLog(`⚠️ Falla transitoria creando comprobante (${detalle}). Reintentando en ${esperaMs}ms...`);
        await sleep(esperaMs);
      }
    }
  }

  /**
   * Si el último nº AFIP ya cubre CbteDesde, intenta obtener el CAE vía getVoucherInfo.
   * Evita doble emisión tras timeout ambiguo.
   * @returns {Promise<{CAE: string, CAEFchVto: string, Resultado: string}|null>}
   *   null = el nº aún no existe en ARCA (se puede crear).
   *   Si el nº ya existe y no hay CAE legible, lanza error de reconciliación (no re-emitir).
   */
  async _intentarRecuperarComprobanteAutorizado(puntoVenta, tipoComprobante, numeroComprobante) {
    let ultimo;
    try {
      ultimo = await this.obtenerUltimoComprobante(puntoVenta, tipoComprobante);
    } catch (error) {
      arcaLog(`⚠️ No se pudo consultar último comprobante para reconciliar: ${error.message}`);
      return null;
    }

    if (ultimo < numeroComprobante) {
      return null;
    }

    arcaLog(
      `🔎 Comprobante ${numeroComprobante} ya figura en ARCA (último=${ultimo}). Consultando CAE...`
    );

    let info = null;
    try {
      info = await this.obtenerInfoComprobante(numeroComprobante, puntoVenta, tipoComprobante);
    } catch (error) {
      arcaErr(`❌ No se pudo leer comprobante ya emitido: ${error.message}`);
    }

    const cae = info?.CodAutorizacion;
    if (!cae) {
      throw new Error(
        `El comprobante ${puntoVenta}-${numeroComprobante} ya existe en ARCA pero no se pudo obtener el CAE. Reconciliar manualmente (no se reintentó la emisión).`
      );
    }

    const resultado = {
      CAE: String(cae),
      CAEFchVto: formatCaeFchVto(info.FchVto),
      Resultado: info.Resultado || 'A'
    };

    arcaLog(`✓ CAE recuperado sin re-emitir | CAE: ${resultado.CAE} | Vto: ${resultado.CAEFchVto}`);
    return resultado;
  }

  async crearSiguienteComprobante(datosComprobante) {
    try {
      arcaLog('📝 Creando siguiente comprobante...');

      const raw = await this.arca.electronicBillingService.createNextVoucher(datosComprobante);
      const base = normalizeCreateVoucherResult(raw);

      const fec = raw.response?.FeDetResp?.FECAEDetResponse;
      const det = Array.isArray(fec) ? fec[0] : fec;
      const voucherNumber = det?.CbteDesde ?? det?.CbteHasta;

      const resultado = {
        ...base,
        voucher_number: voucherNumber
      };

      arcaLog(`✓ Siguiente comprobante creado | Nº: ${resultado.voucher_number} | CAE: ${resultado.CAE}`);

      return resultado;
    } catch (error) {
      arcaErr('❌ Error al crear siguiente comprobante: ' + error.message);
      throw new Error(`Error al crear siguiente comprobante: ${error.message}`);
    }
  }

  async obtenerInfoComprobante(numeroComprobante, puntoVenta, tipoComprobante) {
    try {
      arcaLog(`🔍 Consultando comprobante ${numeroComprobante}...`);

      const info = await this.arca.electronicBillingService.getVoucherInfo(
        numeroComprobante,
        puntoVenta,
        tipoComprobante
      );

      if (info === null) {
        arcaLog('ℹ Comprobante no encontrado');
        return null;
      }

      if (info.errors?.err?.length) {
        const msg = info.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
        throw new Error(`Error de ARCA: ${msg}`);
      }

      arcaLog('✓ Información del comprobante obtenida');
      return voucherInfoToLegacyShape(info);
    } catch (error) {
      arcaErr('❌ Error al obtener información: ' + error.message);
      throw new Error(`Error al consultar comprobante: ${error.message}`);
    }
  }

  async obtenerTiposComprobantes() {
    try {
      const r = await this.arca.electronicBillingService.getVoucherTypes();
      if (r.errors?.err?.length) {
        const msg = r.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
        throw new Error(`Error de ARCA: ${msg}`);
      }
      return r.resultGet?.cbteTipo ?? [];
    } catch (error) {
      arcaErr('❌ Error al obtener tipos de comprobantes: ' + error.message);
      throw error;
    }
  }

  async obtenerTiposDocumentos() {
    try {
      const r = await this.arca.electronicBillingService.getDocumentTypes();
      if (r.errors?.err?.length) {
        const msg = r.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
        throw new Error(`Error de ARCA: ${msg}`);
      }
      return r.resultGet?.docTipo ?? [];
    } catch (error) {
      arcaErr('❌ Error al obtener tipos de documentos: ' + error.message);
      throw error;
    }
  }

  async obtenerTiposIVA() {
    try {
      const r = await this.arca.electronicBillingService.getAliquotTypes();
      if (r.errors?.err?.length) {
        const msg = r.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
        throw new Error(`Error de ARCA: ${msg}`);
      }
      return r.resultGet?.ivaTipo ?? [];
    } catch (error) {
      arcaErr('❌ Error al obtener tipos de IVA: ' + error.message);
      throw error;
    }
  }

  async obtenerPuntosVenta() {
    try {
      const r = await this.arca.electronicBillingService.getSalesPoints();
      if (r.errors?.err?.length) {
        const msg = r.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
        throw new Error(`Error de ARCA: ${msg}`);
      }
      const list = r.resultGet?.ptoVenta ?? [];
      return list.map(p => ({
        PtoVta: p.nro,
        Nro: p.nro,
        EmisionTipo: p.emisionTipo,
        Bloqueado: p.bloqueado,
        FchBaja: p.fechaBaja
      }));
    } catch (error) {
      if (afipConfig.environment === 'dev') {
        arcaLog('ℹ En testing, usar punto de venta 1 por defecto');
        return [{ PtoVta: 1 }];
      }
      throw error;
    }
  }

  async verificarEstadoServidor() {
    try {
      const estado = await this.arca.electronicBillingService.getServerStatus();
      const legacy = {
        AppServer: estado.appServer,
        DbServer: estado.dbServer,
        AuthServer: estado.authServer
      };
      arcaLog('Estado del servidor ARCA: ' + JSON.stringify(legacy));
      return legacy;
    } catch (error) {
      arcaErr('❌ Error al verificar servidor: ' + error.message);
      throw error;
    }
  }

  /**
   * Cotización oficial. @arcasdk/core 0.3.x usa FEParamGetCotizacion con MonId;
   * si se pasa `fecha` se refleja en ResultGet.FchCotiz para compatibilidad con consumidores legacy.
   */
  async obtenerCotizacionMoneda(monedaId, fecha) {
    try {
      const r = await this.arca.electronicBillingService.getQuotation(monedaId);
      if (r.errors?.err?.length) {
        const msg = r.errors.err.map(e => `[${e.code}] ${e.msg}`).join(', ');
        throw new Error(`Error de ARCA: ${msg}`);
      }
      const rg = r.resultGet || {};
      return {
        ResultGet: {
          MonId: rg.monId ?? monedaId,
          MonCotiz: rg.monCotiz,
          FchCotiz: fecha != null ? String(fecha) : rg.fchCotiz
        }
      };
    } catch (error) {
      arcaErr('❌ Error al obtener cotización: ' + error.message);
      throw error;
    }
  }

  async getCuitPorDni(dni) {
    const dniStr = String(dni).replace(/\D/g, '');
    const dniNum = parseInt(dniStr, 10);
    if (isNaN(dniNum) || dniStr.length < 7 || dniStr.length > 8) {
      throw new Error('DNI debe tener 7 u 8 dígitos');
    }
    try {
      const result = await this.arca.registerScopeThirteenService.getTaxIDByDocument(dniStr);
      const ids = result?.idPersona;
      if (ids == null || (Array.isArray(ids) && ids.length === 0)) {
        return null;
      }
      const first = Array.isArray(ids) ? ids[0] : ids;
      const cuitStr = String(first).replace(/\D/g, '');
      return cuitStr.length === 11 ? cuitStr : null;
    } catch (error) {
      arcaErr('❌ Error Padrón A13 (CUIT por DNI): ' + error.message);
      throw error;
    }
  }

  async getDatosConstancia(cuit) {
    const cuitStr = String(cuit).replace(/\D/g, '');
    if (cuitStr.length !== 11) throw new Error('CUIT debe tener 11 dígitos');
    const idPersona = parseInt(cuitStr, 10);
    try {
      const personaReturn = await this.arca.registerInscriptionProofService.getTaxpayerDetails(idPersona);
      return personaReturn || null;
    } catch (error) {
      arcaErr('❌ Error Constancia de Inscripción: ' + error.message);
      throw error;
    }
  }

  mapConstanciaToCliente(personaReturn, dniOpcional) {
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
    if (tieneMonotributo) condicion_iva = 'Monotributo';
    else if (tieneRegimenGeneral) condicion_iva = 'Responsable Inscripto';

    const idPersona = dg.idPersona != null ? String(dg.idPersona).replace(/\D/g, '') : '';
    const cuitFormateado = idPersona.length === 11
      ? `${idPersona.slice(0, 2)}-${idPersona.slice(2, 10)}-${idPersona.slice(10)}`
      : '';

    let nombre = '';
    if (dg.razonSocial) nombre = dg.razonSocial.trim();
    else if (dg.apellido || dg.nombre) nombre = [dg.apellido, dg.nombre].filter(Boolean).join(' ').trim();

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
}

const afipService = new AfipService();
export default afipService;
