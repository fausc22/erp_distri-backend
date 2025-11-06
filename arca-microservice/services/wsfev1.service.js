import soap from 'soap';
import wsaaService from './wsaa.service.js';
import afipConfig from '../config/afip.config.js';

/**
 * SERVICIO WSFEv1 - FACTURACIÓN ELECTRÓNICA
 *
 * Implementación directa en SOAP del WebService WSFEv1 de AFIP
 * Compatible con la interfaz del arca-microservice pero usando SOAP nativo
 */

class WSFEv1Service {
  constructor() {
    this.client = null;
    console.log('✓ Servicio WSFEv1 inicializado');
  }

  /**
   * OBTENER CLIENTE SOAP
   *
   * Crea o reutiliza el cliente SOAP de WSFEv1
   */
  async getClient() {
    if (!this.client) {
      try {
        this.client = await soap.createClientAsync(afipConfig.urls.wsfev1);
        console.log('✓ Cliente SOAP WSFEv1 conectado');
      } catch (error) {
        console.error('❌ Error al conectar con WSFEv1:', error);
        throw new Error(`Error al conectar con WSFEv1: ${error.message}`);
      }
    }
    return this.client;
  }

  /**
   * SOLICITAR CAE (FECAESolicitar)
   *
   * Método principal para autorizar comprobantes
   */
  async solicitarCAE(datosComprobante) {
    try {
      console.log('📤 Enviando solicitud de CAE a AFIP...');

      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      // Construir la estructura FeCAEReq según el manual
      const feCAEReq = {
        FeCabReq: {
          CantReg: datosComprobante.CantReg || 1,
          PtoVta: datosComprobante.PtoVta,
          CbteTipo: datosComprobante.CbteTipo
        },
        FeDetReq: {
          FECAEDetRequest: {
            Concepto: datosComprobante.Concepto,
            DocTipo: datosComprobante.DocTipo,
            DocNro: datosComprobante.DocNro,
            CbteDesde: datosComprobante.CbteDesde,
            CbteHasta: datosComprobante.CbteHasta,
            CbteFch: datosComprobante.CbteFch,
            ImpTotal: datosComprobante.ImpTotal,
            ImpTotConc: datosComprobante.ImpTotConc || 0,
            ImpNeto: datosComprobante.ImpNeto,
            ImpOpEx: datosComprobante.ImpOpEx || 0,
            ImpIVA: datosComprobante.ImpIVA,
            ImpTrib: datosComprobante.ImpTrib || 0,
            MonId: datosComprobante.MonId || 'PES',
            MonCotiz: datosComprobante.MonCotiz || 1
          }
        }
      };

      // Agregar fechas de servicio si existen
      if (datosComprobante.FchServDesde) {
        feCAEReq.FeDetReq.FECAEDetRequest.FchServDesde = datosComprobante.FchServDesde;
      }
      if (datosComprobante.FchServHasta) {
        feCAEReq.FeDetReq.FECAEDetRequest.FchServHasta = datosComprobante.FchServHasta;
      }
      if (datosComprobante.FchVtoPago) {
        feCAEReq.FeDetReq.FECAEDetRequest.FchVtoPago = datosComprobante.FchVtoPago;
      }

      // Agregar IVA si existe
      if (datosComprobante.Iva && datosComprobante.Iva.length > 0) {
        feCAEReq.FeDetReq.FECAEDetRequest.Iva = {
          AlicIva: datosComprobante.Iva.map(alicuota => ({
            Id: alicuota.Id,
            BaseImp: alicuota.BaseImp,
            Importe: alicuota.Importe
          }))
        };
      }

      // Agregar tributos si existen
      if (datosComprobante.Tributos && datosComprobante.Tributos.length > 0) {
        feCAEReq.FeDetReq.FECAEDetRequest.Tributos = {
          Tributo: datosComprobante.Tributos
        };
      }

      // Agregar comprobantes asociados (para NC/ND)
      if (datosComprobante.CbtesAsoc && datosComprobante.CbtesAsoc.length > 0) {
        feCAEReq.FeDetReq.FECAEDetRequest.CbtesAsoc = {
          CbteAsoc: datosComprobante.CbtesAsoc
        };
      }

      // Agregar opcionales si existen
      if (datosComprobante.Opcionales && datosComprobante.Opcionales.length > 0) {
        feCAEReq.FeDetReq.FECAEDetRequest.Opcionales = {
          Opcional: datosComprobante.Opcionales
        };
      }

      // Llamar a FECAESolicitar
      const [result] = await client.FECAESolicitarAsync({
        Auth: auth,
        FeCAEReq: feCAEReq
      });

      const response = result.FECAESolicitarResult;

      // Verificar errores
      if (response.Errors) {
        const errors = Array.isArray(response.Errors.Err)
          ? response.Errors.Err
          : [response.Errors.Err];

        const errorMessages = errors.map(e => `[${e.Code}] ${e.Msg}`).join(', ');
        throw new Error(`Error de AFIP: ${errorMessages}`);
      }

      // Obtener resultado del detalle
      const detResponse = response.FeDetResp.FECAEDetResponse;

      if (detResponse.Resultado !== 'A') {
        const obs = detResponse.Observaciones?.Obs || [];
        const obsMessages = Array.isArray(obs)
          ? obs.map(o => `[${o.Code}] ${o.Msg}`).join(', ')
          : `[${obs.Code}] ${obs.Msg}`;

        throw new Error(`Comprobante rechazado: ${obsMessages}`);
      }

      console.log('✓ CAE obtenido exitosamente');

      return {
        CAE: detResponse.CAE,
        CAEFchVto: detResponse.CAEFchVto,
        Resultado: detResponse.Resultado,
        Observaciones: detResponse.Observaciones
      };

    } catch (error) {
      console.error('❌ Error en FECAESolicitar:', error);
      throw error;
    }
  }

