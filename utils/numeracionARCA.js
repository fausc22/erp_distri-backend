/**
 * UTILIDADES PARA NUMERACIÓN DE FACTURAS CON ARCA
 * 
 * ARCA es la fuente de verdad para la numeración.
 * Esta función consulta ARCA y sincroniza la tabla local.
 */

const dotenv = require('dotenv');
dotenv.config();

// Mapeo de tipos fiscales a códigos ARCA
const MAPEO_TIPOS_COMPROBANTE = {
  'A': 1,  // Factura A
  'B': 6,  // Factura B
  'C': 11  // Factura C
};

// Mapeo inverso (código ARCA → tipo fiscal)
const MAPEO_INVERSO = {
  1: 'A',
  6: 'B',
  11: 'C'
};

/**
 * Obtener siguiente número de factura desde ARCA
 * ARCA es la fuente de verdad - consulta siempre el último autorizado
 * 
 * @param {Object} connection - Conexión a la base de datos
 * @param {string} tipoFiscal - 'A', 'B' o 'C'
 * @param {number|null} puntoVenta - Punto de venta (opcional)
 * @returns {Promise<Object>} { numeroFactura, numeroCompleto, puntoVenta, tipoComprobanteARCA }
 */
const obtenerSiguienteNumeroFacturaDesdeARCA = async (connection, tipoFiscal, puntoVenta = null) => {
  try {
    // Importar dinámicamente el servicio ARCA (ESM)
    const afipServiceModule = await import('../arca-microservice/services/afip.service.js');
    const afipService = afipServiceModule.default;
    
    const pv = puntoVenta || parseInt(process.env.DEFAULT_PUNTO_VENTA) || 1;
    const puntoVentaFormateado = String(pv).padStart(4, '0');
    const puntoVentaNumerico = parseInt(pv);
    
    // Mapear tipo fiscal a código ARCA
    const tipoComprobanteARCA = MAPEO_TIPOS_COMPROBANTE[tipoFiscal];
    if (!tipoComprobanteARCA) {
      throw new Error(`Tipo fiscal inválido: ${tipoFiscal}. Debe ser 'A', 'B' o 'C'`);
    }
    
    console.log(`\n🔢 [ARCA] Obteniendo número desde ARCA para Factura ${tipoFiscal}`);
    console.log(`   Punto de Venta: ${puntoVentaFormateado} (${puntoVentaNumerico})`);
    console.log(`   Tipo ARCA: ${tipoComprobanteARCA}`);
    
    // ✅ 1. CONSULTAR ARCA (FUENTE DE VERDAD)
    console.log('📡 Consultando último comprobante autorizado en ARCA...');
    const ultimoNumeroARCA = await afipService.obtenerUltimoComprobante(
      puntoVentaNumerico,
      tipoComprobanteARCA
    );
    
    const siguienteNumero = ultimoNumeroARCA + 1;
    
    console.log(`✅ ARCA - Último autorizado: ${ultimoNumeroARCA}`);
    console.log(`✅ ARCA - Siguiente número: ${siguienteNumero}`);
    
    // ✅ 2. SINCRONIZAR TABLA LOCAL (solo para registro, no para control)
    // Actualizar o crear registro en control_numeracion_facturas
    const checkQuery = `
      SELECT ultimo_numero 
      FROM control_numeracion_facturas 
      WHERE punto_venta = ? AND tipo_factura = ?
    `;
    
    const queryPromiseWithConnection = (connection, query, params) => {
      return new Promise((resolve, reject) => {
        connection.query(query, params, (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });
    };
    
    const checkResults = await queryPromiseWithConnection(
      connection, 
      checkQuery, 
      [puntoVentaFormateado, tipoFiscal]
    );
    
    // Si no existe, crearlo con el número de ARCA
    if (!checkResults || checkResults.length === 0) {
      console.log(`📝 Creando registro en control_numeracion_facturas...`);
      const insertQuery = `
        INSERT INTO control_numeracion_facturas (punto_venta, tipo_factura, ultimo_numero)
        VALUES (?, ?, ?)
      `;
      await queryPromiseWithConnection(
        connection, 
        insertQuery, 
        [puntoVentaFormateado, tipoFiscal, ultimoNumeroARCA]
      );
      console.log(`✅ Registro creado con último número: ${ultimoNumeroARCA}`);
    } else {
      // Sincronizar si hay diferencia (ARCA es la verdad)
      const numeroLocal = checkResults[0].ultimo_numero;
      if (numeroLocal !== ultimoNumeroARCA) {
        console.log(`⚠️  Desincronización detectada:`);
        console.log(`   Local: ${numeroLocal}`);
        console.log(`   ARCA: ${ultimoNumeroARCA}`);
        console.log(`   Sincronizando con ARCA (fuente de verdad)...`);
        
        const updateQuery = `
          UPDATE control_numeracion_facturas 
          SET ultimo_numero = ?
          WHERE punto_venta = ? AND tipo_factura = ?
        `;
        await queryPromiseWithConnection(
          connection, 
          updateQuery, 
          [ultimoNumeroARCA, puntoVentaFormateado, tipoFiscal]
        );
        console.log(`✅ Tabla local sincronizada con ARCA`);
      }
    }
    
    // ✅ 3. FORMATEAR NÚMERO COMPLETO
    const numeroCompleto = `${tipoFiscal} ${puntoVentaFormateado}-${String(siguienteNumero).padStart(8, '0')}`;
    
    console.log(`✅ Número asignado desde ARCA: ${numeroCompleto}`);
    
    return {
      numeroFactura: siguienteNumero,
      numeroCompleto,
      puntoVenta: puntoVentaFormateado,
      puntoVentaNumerico: puntoVentaNumerico,
      tipoComprobanteARCA,
      ultimoNumeroARCA
    };
    
  } catch (error) {
    console.error('❌ Error obteniendo número desde ARCA:', error);
    throw error;
  }
};

/**
 * Sincronizar tabla local después de aprobar CAE
 * Actualiza el último número en la tabla local con el número aprobado por ARCA
 * 
 * @param {Object} connection - Conexión a la base de datos
 * @param {string} tipoFiscal - 'A', 'B' o 'C'
 * @param {number} numeroAprobado - Número que fue aprobado por ARCA
 * @param {number|null} puntoVenta - Punto de venta
 */
const sincronizarNumeroAprobado = async (connection, tipoFiscal, numeroAprobado, puntoVenta = null) => {
  try {
    const pv = puntoVenta || parseInt(process.env.DEFAULT_PUNTO_VENTA) || 1;
    const puntoVentaFormateado = String(pv).padStart(4, '0');
    
    const queryPromiseWithConnection = (connection, query, params) => {
      return new Promise((resolve, reject) => {
        connection.query(query, params, (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });
    };
    
    const updateQuery = `
      UPDATE control_numeracion_facturas 
      SET ultimo_numero = ?
      WHERE punto_venta = ? AND tipo_factura = ?
    `;
    
    await queryPromiseWithConnection(
      connection, 
      updateQuery, 
      [numeroAprobado, puntoVentaFormateado, tipoFiscal]
    );
    
    console.log(`✅ Tabla local sincronizada: ${tipoFiscal} ${puntoVentaFormateado}-${String(numeroAprobado).padStart(8, '0')}`);
    
  } catch (error) {
    console.error('⚠️  Error sincronizando número aprobado (no crítico):', error);
    // No lanzar error, es solo para sincronización
  }
};

module.exports = {
  obtenerSiguienteNumeroFacturaDesdeARCA,
  sincronizarNumeroAprobado,
  MAPEO_TIPOS_COMPROBANTE,
  MAPEO_INVERSO
};

