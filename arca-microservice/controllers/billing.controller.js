import billingService from '../services/billing.service.js';
import afipService from '../services/afip.service.js';
import { TIPOS_COMPROBANTE, ALICUOTAS_IVA, CONDICIONES_IVA, TIPOS_DOCUMENTO } from '../types/billing.types.js';

/**
 * CONTROLADOR DE FACTURACIÓN
 * 
 * Endpoints REST para el microservicio de facturación
 */

class BillingController {
  /**
   * POST /api/facturas
   * Crear una nueva factura
   */
  async crearFactura(req, res) {
    try {
      const datosFactura = req.body;
      
      const resultado = await billingService.crearFactura(datosFactura);
      
      res.status(201).json({
        success: true,
        message: 'Factura creada exitosamente',
        data: resultado
      });
      
    } catch (error) {
      console.error('Error en crearFactura:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al crear factura',
        error: error.message
      });
    }
  }

  /**
   * POST /api/facturas/consumidor-final
   * Crear factura para consumidor final (método simplificado)
   */
  async crearFacturaConsumidorFinal(req, res) {
    try {
      const { items, opciones } = req.body;
      
      if (!items || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Debe incluir al menos un item'
        });
      }
      
      const resultado = await billingService.crearFacturaConsumidorFinal(items, opciones);
      
      res.status(201).json({
        success: true,
        message: 'Factura para consumidor final creada exitosamente',
        data: resultado
      });
      
    } catch (error) {
      console.error('Error en crearFacturaConsumidorFinal:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al crear factura',
        error: error.message
      });
    }
  }

  /**
   * POST /api/facturas/responsable-inscripto
   * Crear Factura A para responsable inscripto
   */
  async crearFacturaResponsableInscripto(req, res) {
    console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
    try {
      const { cuit, items, opciones } = req.body;
      
      if (!cuit) {
        return res.status(400).json({
          success: false,
          message: 'Debe proporcionar el CUIT del cliente'
        });
      }
      
      if (!items || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Debe incluir al menos un item'
        });
      }
      
      const resultado = await billingService.crearFacturaResponsableInscripto(
        cuit,
        items,
        opciones
      );
      
      res.status(201).json({
        success: true,
        message: 'Factura A creada exitosamente',
        data: resultado
      });
      
    } catch (error) {
      console.error('Error en crearFacturaResponsableInscripto:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al crear factura',
        error: error.message
      });
    }
  }

  /**
   * POST /api/notas-credito
   * Crear una nota de crédito
   */
  async crearNotaCredito(req, res) {
    try {
      const datosNota = req.body;
      
      const resultado = await billingService.crearNotaCredito(datosNota);
      
      res.status(201).json({
        success: true,
        message: 'Nota de crédito creada exitosamente',
        data: resultado
      });
      
    } catch (error) {
      console.error('Error en crearNotaCredito:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al crear nota de crédito',
        error: error.message
      });
    }
  }

  /**
   * GET /api/facturas/:puntoVenta/:tipo/:numero
   * Consultar una factura específica
   */
  async consultarFactura(req, res) {
    try {
      const { puntoVenta, tipo, numero } = req.params;
      
      const resultado = await billingService.consultarFactura(
        parseInt(numero),
        parseInt(puntoVenta),
        parseInt(tipo)
      );
      
      if (!resultado.encontrada) {
        return res.status(404).json({
          success: false,
          message: 'Factura no encontrada'
        });
      }
      
      res.status(200).json({
        success: true,
        data: resultado.datos
      });
      
    } catch (error) {
      console.error('Error en consultarFactura:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al consultar factura',
        error: error.message
      });
    }
  }

  /**
   * GET /api/ultimo-numero/:tipo/:puntoVenta?
   * Obtener el último número de comprobante
   */
  async obtenerUltimoNumero(req, res) {
    try {
      const { tipo, puntoVenta } = req.params;
      
      const ultimoNumero = await billingService.obtenerUltimoNumero(
        parseInt(tipo),
        puntoVenta ? parseInt(puntoVenta) : null
      );
      
      res.status(200).json({
        success: true,
        data: {
          ultimoNumero,
          siguienteNumero: ultimoNumero + 1
        }
      });
      
    } catch (error) {
      console.error('Error en obtenerUltimoNumero:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al obtener último número',
        error: error.message
      });
    }
  }

  /**
   * GET /api/tipos-comprobante
   * Obtener tipos de comprobantes disponibles
   */
  async obtenerTiposComprobante(req, res) {
    try {
      // Devolver los tipos desde la configuración local
      res.status(200).json({
        success: true,
        data: TIPOS_COMPROBANTE
      });
      
    } catch (error) {
      console.error('Error en obtenerTiposComprobante:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al obtener tipos de comprobante',
        error: error.message
      });
    }
  }

  /**
   * GET /api/alicuotas-iva
   * Obtener alícuotas de IVA disponibles
   */
  async obtenerAlicuotasIVA(req, res) {
    try {
      res.status(200).json({
        success: true,
        data: ALICUOTAS_IVA
      });
      
    } catch (error) {
      console.error('Error en obtenerAlicuotasIVA:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al obtener alícuotas de IVA',
        error: error.message
      });
    }
  }

  /**
   * GET /api/condiciones-iva
   * Obtener condiciones frente al IVA
   */
  async obtenerCondicionesIVA(req, res) {
    try {
      res.status(200).json({
        success: true,
        data: CONDICIONES_IVA
      });
      
    } catch (error) {
      console.error('Error en obtenerCondicionesIVA:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al obtener condiciones de IVA',
        error: error.message
      });
    }
  }

  /**
   * GET /api/tipos-documento
   * Obtener tipos de documentos
   */
  async obtenerTiposDocumento(req, res) {
    try {
      res.status(200).json({
        success: true,
        data: TIPOS_DOCUMENTO
      });
      
    } catch (error) {
      console.error('Error en obtenerTiposDocumento:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al obtener tipos de documento',
        error: error.message
      });
    }
  }

  /**
   * GET /api/health
   * Verificar salud del servicio
   */
  async verificarSalud(req, res) {
    try {
      const estado = await billingService.verificarSalud();
      
      const statusCode = estado.estado === 'OK' ? 200 : 503;
      
      res.status(statusCode).json({
        success: estado.estado === 'OK',
        data: estado
      });
      
    } catch (error) {
      console.error('Error en verificarSalud:', error);
      
      res.status(503).json({
        success: false,
        message: 'Servicio no disponible',
        error: error.message
      });
    }
  }

  /**
   * GET /api/puntos-venta
   * Obtener puntos de venta habilitados
   */
  async obtenerPuntosVenta(req, res) {
    try {
      const puntos = await afipService.obtenerPuntosVenta();
      
      res.status(200).json({
        success: true,
        data: puntos
      });
      
    } catch (error) {
      console.error('Error en obtenerPuntosVenta:', error);
      
      res.status(400).json({
        success: false,
        message: 'Error al obtener puntos de venta',
        error: error.message
      });
    }
  }

  /**
   * POST /api/consulta-contribuyente
   * Consulta datos del contribuyente en AFIP por DNI o CUIT (Padrón / Constancia).
   * Body: { dni?: string, cuit?: string } (uno de los dos).
   */
  async consultaContribuyente(req, res) {
    try {
      const { dni, cuit } = req.body || {};
      const cuitLimpio = cuit != null ? String(cuit).replace(/\D/g, '') : '';
      const dniLimpio = dni != null ? String(dni).replace(/\D/g, '') : '';

      if (cuitLimpio && dniLimpio) {
        return res.status(400).json({
          success: false,
          message: 'Envíe solo DNI o solo CUIT, no ambos.'
        });
      }
      if (!cuitLimpio && !dniLimpio) {
        return res.status(400).json({
          success: false,
          message: 'Debe enviar DNI (7 u 8 dígitos) o CUIT (11 dígitos).'
        });
      }

      if (cuitLimpio.length === 11) {
        const personaReturn = await afipService.getDatosConstancia(cuitLimpio);
        if (!personaReturn) {
          return res.status(404).json({
            success: false,
            message: 'No se encontró el contribuyente en AFIP con ese CUIT.'
          });
        }
        const data = afipService.mapConstanciaToCliente(personaReturn);
        return res.json({ success: true, data });
      }

      if (cuitLimpio.length > 0 && cuitLimpio.length !== 11) {
        return res.status(400).json({
          success: false,
          message: 'El CUIT debe tener 11 dígitos.'
        });
      }

      if (dniLimpio.length < 7 || dniLimpio.length > 8) {
        return res.status(400).json({
          success: false,
          message: 'El DNI debe tener 7 u 8 dígitos.'
        });
      }

      const cuitObtenido = await afipService.getCuitPorDni(dniLimpio);
      if (!cuitObtenido) {
        return res.json({
          success: true,
          data: {
            nombre: '',
            cuit: '',
            dni: dniLimpio,
            condicion_iva: 'Consumidor Final',
            direccion: '',
            ciudad: '',
            provincia: ''
          },
          message: 'No encontrado en padrón AFIP. Se puede guardar como Consumidor Final; complete el nombre.'
        });
      }

      const personaReturn = await afipService.getDatosConstancia(cuitObtenido);
      if (!personaReturn) {
        return res.json({
          success: true,
          data: {
            nombre: '',
            cuit: cuitObtenido.length === 11
              ? `${cuitObtenido.slice(0, 2)}-${cuitObtenido.slice(2, 10)}-${cuitObtenido.slice(10)}`
              : cuitObtenido,
            dni: dniLimpio,
            condicion_iva: 'Consumidor Final',
            direccion: '',
            ciudad: '',
            provincia: ''
          },
          message: 'CUIT encontrado pero sin datos de constancia. Complete los datos manualmente.'
        });
      }

      const data = afipService.mapConstanciaToCliente(personaReturn, dniLimpio);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Error consulta contribuyente AFIP:', error.message);
      const status = (error.status >= 400 && error.status < 600) ? error.status : 503;
      const message = error.data?.message || error.data?.error || error.message;
      res.status(status).json({
        success: false,
        message: message.includes('AFIP') || message.includes('timeout') ? message : `Error al consultar AFIP: ${message}`
      });
    }
  }

  /**
 * POST /api/notas-credito/tipo-a
 * Crear Nota de Crédito A (Responsable Inscripto/Monotributo)
 */