  /**
   * OBTENER ÚLTIMO COMPROBANTE AUTORIZADO (FECompUltimoAutorizado)
   */
  async obtenerUltimoComprobante(puntoVenta, tipoComprobante) {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FECompUltimoAutorizadoAsync({
        Auth: auth,
        PtoVta: puntoVenta,
        CbteTipo: tipoComprobante
      });

      const response = result.FECompUltimoAutorizadoResult;

      if (response.Errors) {
        const errors = Array.isArray(response.Errors.Err)
          ? response.Errors.Err
          : [response.Errors.Err];

        const errorMessages = errors.map(e => `[${e.Code}] ${e.Msg}`).join(', ');
        throw new Error(`Error de AFIP: ${errorMessages}`);
      }

      return response.CbteNro;

    } catch (error) {
      console.error('❌ Error en FECompUltimoAutorizado:', error);
      throw error;
    }
  }

  /**
   * CONSULTAR COMPROBANTE (FECompConsultar)
   */
  async consultarComprobante(numeroComprobante, puntoVenta, tipoComprobante) {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FECompConsultarAsync({
        Auth: auth,
        FeCompConsReq: {
          CbteTipo: tipoComprobante,
          CbteNro: numeroComprobante,
          PtoVta: puntoVenta
        }
      });

      const response = result.FECompConsultarResult;

      if (response.Errors) {
        return null;
      }

      return response.ResultGet;

    } catch (error) {
      console.error('❌ Error en FECompConsultar:', error);
      return null;
    }
  }

  /**
   * OBTENER TIPOS DE COMPROBANTES (FEParamGetTiposCbte)
   */
  async obtenerTiposComprobantes() {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FEParamGetTiposCbteAsync({
        Auth: auth
      });

      return result.FEParamGetTiposCbteResult.ResultGet.CbteTipo;

    } catch (error) {
      console.error('❌ Error en FEParamGetTiposCbte:', error);
      throw error;
    }
  }

  /**
   * OBTENER TIPOS DE DOCUMENTOS (FEParamGetTiposDoc)
   */
  async obtenerTiposDocumentos() {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FEParamGetTiposDocAsync({
        Auth: auth
      });

      return result.FEParamGetTiposDocResult.ResultGet.DocTipo;

    } catch (error) {
      console.error('❌ Error en FEParamGetTiposDoc:', error);
      throw error;
    }
  }

  /**
   * OBTENER ALÍCUOTAS DE IVA (FEParamGetTiposIva)
   */
  async obtenerTiposIVA() {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FEParamGetTiposIvaAsync({
        Auth: auth
      });

      return result.FEParamGetTiposIvaResult.ResultGet.IvaTipo;

    } catch (error) {
      console.error('❌ Error en FEParamGetTiposIva:', error);
      throw error;
    }
  }

  /**
   * OBTENER PUNTOS DE VENTA (FEParamGetPtosVenta)
   */
  async obtenerPuntosVenta() {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FEParamGetPtosVentaAsync({
        Auth: auth
      });

      return result.FEParamGetPtosVentaResult.ResultGet.PtoVenta;

    } catch (error) {
      console.error('❌ Error en FEParamGetPtosVenta:', error);

      // En testing, devolver punto de venta por defecto
      if (afipConfig.environment === 'dev') {
        return [{ Nro: 1 }];
      }
      throw error;
    }
  }

  /**
   * OBTENER ESTADO DEL SERVIDOR (FEDummy)
   */
  async verificarEstadoServidor() {
    try {
      const client = await this.getClient();

      const [result] = await client.FEDummyAsync();

      return {
        appserver: result.FEDummyResult.AppServer,
        dbserver: result.FEDummyResult.DbServer,
        authserver: result.FEDummyResult.AuthServer
      };

    } catch (error) {
      console.error('❌ Error en FEDummy:', error);
      throw error;
    }
  }

  /**
   * SOLICITAR CAEA (FECAEASolicitar)
   */
  async solicitarCAEA(periodo, orden) {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FECAEASolicitarAsync({
        Auth: auth,
        Periodo: periodo,
        Orden: orden
      });

      const response = result.FECAEASolicitarResult;

      if (response.Errors) {
        const errors = Array.isArray(response.Errors.Err)
          ? response.Errors.Err
          : [response.Errors.Err];

        const errorMessages = errors.map(e => `[${e.Code}] ${e.Msg}`).join(', ');
        throw new Error(`Error de AFIP: ${errorMessages}`);
      }

      return response.ResultGet;

    } catch (error) {
      console.error('❌ Error en FECAEASolicitar:', error);
      throw error;
    }
  }

  /**
   * CONSULTAR CAEA (FECAEAConsultar)
   */
  async consultarCAEA(periodo, orden) {
    try {
      const client = await this.getClient();
      const auth = await wsaaService.getAuth();

      const [result] = await client.FECAEAConsultarAsync({
        Auth: auth,
        Periodo: periodo,
        Orden: orden
      });

      const response = result.FECAEAConsultarResult;

      if (response.Errors) {
        return null;
      }

      return response.ResultGet;

    } catch (error) {
      console.error('❌ Error en FECAEAConsultar:', error);
      return null;
    }
  }
}

// Exportar instancia única (singleton)
const wsfev1Service = new WSFEv1Service();
export default wsfev1Service;
