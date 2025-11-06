import soap from 'soap';
import fs from 'fs';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import afipConfig from '../config/afip.config.js';

/**
 * SERVICIO DE AUTENTICACIÓN WSAA
 *
 * Maneja la autenticación con AFIP mediante WSAA (Web Services de Autenticación y Autorización)
 * Genera y mantiene el Ticket de Acceso (TA) que contiene Token y Sign
 */

class WSAAService {
  constructor() {
    this.ticket = null;
    this.ticketExpiration = null;
    console.log('✓ Servicio WSAA inicializado');
  }

  /**
   * GENERAR LOGIN TICKET REQUEST (TRA)
   *
   * Crea el XML con la solicitud de ticket firmado con el certificado
   */
  generateLoginTicketRequest(service = 'wsfe') {
    const now = new Date();
    const expirationTime = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 horas

    const uniqueId = Math.floor(Date.now() / 1000);

    const formatDate = (date) => {
      return date.toISOString().split('.')[0];
    };

    // Generar el XML del TRA (sin firmar)
    const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
<header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${formatDate(now)}</generationTime>
    <expirationTime>${formatDate(expirationTime)}</expirationTime>
</header>
<service>${service}</service>
</loginTicketRequest>`;

    return tra;
  }

  /**
   * FIRMAR TRA CON CERTIFICADO
   *
   * Firma el TRA con el certificado y clave privada
   */
  signLoginTicketRequest(tra) {
    try {
      const cert = afipConfig.loadCertificate();
      const key = afipConfig.loadPrivateKey();

      // Parsear el XML
      const doc = new DOMParser().parseFromString(tra);

      // Crear la firma XML
      const sig = new SignedXml({
        privateKey: key
      });

      // Configurar referencias y transformaciones
      sig.addReference({
        xpath: "//*[local-name(.)='loginTicketRequest']",
        transforms: [
          'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
          'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
      });

      sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
      sig.keyInfoProvider = {
        getKeyInfo: () => {
          return `<X509Data><X509Certificate>${cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, '')}</X509Certificate></X509Data>`;
        }
      };

      // Calcular la firma
      sig.computeSignature(tra);

      return sig.getSignedXml();

    } catch (error) {
      console.error('❌ Error al firmar TRA:', error);
      throw new Error(`Error al firmar TRA: ${error.message}`);
    }
  }

  /**
   * SOLICITAR TICKET DE ACCESO (TA)
   *
   * Envía el TRA firmado a WSAA y obtiene el Token y Sign
   */
  async requestTicket(service = 'wsfe') {
    try {
      console.log('🔐 Solicitando Ticket de Acceso a WSAA...');

      // 1. Generar TRA
      const tra = this.generateLoginTicketRequest(service);

      // 2. Firmar TRA
      const signedTRA = this.signLoginTicketRequest(tra);

      // 3. Conectar con WSAA SOAP
      const client = await soap.createClientAsync(afipConfig.urls.wsaa);

      // 4. Llamar al método loginCms
      const [result] = await client.loginCmsAsync({
        in0: signedTRA
      });

      // 5. Parsear respuesta
      const loginTicketResponse = result.loginCmsReturn;
      const doc = new DOMParser().parseFromString(loginTicketResponse);

      const token = doc.getElementsByTagName('token')[0].textContent;
      const sign = doc.getElementsByTagName('sign')[0].textContent;
      const expirationTime = doc.getElementsByTagName('expirationTime')[0].textContent;

      // 6. Guardar ticket en memoria
      this.ticket = {
        token,
        sign,
        cuit: afipConfig.CUIT,
        expirationTime: new Date(expirationTime)
      };

      this.ticketExpiration = new Date(expirationTime);

      console.log('✓ Ticket de Acceso obtenido exitosamente');
      console.log(`  Expira: ${expirationTime}`);

      return this.ticket;

    } catch (error) {
      console.error('❌ Error al obtener Ticket de Acceso:', error);
      throw new Error(`Error en WSAA: ${error.message}`);
    }
  }

  /**
   * VERIFICAR SI EL TICKET ES VÁLIDO
   */
  isTicketValid() {
    if (!this.ticket || !this.ticketExpiration) {
      return false;
    }

    // Considerar válido si tiene al menos 10 minutos de vida
    const now = new Date();
    const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);

    return this.ticketExpiration > tenMinutesFromNow;
  }

  /**
   * OBTENER TICKET VÁLIDO
   *
   * Devuelve el ticket actual o solicita uno nuevo si expiró
   */
  async getValidTicket(service = 'wsfe') {
    if (!this.isTicketValid()) {
      console.log('🔄 Ticket expirado o inexistente, solicitando nuevo...');
      await this.requestTicket(service);
    }

    return this.ticket;
  }

  /**
   * OBTENER CREDENCIALES PARA WSFEv1
   *
   * Devuelve el objeto Auth que necesita WSFEv1
   */
  async getAuth() {
    const ticket = await this.getValidTicket('wsfe');

    return {
      Token: ticket.token,
      Sign: ticket.sign,
      Cuit: parseInt(ticket.cuit)
    };
  }
}

// Exportar instancia única (singleton)
const wsaaService = new WSAAService();
export default wsaaService;