async crearNotaCreditoA(req, res) {
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { facturaAsociada, cuit, items, opciones } = req.body;
    
    // ✅ VALIDACIONES
    if (!facturaAsociada) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos de la factura asociada'
      });
    }
    
    if (!facturaAsociada.tipo || !facturaAsociada.puntoVenta || !facturaAsociada.numero) {
      return res.status(400).json({
        success: false,
        message: 'La factura asociada debe tener: tipo, puntoVenta y numero'
      });
    }
    
    if (!cuit) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar el CUIT del cliente'
      });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe incluir al menos un item'
      });
    }
    
    // ✅ CREAR NOTA DE CRÉDITO
    const resultado = await billingService.crearNotaCreditoA(
      facturaAsociada,
      cuit,
      items,
      opciones
    );
    
    res.status(201).json({
      success: true,
      message: 'Nota de Crédito A creada exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('Error en crearNotaCreditoA:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear Nota de Crédito A',
      error: error.message
    });
  }
}

/**
 * POST /api/notas-credito/tipo-b
 * Crear Nota de Crédito B (Consumidor Final/Exento)
 */
async crearNotaCreditoB(req, res) {
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { facturaAsociada, items, opciones } = req.body;
    
    // ✅ VALIDACIONES
    if (!facturaAsociada) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos de la factura asociada'
      });
    }
    
    if (!facturaAsociada.tipo || !facturaAsociada.puntoVenta || !facturaAsociada.numero) {
      return res.status(400).json({
        success: false,
        message: 'La factura asociada debe tener: tipo, puntoVenta y numero'
      });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe incluir al menos un item'
      });
    }
    
    // ✅ CREAR NOTA DE CRÉDITO
    const resultado = await billingService.crearNotaCreditoB(
      facturaAsociada,
      items,
      opciones
    );
    
    res.status(201).json({
      success: true,
      message: 'Nota de Crédito B creada exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('Error en crearNotaCreditoB:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear Nota de Crédito B',
      error: error.message
    });
  }
}

/**
 * POST /api/notas-credito
 * Crear Nota de Crédito (detecta automáticamente tipo A o B)
 */
async crearNotaCreditoGeneral(req, res) {
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { facturaAsociada, datosCliente, items, opciones } = req.body;
    
    // ✅ VALIDACIONES
    if (!facturaAsociada) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos de la factura asociada'
      });
    }
    
    if (!datosCliente) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos del cliente'
      });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe incluir al menos un item'
      });
    }
    
    // ✅ CREAR NOTA DE CRÉDITO
    const resultado = await billingService.crearNotaCredito(
      facturaAsociada,
      datosCliente,
      items,
      opciones
    );
    
    res.status(201).json({
      success: true,
      message: 'Nota de Crédito creada exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('Error en crearNotaCreditoGeneral:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear Nota de Crédito',
      error: error.message
    });
  }
}

/**
 * POST /api/notas-debito/tipo-a
 * Crear Nota de Débito A (Responsable Inscripto/Monotributo)
 */
async crearNotaDebitoA(req, res) {
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { facturaAsociada, cuit, items, opciones } = req.body;
    
    // ✅ VALIDACIONES
    if (!facturaAsociada) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos de la factura asociada'
      });
    }
    
    if (!facturaAsociada.tipo || !facturaAsociada.puntoVenta || !facturaAsociada.numero) {
      return res.status(400).json({
        success: false,
        message: 'La factura asociada debe tener: tipo, puntoVenta y numero'
      });
    }
    
    if (!cuit) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar el CUIT del cliente'
      });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe incluir al menos un item'
      });
    }
    
    // ✅ CREAR NOTA DE DÉBITO
    const resultado = await billingService.crearNotaDebitoA(
      facturaAsociada,
      cuit,
      items,
      opciones
    );
    
    res.status(201).json({
      success: true,
      message: 'Nota de Débito A creada exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('Error en crearNotaDebitoA:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear Nota de Débito A',
      error: error.message
    });
  }
}

/**
 * POST /api/notas-debito/tipo-b
 * Crear Nota de Débito B (Consumidor Final/Exento)
 */
async crearNotaDebitoB(req, res) {
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { facturaAsociada, items, opciones } = req.body;
    
    // ✅ VALIDACIONES
    if (!facturaAsociada) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos de la factura asociada'
      });
    }
    
    if (!facturaAsociada.tipo || !facturaAsociada.puntoVenta || !facturaAsociada.numero) {
      return res.status(400).json({
        success: false,
        message: 'La factura asociada debe tener: tipo, puntoVenta y numero'
      });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe incluir al menos un item'
      });
    }
    
    // ✅ CREAR NOTA DE DÉBITO
    const resultado = await billingService.crearNotaDebitoB(
      facturaAsociada,
      items,
      opciones
    );
    
    res.status(201).json({
      success: true,
      message: 'Nota de Débito B creada exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('Error en crearNotaDebitoB:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear Nota de Débito B',
      error: error.message
    });
  }
}

/**
 * POST /api/notas-debito
 * Crear Nota de Débito (detecta automáticamente tipo A o B)
 */
async crearNotaDebitoGeneral(req, res) {
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  
  try {
    const { facturaAsociada, datosCliente, items, opciones } = req.body;
    
    // ✅ VALIDACIONES
    if (!facturaAsociada) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos de la factura asociada'
      });
    }
    
    if (!datosCliente) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar los datos del cliente'
      });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe incluir al menos un item'
      });
    }
    
    // ✅ CREAR NOTA DE DÉBITO
    const resultado = await billingService.crearNotaDebito(
      facturaAsociada,
      datosCliente,
      items,
      opciones
    );
    
    res.status(201).json({
      success: true,
      message: 'Nota de Débito creada exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('Error en crearNotaDebitoGeneral:', error);
    
    res.status(400).json({
      success: false,
      message: 'Error al crear Nota de Débito',
      error: error.message
    });
  }
}



}





// Exportar instancia única
const billingController = new BillingController();
export default billingController;