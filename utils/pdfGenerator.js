const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');   

// URL del microservicio ARCA (desde .env)
const ARCA_MICROSERVICE_URL = process.env.ARCA_MICROSERVICE_URL;

class PdfGenerator {
    constructor() {
        this.templatesPath = path.join(__dirname, '../resources/documents');
    }

    formatearFecha(fechaBD) {
        if (!fechaBD) return 'Fecha no disponible';

        try {
            const fecha = new Date(fechaBD);
            if (isNaN(fecha.getTime())) {
                console.warn('Fecha inválida recibida:', fechaBD);
                return 'Fecha inválida';
            }

            const opciones = {
                timeZone: 'America/Argentina/Buenos_Aires',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            };

            return fecha.toLocaleDateString('es-AR', opciones);
        } catch (error) {
            console.error('Error formateando fecha:', error);
            return 'Error en fecha';
        }
    }

    // ✅ NUEVA FUNCIÓN: Formatear cantidades (elimina decimales innecesarios)
    formatearCantidad(cantidad) {
        const num = parseFloat(cantidad);
        if (isNaN(num)) return '0';
        
        // Si es entero, mostrar sin decimales
        if (num % 1 === 0) {
            return num.toFixed(0);
        }
        
        // Si tiene decimales, mostrar con hasta 2 decimales (elimina ceros finales)
        return parseFloat(num.toFixed(2)).toString();
    }

    getOptions(customOptions = {}) {
        const isProduction = process.env.NODE_ENV === 'production';
        const isMac = process.platform === 'darwin';
        const isLinux = process.platform === 'linux';
        
        const baseOptions = {
            format: 'A4',
            printBackground: true,
            margin: {
                top: '8mm',
                right: '6mm',
                bottom: '8mm',
                left: '6mm'
            },
            timeout: 30000
        };

        // ✅ CONFIGURACIÓN ESPECÍFICA PARA MACOS
        if (isMac) {
            const possibleChromePaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                process.env.CHROME_PATH // Variable de entorno personalizada
            ].filter(Boolean);

            // Buscar Chrome instalado
            const fs = require('fs');
            let executablePath = null;
            
            for (const path of possibleChromePaths) {
                if (fs.existsSync(path)) {
                    executablePath = path;
                    console.log(`✅ Chrome encontrado en: ${path}`);
                    break;
                }
            }

            if (!executablePath) {
                console.warn('⚠️  No se encontró Chrome en rutas comunes de macOS');
                console.warn('   Instala Chrome desde: https://www.google.com/chrome/');
                console.warn('   O instala Chromium con: brew install --cask chromium');
            }

            return {
                ...baseOptions,
                executablePath,
                args: [
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ],
                ...customOptions
            };
        }

        // ✅ CONFIGURACIÓN PARA LINUX/VPS
        if (isLinux && isProduction) {
            return {
                ...baseOptions,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-web-security'
                ],
                ...customOptions
            };
        }

        // ✅ CONFIGURACIÓN POR DEFECTO (Windows, Linux dev)
        return {
            ...baseOptions,
            args: [
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--no-sandbox'
            ],
            ...customOptions
        };
    }

    async generatePdfFromHtml(htmlContent, options = {}) {
        let browser = null;
        try {
            const environment = process.env.NODE_ENV === 'production' ? 'PRODUCCIÓN' : 'DESARROLLO';
            console.log(`🔧 Generando PDF con Puppeteer (${environment})...`);
            
            const pdfOptions = this.getOptions(options);
            
            // Configurar Puppeteer
            const launchOptions = {
                headless: 'new',
                args: pdfOptions.args || [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            };

            // Usar Chrome del sistema si está disponible (macOS)
            if (pdfOptions.executablePath && fs.existsSync(pdfOptions.executablePath)) {
                launchOptions.executablePath = pdfOptions.executablePath;
                console.log(`✅ Usando Chrome del sistema: ${pdfOptions.executablePath}`);
            }
            
            // Lanzar navegador
            browser = await puppeteer.launch(launchOptions);
            const page = await browser.newPage();
            
            // Configurar contenido HTML
            await page.setContent(htmlContent, {
                waitUntil: 'networkidle0',
                timeout: pdfOptions.timeout || 30000
            });
            
            // Generar PDF
            const pdfBuffer = await page.pdf({
                format: pdfOptions.format || 'A4',
                printBackground: pdfOptions.printBackground !== false,
                margin: pdfOptions.margin || {
                    top: '8mm',
                    right: '6mm',
                    bottom: '8mm',
                    left: '6mm'
                }
            });
            
            await browser.close();
            browser = null;
            
            console.log(`✅ PDF generado exitosamente - Tamaño: ${pdfBuffer.length} bytes`);
            return pdfBuffer;
            
        } catch (error) {
            console.error('❌ Error generando PDF:', error.message);
            
            // Cerrar navegador si quedó abierto
            if (browser) {
                try {
                    await browser.close();
                } catch (e) {
                    // Ignorar errores al cerrar
                }
            }
            
            throw error;
        }
    }

    obtenerLogoARCABase64() {
        try {
            const logoPath = path.join(this.templatesPath, 'logo_arca.jpg');
            console.log('📁 Buscando logo ARCA en:', logoPath);
            
            if (fs.existsSync(logoPath)) {
                const logoBuffer = fs.readFileSync(logoPath);
                const base64Logo = logoBuffer.toString('base64');
                console.log('✅ Logo ARCA cargado desde archivo');
                return `data:image/jpeg;base64,${base64Logo}`;
            }
        } catch (error) {
            console.error('❌ Error cargando logo ARCA:', error);
        }
    }

    async generarQRDesdeARCA(venta) {
        try {
            console.log(`🔍 Generando QR según especificaciones ARCA para venta ${venta.id}...`);
            
            // ✅ MAPEO DE TIPOS DE COMPROBANTE SEGÚN ARCA
            const tipoComprobanteMap = { 
                'A': 1,   // Factura A
                'B': 6,   // Factura B
                'C': 11   // Factura C
            };
            const tipoComprobante = tipoComprobanteMap[venta.tipo_f] || 6;
            
            // ✅ TIPO DE DOCUMENTO RECEPTOR
            let tipoDocReceptor = 99; // Por defecto: Sin identificar
            let nroDocReceptor = 0;
            
            if (venta.cliente_cuit) {
                const cuitLimpio = venta.cliente_cuit.replace(/[^0-9]/g, '');
                if (cuitLimpio.length === 11) {
                    tipoDocReceptor = 80; // CUIT
                    nroDocReceptor = parseInt(cuitLimpio);
                } else if (cuitLimpio.length >= 7 && cuitLimpio.length <= 8) {
                    tipoDocReceptor = 96; // DNI
                    nroDocReceptor = parseInt(cuitLimpio);
                }
            }

            // ✅ FORMATEAR FECHA SEGÚN RFC3339 (YYYY-MM-DD)
            const fechaEmision = new Date(venta.fecha);
            const fechaFormateada = fechaEmision.toISOString().split('T')[0]; // "2025-01-15"

            // ✅ VALIDAR CAE
            const cae = venta.cae_id;
            if (!cae) {
                console.warn('⚠️ Venta sin CAE, no se puede generar QR válido');
                return this.generarQRPlaceholder();
            }

            // ✅ CONSTRUIR JSON SEGÚN ESPECIFICACIÓN ARCA v1
            const datosQR = {
                ver: 1,                                          // Versión del formato
                fecha: fechaFormateada,                          // Fecha emisión (YYYY-MM-DD)
                cuit: parseInt(process.env.AFIP_CUIT || '30714525030'), // CUIT emisor (sin guiones)
                ptoVta: 1,                                       // Punto de venta
                tipoCmp: tipoComprobante,                        // Tipo comprobante
                nroCmp: parseInt(venta.id),                      // Número de comprobante
                importe: parseFloat(venta.total),                // Importe total
                moneda: "PES",                                   // Moneda (PES = Pesos)
                ctz: 1,                                          // Cotización (1 para pesos)
                tipoDocRec: tipoDocReceptor,                     // Tipo doc receptor
                nroDocRec: nroDocReceptor,                       // Nro doc receptor
                tipoCodAut: "E",                                 // Tipo autorización (E = CAE)
                codAut: parseInt(cae)                            // CAE
            };

            console.log('📋 Datos QR construidos:', JSON.stringify(datosQR, null, 2));

            // ✅ SOLICITAR QR AL MICROSERVICIO
            const response = await axios.post(
                `${ARCA_MICROSERVICE_URL}/api/arca/generar-qr`, 
                datosQR,
                { timeout: 5000 }
            );

            if (response.data && response.data.qrBase64) {
                console.log('✅ QR obtenido del microservicio ARCA correctamente');
                console.log('🔗 URL del QR:', response.data.qrUrl);
                return response.data.qrBase64;
            }

            throw new Error('No se recibió QR del microservicio');
            
        } catch (error) {
            console.error('❌ Error generando QR desde ARCA:', error.message);
            if (error.response) {
                console.error('📋 Respuesta del servidor:', error.response.data);
            }
            
            // ✅ GENERAR QR LOCAL SI FALLA EL MICROSERVICIO
            console.log('🔄 Intentando generar QR localmente...');
            return await this.generarQRLocal(venta);
        }
    }

    // ✅ FUNCIÓN DE RESPALDO: GENERAR QR LOCALMENTE
    async generarQRLocal(venta) {
        try {
            console.log('⚠️ Generando QR localmente (fallback)...');
            
            const QRCode = require('qrcode');
            
            // ✅ CONSTRUIR DATOS SEGÚN ESPECIFICACIÓN ARCA
            const tipoComprobanteMap = { 'A': 1, 'B': 6, 'C': 11 };
            const tipoComprobante = tipoComprobanteMap[venta.tipo_f] || 6;
            
            let tipoDocReceptor = 99;
            let nroDocReceptor = 0;
            
            if (venta.cliente_cuit) {
                const cuitLimpio = venta.cliente_cuit.replace(/[^0-9]/g, '');
                if (cuitLimpio.length === 11) {
                    tipoDocReceptor = 80;
                    nroDocReceptor = parseInt(cuitLimpio);
                } else if (cuitLimpio.length >= 7 && cuitLimpio.length <= 8) {
                    tipoDocReceptor = 96;
                    nroDocReceptor = parseInt(cuitLimpio);
                }
            }

            const fechaEmision = new Date(venta.fecha);
            const fechaFormateada = fechaEmision.toISOString().split('T')[0];

            // ✅ VALIDAR CAE
            if (!venta.cae_id) {
                console.warn('⚠️ No hay CAE, usando QR placeholder');
                return this.generarQRPlaceholder();
            }

            // ✅ JSON CON DATOS DEL COMPROBANTE
            const datosComprobante = {
                ver: 1,
                fecha: fechaFormateada,
                cuit: parseInt(process.env.AFIP_CUIT || '30714525030'),
                ptoVta: 1,
                tipoCmp: tipoComprobante,
                nroCmp: parseInt(venta.id),
                importe: parseFloat(venta.total),
                moneda: "PES",
                ctz: 1,
                tipoDocRec: tipoDocReceptor,
                nroDocRec: nroDocReceptor,
                tipoCodAut: "E",
                codAut: parseInt(venta.cae_id)
            };

            // ✅ CODIFICAR EN BASE64
            const jsonString = JSON.stringify(datosComprobante);
            const base64Data = Buffer.from(jsonString, 'utf8').toString('base64');
            
            // ✅ CONSTRUIR URL SEGÚN ESPECIFICACIÓN ARCA
            const qrUrl = `https://www.arca.gob.ar/fe/qr/?p=${base64Data}`;
            
            console.log('📋 URL del QR:', qrUrl);
            console.log('📋 JSON QR:', jsonString);
            
            // ✅ GENERAR QR
            const qrDataURL = await QRCode.toDataURL(qrUrl, {
                errorCorrectionLevel: 'M',
                type: 'image/png',
                width: 200,
                margin: 1
            });
            
            console.log('✅ QR generado localmente correctamente');
            return qrDataURL;
            
        } catch (error) {
            console.error('❌ Error generando QR local:', error);
            return this.generarQRPlaceholder();
        }
    }



    async generarFactura(venta, productos) {
    const tipoFiscal = (venta.tipo_f || '').toString().trim().toUpperCase();
    const condicionIVA = (venta.cliente_condicion || '').toString().trim();
    
    console.log(`📋 Generando factura tipo ${tipoFiscal} para ${condicionIVA}`);
    
    // ✅ Facturas A o B → ARCA con CAE
    if (tipoFiscal === 'A' || tipoFiscal === 'B') {
      const tieneCAEAprobado = venta.cae_id && 
                                venta.cae_resultado && 
                                venta.cae_resultado.toString().trim().toUpperCase() === 'A';

      if (tieneCAEAprobado) {
        console.log(`📋 Generando Factura ARCA tipo ${tipoFiscal} con CAE:`, venta.cae_id);
        return await this.generarFacturaARCA(venta, productos);
      } else {
        console.warn(`⚠️ Factura tipo ${tipoFiscal} sin CAE aprobado, usando genérica`);
        return await this.generarFacturaGenerica(venta, productos);
      }
    } else {
      // ✅ Facturas C o cualquier otro tipo → Genérica
      console.log(`📋 Generando Factura Genérica tipo ${tipoFiscal}`);
      return await this.generarFacturaGenerica(venta, productos);
    }
  }

    /**
   * ✅ GENERAR FACTURA ARCA (A y B) 
   * Maneja: Responsable Inscripto, Monotributo, Consumidor Final, Exento
   */
  async generarFacturaARCA(venta, productos) {
    const templatePath = path.join(this.templatesPath, 'factura_arca.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla factura_arca.html no encontrada');
    }

    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    console.log('📱 Generando QR...');
    const qrBase64 = await this.generarQRDesdeARCA(venta);
    const logoARCABase64 = this.obtenerLogoARCABase64();
    
    const tipoComprobante = venta.tipo_f;
    const fechaFormateada = this.formatearFecha(venta.fecha);
    const fechaVencimientoCAE = this.formatearFecha(venta.cae_fecha);
    
    // ✅ DESGLOSAR NÚMERO DE FACTURA: "A 0004-00000001"
    let puntoVenta = '';
    let numeroComprobante = '';
    
    if (venta.numero_factura) {
        const regex = /^([A-Z]+)\s+(\d{4})-(\d{8})$/;
        const match = venta.numero_factura.trim().match(regex);
        
        if (match) {
            puntoVenta = match[2];           // "0004"
            numeroComprobante = match[3];     // "00000001"
            console.log(`📋 Número desglosado: PV=${puntoVenta}, Comp=${numeroComprobante}`);
        } else {
            console.warn(`⚠️ Formato de numero_factura inesperado: ${venta.numero_factura}, usando valores por defecto`);
        }
    } else {
        console.warn(`⚠️ numero_factura no disponible, usando ID de venta: ${venta.id}`);
    }
    
    // ✅ Determinar si el cliente está EXENTO
    const condicionIVA = (venta.cliente_condicion || '').toString().trim();
    const esExento = condicionIVA === 'Exento';
    
    console.log(`🔖 Cliente ${condicionIVA} ${esExento ? '(SIN IVA)' : '(CON IVA)'}`);
    
    // ✅ MANEJO CONDICIONAL DE OBSERVACIONES
    let observacionesHTML = '';
    const observaciones = (venta.observaciones || '').toString().trim();
    
    if (observaciones && observaciones.toLowerCase() !== 'sin observaciones') {
        observacionesHTML = `
            <p><strong>OBSERVACIONES:</strong></p>
            <p>${observaciones}</p>
        `;
        console.log('📝 Observaciones incluidas en la factura');
    } else {
        console.log('📝 Sin observaciones para mostrar');
    }
    
    // Reemplazar datos generales
    htmlTemplate = htmlTemplate
      .replace(/{{tipo_comprobante}}/g, tipoComprobante)
      .replace(/{{punto_venta}}/g, puntoVenta)              // ✅ CAMBIADO
      .replace(/{{numero_comprobante}}/g, numeroComprobante) // ✅ CAMBIADO
      .replace(/{{fecha}}/g, fechaFormateada)
      .replace(/{{cuit_emisor}}/g, process.env.AFIP_CUIT || '30714525030')
      .replace(/{{ingresos_brutos}}/g, process.env.IIBB || '251491/4')
      .replace(/{{fecha_inicio_actividades}}/g, process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016')
      .replace(/{{telefono}}/g, process.env.EMPRESA_TELEFONO || '')
      .replace(/{{email}}/g, process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com')
      .replace(/{{cliente_cuit}}/g, venta.cliente_cuit || 'No informado')
      .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
      .replace(/{{cliente_condicion}}/g, venta.cliente_condicion || 'No informado')
      .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado')
      .replace(/{{observaciones_html}}/g, observacionesHTML);

    // ✅ DETECTAR SI HAY DESCUENTOS EN ALGÚN PRODUCTO
    const hayDescuentos = productos.some(p => parseFloat(p.descuento_porcentaje || 0) > 0);
    
    // ✅ ITEMS - Mostrar precios según si es EXENTO o no, con descuentos si corresponde
    const itemsHTML = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const descuento = parseFloat(producto.descuento_porcentaje || 0);
      const cantidadFormateada = this.formatearCantidad(cantidad);
      
      // Calcular precios: el subtotal YA tiene el descuento aplicado
      const precioConDescuentoSinIva = cantidad > 0 ? (subtotal / cantidad) : 0;
      
      // Calcular precio ORIGINAL (antes del descuento)
      const precioOriginalSinIva = descuento > 0 
        ? precioConDescuentoSinIva / (1 - descuento / 100)
        : precioConDescuentoSinIva;

      // Si hay descuentos en la factura, agregar columnas de precio original y descuento
      if (hayDescuentos) {
        return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: center;">${esExento ? '0.00' : '21.00'}</td>
          <td style="text-align: right;">${precioOriginalSinIva.toFixed(2)}</td>
          <td style="text-align: center;">${descuento.toFixed(0)}%</td>
          <td style="text-align: right;">${precioConDescuentoSinIva.toFixed(2)}</td>
          <td style="text-align: right;">${subtotal.toFixed(2)}</td>
        </tr>
      `;
      } else {
        // Layout sin descuentos (mantener original)
        return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: center;">${esExento ? '0.00' : '21.00'}</td>
          <td style="text-align: right;">${precioConDescuentoSinIva.toFixed(2)}</td>
          <td style="text-align: right;">${subtotal.toFixed(2)}</td>
        </tr>
      `;
      }
    }).join('');

    // ✅ REEMPLAZAR HEADER DE LA TABLA SEGÚN SI HAY DESCUENTOS
    const tableHeader = hayDescuentos ? `
                <thead>
                    <tr>
                        <th style="width: 7%;">Cant.</th>
                        <th style="width: 28%;">Producto/Servicio/Detalle</th>
                        <th style="width: 7%;">IVA</th>
                        <th style="width: 12%;">P. Original</th>
                        <th style="width: 7%;">Desc.</th>
                        <th style="width: 12%;">P. Final</th>
                        <th style="width: 12%;">Total</th>
                    </tr>
                </thead>
    ` : `
                <thead>
                    <tr>
                        <th style="width: 8%;">Cantidad</th>
                        <th style="width: 40%;">Producto/Servicio/Detalle</th>
                        <th style="width: 10%;">% IVA</th>
                        <th style="width: 15%;">Precio</th>
                        <th style="width: 15%;">Total</th>
                    </tr>
                </thead>
    `;

    htmlTemplate = htmlTemplate
      .replace(/<thead>[\s\S]*?<\/thead>/m, tableHeader)
      .replace(/{{items}}/g, itemsHTML);

    // ✅ TOTALES
    const subtotal = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    
    let ivaTotal = 0;
    let total = subtotal;
    
    if (!esExento) {
      ivaTotal = subtotal * 0.21;
      total = subtotal + ivaTotal;
    }

    htmlTemplate = htmlTemplate
      .replace(/{{subtotal}}/g, subtotal.toFixed(2))
      .replace(/{{iva_total}}/g, ivaTotal.toFixed(2))
      .replace(/{{total}}/g, total.toFixed(2))
      .replace(/{{qr_base64}}/g, qrBase64)
      .replace(/{{logo_arca}}/g, logoARCABase64)
      .replace(/{{cae}}/g, venta.cae_id)
      .replace(/{{cae_vencimiento}}/g, fechaVencimientoCAE);
    
    console.log('📄 Generando PDF de Factura ARCA...');
    console.log(`   Subtotal: $${subtotal.toFixed(2)}`);
    console.log(`   IVA 21%: $${ivaTotal.toFixed(2)} ${esExento ? '(EXENTO)' : ''}`);
    console.log(`   Total: $${total.toFixed(2)}`);
    
    return await this.generatePdfFromHtml(htmlTemplate);
  }

  /**
   * ✅ GENERAR NOTA DE CRÉDITO ARCA (A y B)
   * Maneja: Responsable Inscripto, Monotributo, Consumidor Final, Exento
   */
  async generarNotaCreditoARCA(nota, productos, facturaAsociada) {
    const templatePath = path.join(this.templatesPath, 'nota_credito_arca.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla nota_credito_arca.html no encontrada');
    }

    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    console.log('📱 Generando QR para Nota de Crédito...');
    const qrBase64 = await this.generarQRDesdeARCA(nota);
    const logoARCABase64 = this.obtenerLogoARCABase64();
    
    const tipoComprobante = nota.tipo_f || 'NC';
    const fechaFormateada = this.formatearFecha(nota.fecha);
    const fechaVencimientoCAE = this.formatearFecha(nota.cae_fecha);
    
    // ✅ DESGLOSAR NÚMERO DE NOTA
    let puntoVenta = '';
    let numeroComprobante = '';
    
    if (nota.numero_factura) {
        const regex = /^([A-Z]+)\s+(\d{4})-(\d{8})$/;
        const match = nota.numero_factura.trim().match(regex);
        
        if (match) {
            puntoVenta = match[2];
            numeroComprobante = match[3];
            console.log(`📋 Número desglosado: PV=${puntoVenta}, Comp=${numeroComprobante}`);
        }
    }
    
    // ✅ Determinar si el cliente está EXENTO
    const condicionIVA = (nota.cliente_condicion || '').toString().trim();
    const esExento = condicionIVA === 'Exento';
    
    // ✅ MANEJO DE OBSERVACIONES
    let observacionesHTML = '';
    const observaciones = (nota.observaciones || '').toString().trim();
    
    if (observaciones && observaciones.toLowerCase() !== 'sin observaciones') {
        observacionesHTML = `
            <p><strong>OBSERVACIONES:</strong></p>
            <p>${observaciones}</p>
        `;
    }
    
    // ✅ INFORMACIÓN DE FACTURA ASOCIADA
    let facturaAsociadaTipo = facturaAsociada?.tipo || 'N/A';
    let facturaAsociadaPV = facturaAsociada?.puntoVenta || 'N/A';
    let facturaAsociadaNum = facturaAsociada?.numero || 'N/A';
    let facturaAsociadaFecha = facturaAsociada?.fecha ? this.formatearFecha(facturaAsociada.fecha) : '';
    
    // Reemplazar datos generales
    htmlTemplate = htmlTemplate
      .replace(/{{tipo_comprobante}}/g, tipoComprobante)
      .replace(/{{punto_venta}}/g, puntoVenta)
      .replace(/{{numero_comprobante}}/g, numeroComprobante)
      .replace(/{{fecha}}/g, fechaFormateada)
      .replace(/{{cuit_emisor}}/g, process.env.AFIP_CUIT || '30714525030')
      .replace(/{{ingresos_brutos}}/g, process.env.IIBB || '251491/4')
      .replace(/{{fecha_inicio_actividades}}/g, process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016')
      .replace(/{{telefono}}/g, process.env.EMPRESA_TELEFONO || '')
      .replace(/{{email}}/g, process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com')
      .replace(/{{cliente_cuit}}/g, nota.cliente_cuit || 'No informado')
      .replace(/{{cliente_nombre}}/g, nota.cliente_nombre || 'No informado')
      .replace(/{{cliente_condicion}}/g, nota.cliente_condicion || 'No informado')
      .replace(/{{cliente_direccion}}/g, nota.cliente_direccion || 'No informado')
      .replace(/{{observaciones_html}}/g, observacionesHTML)
      .replace(/{{factura_asociada_tipo}}/g, facturaAsociadaTipo)
      .replace(/{{factura_asociada_punto_venta}}/g, facturaAsociadaPV)
      .replace(/{{factura_asociada_numero}}/g, facturaAsociadaNum)
      .replace(/{{factura_asociada_fecha}}/g, facturaAsociadaFecha);

    // ✅ ITEMS
    const itemsHTML = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const cantidadFormateada = this.formatearCantidad(cantidad);
      const precioUnitario = cantidad > 0 ? (subtotal / cantidad) : 0;
      
      return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre || producto.descripcion || 'Item'} - ${producto.producto_um || ''}</td>
          <td style="text-align: center;">${esExento ? '0.00' : '21.00'}</td>
          <td style="text-align: right;">${precioUnitario.toFixed(2)}</td>
          <td style="text-align: right;">${subtotal.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

    // ✅ TOTALES
    const subtotal = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    let ivaTotal = 0;
    let total = subtotal;
    
    if (!esExento) {
      ivaTotal = subtotal * 0.21;
      total = subtotal + ivaTotal;
    }

    htmlTemplate = htmlTemplate
      .replace(/{{subtotal}}/g, subtotal.toFixed(2))
      .replace(/{{iva_total}}/g, ivaTotal.toFixed(2))
      .replace(/{{total}}/g, total.toFixed(2))
      .replace(/{{qr_base64}}/g, qrBase64)
      .replace(/{{logo_arca}}/g, logoARCABase64)
      .replace(/{{cae}}/g, nota.cae_id)
      .replace(/{{cae_vencimiento}}/g, fechaVencimientoCAE);
    
    console.log('📄 Generando PDF de Nota de Crédito ARCA...');
    
    return await this.generatePdfFromHtml(htmlTemplate);
  }

  /**
   * ✅ GENERAR NOTA DE DÉBITO ARCA (A y B)
   * Maneja: Responsable Inscripto, Monotributo, Consumidor Final, Exento
   */
  async generarNotaDebitoARCA(nota, productos, facturaAsociada) {
    const templatePath = path.join(this.templatesPath, 'nota_debito_arca.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla nota_debito_arca.html no encontrada');
    }

    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    console.log('📱 Generando QR para Nota de Débito...');
    const qrBase64 = await this.generarQRDesdeARCA(nota);
    const logoARCABase64 = this.obtenerLogoARCABase64();
    
    const tipoComprobante = nota.tipo_f || 'ND';
    const fechaFormateada = this.formatearFecha(nota.fecha);
    const fechaVencimientoCAE = this.formatearFecha(nota.cae_fecha);
    
    // ✅ DESGLOSAR NÚMERO DE NOTA
    let puntoVenta = '';
    let numeroComprobante = '';
    
    if (nota.numero_factura) {
        const regex = /^([A-Z]+)\s+(\d{4})-(\d{8})$/;
        const match = nota.numero_factura.trim().match(regex);
        
        if (match) {
            puntoVenta = match[2];
            numeroComprobante = match[3];
            console.log(`📋 Número desglosado: PV=${puntoVenta}, Comp=${numeroComprobante}`);
        }
    }
    
    // ✅ Determinar si el cliente está EXENTO
    const condicionIVA = (nota.cliente_condicion || '').toString().trim();
    const esExento = condicionIVA === 'Exento';
    
    // ✅ MANEJO DE OBSERVACIONES
    let observacionesHTML = '';
    const observaciones = (nota.observaciones || '').toString().trim();
    
    if (observaciones && observaciones.toLowerCase() !== 'sin observaciones') {
        observacionesHTML = `
            <p><strong>OBSERVACIONES:</strong></p>
            <p>${observaciones}</p>
        `;
    }
    
    // ✅ INFORMACIÓN DE FACTURA ASOCIADA
    let facturaAsociadaTipo = facturaAsociada?.tipo || 'N/A';
    let facturaAsociadaPV = facturaAsociada?.puntoVenta || 'N/A';
    let facturaAsociadaNum = facturaAsociada?.numero || 'N/A';
    let facturaAsociadaFecha = facturaAsociada?.fecha ? this.formatearFecha(facturaAsociada.fecha) : '';
    
    // Reemplazar datos generales
    htmlTemplate = htmlTemplate
      .replace(/{{tipo_comprobante}}/g, tipoComprobante)
      .replace(/{{punto_venta}}/g, puntoVenta)
      .replace(/{{numero_comprobante}}/g, numeroComprobante)
      .replace(/{{fecha}}/g, fechaFormateada)
      .replace(/{{cuit_emisor}}/g, process.env.AFIP_CUIT || '30714525030')
      .replace(/{{ingresos_brutos}}/g, process.env.IIBB || '251491/4')
      .replace(/{{fecha_inicio_actividades}}/g, process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016')
      .replace(/{{telefono}}/g, process.env.EMPRESA_TELEFONO || '')
      .replace(/{{email}}/g, process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com')
      .replace(/{{cliente_cuit}}/g, nota.cliente_cuit || 'No informado')
      .replace(/{{cliente_nombre}}/g, nota.cliente_nombre || 'No informado')
      .replace(/{{cliente_condicion}}/g, nota.cliente_condicion || 'No informado')
      .replace(/{{cliente_direccion}}/g, nota.cliente_direccion || 'No informado')
      .replace(/{{observaciones_html}}/g, observacionesHTML)
      .replace(/{{factura_asociada_tipo}}/g, facturaAsociadaTipo)
      .replace(/{{factura_asociada_punto_venta}}/g, facturaAsociadaPV)
      .replace(/{{factura_asociada_numero}}/g, facturaAsociadaNum)
      .replace(/{{factura_asociada_fecha}}/g, facturaAsociadaFecha);

    // ✅ ITEMS
    const itemsHTML = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const cantidadFormateada = this.formatearCantidad(cantidad);
      const precioUnitario = cantidad > 0 ? (subtotal / cantidad) : 0;
      
      return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre || producto.descripcion || 'Item'} - ${producto.producto_um || ''}</td>
          <td style="text-align: center;">${esExento ? '0.00' : '21.00'}</td>
          <td style="text-align: right;">${precioUnitario.toFixed(2)}</td>
          <td style="text-align: right;">${subtotal.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

    // ✅ TOTALES
    const subtotal = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    let ivaTotal = 0;
    let total = subtotal;
    
    if (!esExento) {
      ivaTotal = subtotal * 0.21;
      total = subtotal + ivaTotal;
    }

    htmlTemplate = htmlTemplate
      .replace(/{{subtotal}}/g, subtotal.toFixed(2))
      .replace(/{{iva_total}}/g, ivaTotal.toFixed(2))
      .replace(/{{total}}/g, total.toFixed(2))
      .replace(/{{qr_base64}}/g, qrBase64)
      .replace(/{{logo_arca}}/g, logoARCABase64)
      .replace(/{{cae}}/g, nota.cae_id)
      .replace(/{{cae_vencimiento}}/g, fechaVencimientoCAE);
    
    console.log('📄 Generando PDF de Nota de Débito ARCA...');
    
    return await this.generatePdfFromHtml(htmlTemplate);
  }

  /**
   * ✅ FACTURA GENÉRICA (C) - CON IVA INCLUIDO, SIN $
   */
  async generarFacturaGenerica(venta, productos) {
    const templatePath = path.join(this.templatesPath, 'factura.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla factura.html no encontrada');
    }

    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    
    const fechaFormateada = this.formatearFecha(venta.fecha);
    
    // ✅ MANEJO DE OBSERVACIONES
    let observacionesHTML = '';
    const observaciones = (venta.observaciones || '').toString().trim();
    
    if (observaciones && observaciones.toLowerCase() !== 'sin observaciones') {
        observacionesHTML = `
            <div class="observaciones-section">
                <h4>Observaciones:</h4>
                <p>${observaciones}</p>
            </div>
        `;
        console.log('📝 Observaciones incluidas en la factura genérica');
    } else {
        console.log('📝 Sin observaciones para mostrar en factura genérica');
    }
    
    htmlTemplate = htmlTemplate
      .replace(/{{fecha}}/g, fechaFormateada)
      .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
      .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado')
      .replace(/{{observaciones_html}}/g, observacionesHTML);

    // ✅ DETECTAR SI HAY DESCUENTOS
    const hayDescuentos = productos.some(p => parseFloat(p.descuento_porcentaje || 0) > 0);

    // ✅ ITEMS CON IVA INCLUIDO Y DESCUENTOS OPCIONALES
    const itemsHTML = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const iva = parseFloat(producto.iva || producto.IVA) || 0;
      const descuento = parseFloat(producto.descuento_porcentaje || 0);
      const total = subtotal + iva;
      const cantidadFormateada = this.formatearCantidad(cantidad);
      
      // Precio CON IVA y CON descuento aplicado (precio actual)
      const precioConDescuentoConIva = cantidad > 0 ? (total / cantidad) : 0;
      
      // Precio ORIGINAL CON IVA (antes del descuento)
      const precioOriginalConIva = descuento > 0 
        ? precioConDescuentoConIva / (1 - descuento / 100)
        : precioConDescuentoConIva;

      if (hayDescuentos) {
        return `
        <tr>
          <td>${producto.producto_id}</td>
          <td>${producto.producto_nombre}</td>
          <td>${producto.producto_um}</td>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td style="text-align: right;">${precioOriginalConIva.toFixed(2)}</td>
          <td style="text-align: center;">${descuento.toFixed(0)}%</td>
          <td style="text-align: right;">${precioConDescuentoConIva.toFixed(2)}</td>
          <td style="text-align: right;">${total.toFixed(2)}</td>
        </tr>
      `;
      } else {
        // Layout original sin descuentos
        return `
        <tr>
          <td>${producto.producto_id}</td>
          <td>${producto.producto_nombre}</td>
          <td>${producto.producto_um}</td>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td style="text-align: right;">${precioConDescuentoConIva.toFixed(2)}</td>
          <td style="text-align: right;">${total.toFixed(2)}</td>
        </tr>
      `;
      }
    }).join('');
    
    // ✅ REEMPLAZAR HEADER SEGÚN SI HAY DESCUENTOS
    const tableHeader = hayDescuentos ? `
            <thead>
                <tr>
                    <th style="width: 7%;">ID</th>
                    <th style="width: 24%;">Producto</th>
                    <th style="width: 7%;">U.M.</th>
                    <th style="width: 7%;" class="text-center">Cant.</th>
                    <th style="width: 13%;" class="text-right">P. Original</th>
                    <th style="width: 7%;" class="text-center">Desc.</th>
                    <th style="width: 13%;" class="text-right">P. Final</th>
                    <th style="width: 13%;" class="text-right">Total</th>
                </tr>
            </thead>
    ` : `
            <thead>
                <tr>
                    <th style="width: 10%;">ID</th>
                    <th style="width: 35%;">Producto</th>
                    <th style="width: 10%;">U.M.</th>
                    <th style="width: 10%;" class="text-center">Cantidad</th>
                    <th style="width: 15%;" class="text-right">Precio Unit.</th>
                    <th style="width: 20%;" class="text-right">Total</th>
                </tr>
            </thead>
    `;

    htmlTemplate = htmlTemplate
      .replace(/<thead>[\s\S]*?<\/thead>/m, tableHeader)
      .replace(/{{items}}/g, itemsHTML);
    
    const totalFactura = productos.reduce((acc, item) => {
      const subtotal = parseFloat(item.subtotal) || 0;
      const iva = parseFloat(item.iva || item.IVA) || 0;
      return acc + subtotal + iva;
    }, 0);

    htmlTemplate = htmlTemplate.replace(/{{total}}/g, venta.total || totalFactura.toFixed(2));

    return await this.generatePdfFromHtml(htmlTemplate);
  }

    // ✅ RESTO DE FUNCIONES SIN CAMBIOS
    async generarRankingVentas(fecha, ventas) {
        const templatePath = path.join(this.templatesPath, 'ranking_ventas.html');

        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla ranking_ventas.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        htmlTemplate = htmlTemplate.replace(/{{fecha}}/g, this.formatearFecha(fecha));

        const itemsHTML = ventas.map(venta => {
            const clienteNombre = venta.cliente_nombre || '';
            const direccion = venta.direccion || '';
            const telefono = venta.telefono || '';
            const email = venta.email || '';
            const dni = venta.dni || '';

            return `
                <tr>
                    <td>${clienteNombre}</td>
                    <td>${direccion}</td>
                    <td>${telefono}</td>
                    <td>${email}</td>
                    <td>${dni}</td>
                    <td style="text-align: right;">${venta.subtotal.toFixed(2)}</td>
                    <td style="text-align: right;">0.00</td>
                    <td style="text-align: right;">${venta.iva_total.toFixed(2)}</td>
                    <td style="text-align: right;">0.00</td>
                    <td style="text-align: right;">0.00</td>
                    <td style="text-align: right;">${venta.total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    async generarNotaPedido(pedido, productos) {
        const templatePath = path.join(this.templatesPath, 'nota_pedido2.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla nota_pedido2.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        const fechaFormateada = this.formatearFecha(pedido.fecha);
        htmlTemplate = htmlTemplate
            .replace(/{{fecha}}/g, fechaFormateada)
            .replace(/{{id}}/g, pedido.id)
            .replace(/{{cliente_nombre}}/g, pedido.cliente_nombre)
            .replace(/{{cliente_direccion}}/g, pedido.cliente_direccion || 'No informado')
            .replace(/{{cliente_telefono}}/g, pedido.cliente_telefono || 'No informado')
            .replace(/{{empleado_nombre}}/g, pedido.empleado_nombre || 'No informado')
            .replace(/{{pedido_observacion}}/g, pedido.observaciones || 'No informado');

        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id || ''}</td>
                <td>${producto.producto_nombre || ''}</td>
                <td>${producto.producto_um || ''}</td>
                <td style="text-align: center;">${this.formatearCantidad(producto.cantidad || 0)}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    async generarListaPrecios(cliente, productos) {
        const templatePath = path.join(this.templatesPath, 'lista_precio.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla lista_precio.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        const fechaActual = this.formatearFecha(new Date());
        htmlTemplate = htmlTemplate
            .replace(/{{fecha}}/g, fechaActual)
            .replace(/{{cliente_nombre}}/g, cliente.nombre || 'No informado')
            .replace(/{{cliente_cuit}}/g, cliente.cuit || 'No informado')
            .replace(/{{cliente_cativa}}/g, cliente.condicion_iva || 'No informado');

        // ✅ ITEMS CON IVA INCLUIDO - Los precios ya vienen con IVA del frontend
        const itemsHTML = productos.map(producto => {
            const precioConIva = parseFloat(producto.precio_venta) || 0; // Ya viene con IVA incluido
            const cantidad = parseFloat(producto.cantidad) || 1;
            const subtotal = precioConIva * cantidad;
            const cantidadFormateada = this.formatearCantidad(cantidad);

            return `
                <tr>
                    <td>${producto.id}</td>
                    <td>${producto.nombre}</td>
                    <td>${producto.unidad_medida}</td>
                    <td>${cantidadFormateada}</td>
                    <td style="text-align: right;">${precioConIva.toFixed(2)}</td>
                    <td style="text-align: right;">${subtotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // ✅ CALCULAR TOTAL CON IVA INCLUIDO
        const totalConIva = productos.reduce((acc, producto) => {
            const precioConIva = parseFloat(producto.precio_venta) || 0;
            const cantidad = parseFloat(producto.cantidad) || 1;
            return acc + (precioConIva * cantidad);
        }, 0);

        htmlTemplate = htmlTemplate.replace(/{{total}}/g, totalConIva.toFixed(2));

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    async generarRemito(remito, productos) {
        const templatePath = path.join(this.templatesPath, 'remito.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla remito.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        const fechaFormateada = this.formatearFecha(remito.fecha);
        htmlTemplate = htmlTemplate
            .replace(/{{fecha}}/g, fechaFormateada)
            .replace(/{{cliente_nombre}}/g, remito.cliente_nombre || 'No informado')
            .replace(/{{cliente_cuit}}/g, remito.cliente_cuit || 'No informado')
            .replace(/{{cliente_cativa}}/g, remito.cliente_condicion || 'No informado')
            .replace(/{{cliente_direccion}}/g, remito.cliente_direccion || 'No informado')
            .replace(/{{cliente_ciudad}}/g, remito.cliente_ciudad || 'No informado')
            .replace(/{{cliente_provincia}}/g, remito.cliente_provincia || 'No informado')
            .replace(/{{cliente_telefono}}/g, remito.cliente_telefono || 'No informado');

        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id}</td>
                <td>${producto.producto_nombre}</td>
                <td>${producto.producto_um}</td>
                <td style="text-align: center;">${this.formatearCantidad(producto.cantidad)}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        const htmlDoble = htmlTemplate + '<div style="page-break-before: always;"></div>' + htmlTemplate;

        return await this.generatePdfFromHtml(htmlDoble);
    }

    // ✅ NUEVO: Generar reporte financiero simplificado
    async generarReporteFinanciero(dashboardData) {
        const templatePath = path.join(this.templatesPath, 'reporte_financiero.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla reporte_financiero.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        console.log('📊 Generando reporte financiero PDF...');
        
        const { periodo, resumen, comparacion_periodo_anterior, top_productos, vendedores, alertas } = dashboardData;
        
        // ✅ Formatear fechas
        const fechaGeneracion = new Date().toLocaleDateString('es-AR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const periodoTexto = `Desde ${this.formatearFecha(periodo.desde)} hasta ${this.formatearFecha(periodo.hasta)}`;
        
        // ✅ Formatear montos
        const formatMoney = (valor) => {
            return parseFloat(valor || 0).toLocaleString('es-AR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        };
        
        // ✅ Determinar clases CSS según valores
        const resultadoClase = resumen.resultado_neto >= 0 ? 'positivo' : 'negativo';
        const estadoBadgeClase = resumen.estado === 'GANANCIA' ? 'ganancia' : 'perdida';
        const tendenciaClase = comparacion_periodo_anterior.tendencia === 'MEJORA' ? 'mejora' : 
                               comparacion_periodo_anterior.tendencia === 'DISMINUCIÓN' ? 'disminucion' : '';
        const diferenciaClase = comparacion_periodo_anterior.diferencia >= 0 ? 'positivo' : 'negativo';
        
        // ✅ Generar HTML de alertas
        let alertasHTML = '';
        if (alertas && alertas.length > 0) {
            alertasHTML = '<div class="seccion"><div class="seccion-titulo">⚠️ Alertas</div>';
            alertas.forEach(alerta => {
                const claseAlerta = alerta.tipo === 'CRÍTICO' ? 'critico' :
                                   alerta.tipo === 'ADVERTENCIA' ? 'advertencia' : 'info';
                alertasHTML += `<div class="alerta ${claseAlerta}">${alerta.mensaje}</div>`;
            });
            alertasHTML += '</div>';
        }
        
        // ✅ Generar tabla de top productos
        let topProductosRows = '';
        if (top_productos && top_productos.length > 0) {
            topProductosRows = top_productos.map(p => `
                <tr>
                    <td>${p.nombre}</td>
                    <td class="text-center">${this.formatearCantidad(p.cantidad_vendida)}</td>
                    <td class="text-right">$ ${formatMoney(p.ingresos)}</td>
                    <td class="text-center">${p.ventas}</td>
                </tr>
            `).join('');
        } else {
            topProductosRows = '<tr><td colspan="4" class="text-center" style="padding: 20px; color: #94a3b8;">No hay productos vendidos en este período</td></tr>';
        }
        
        // ✅ Generar tabla de vendedores
        let vendedoresRows = '';
        if (vendedores && vendedores.length > 0) {
            vendedoresRows = vendedores.map(v => `
                <tr>
                    <td>${v.nombre}</td>
                    <td class="text-center">${v.cantidad_ventas}</td>
                    <td class="text-right">$ ${formatMoney(v.monto_total)}</td>
                    <td class="text-right">$ ${formatMoney(v.ticket_promedio)}</td>
                </tr>
            `).join('');
        } else {
            vendedoresRows = '<tr><td colspan="4" class="text-center" style="padding: 20px; color: #94a3b8;">No hay datos de vendedores en este período</td></tr>';
        }
        
        // ✅ Reemplazar variables en template
        htmlTemplate = htmlTemplate
            .replace(/{{periodo_texto}}/g, periodoTexto)
            .replace(/{{ventas_monto}}/g, formatMoney(resumen.ventas.monto))
            .replace(/{{ventas_cantidad}}/g, resumen.ventas.cantidad)
            .replace(/{{egresos_total}}/g, formatMoney(resumen.egresos.total))
            .replace(/{{compras_monto}}/g, formatMoney(resumen.egresos.compras))
            .replace(/{{gastos_monto}}/g, formatMoney(resumen.egresos.gastos))
            .replace(/{{resultado_neto}}/g, formatMoney(Math.abs(resumen.resultado_neto)))
            .replace(/{{resultado_clase}}/g, resultadoClase)
            .replace(/{{estado_texto}}/g, resumen.estado)
            .replace(/{{estado_badge_clase}}/g, estadoBadgeClase)
            .replace(/{{porcentaje_cambio}}/g, formatMoney(comparacion_periodo_anterior.porcentaje_cambio))
            .replace(/{{tendencia_texto}}/g, comparacion_periodo_anterior.tendencia)
            .replace(/{{tendencia_clase}}/g, tendenciaClase)
            .replace(/{{dias_periodo}}/g, periodo.dias)
            .replace(/{{ventas_actuales}}/g, formatMoney(comparacion_periodo_anterior.ventas_actuales))
            .replace(/{{ventas_anteriores}}/g, formatMoney(comparacion_periodo_anterior.ventas_anteriores))
            .replace(/{{diferencia_ventas}}/g, formatMoney(Math.abs(comparacion_periodo_anterior.diferencia)))
            .replace(/{{diferencia_clase}}/g, diferenciaClase)
            .replace(/{{alertas_html}}/g, alertasHTML)
            .replace(/{{top_productos_rows}}/g, topProductosRows)
            .replace(/{{vendedores_rows}}/g, vendedoresRows)
            .replace(/{{fecha_generacion}}/g, fechaGeneracion);
        
        console.log('✅ Template procesado, generando PDF...');

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR PDF - Libro IVA
    async generarLibroIva(datos) {
        const templatePath = path.join(this.templatesPath, 'libro_iva.html');

        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla libro_iva.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        const mesesNombres = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        const mesNombre = mesesNombres[parseInt(datos.mes) - 1];

        // Reemplazar datos del encabezado
        htmlTemplate = htmlTemplate
            .replace(/{{mes}}/g, mesNombre)
            .replace(/{{anio}}/g, datos.anio);

        // Generar filas de la tabla
        const itemsHTML = datos.ventas.map(venta => {
            const fecha = this.formatearFecha(venta.fecha);
            return `
                <tr>
                    <td>${fecha}</td>
                    <td>${venta.comprobante}</td>
                    <td>${venta.numero}</td>
                    <td>${venta.cliente}</td>
                    <td>${venta.cuit}</td>
                    <td>$ ${venta.neto.toFixed(2)}</td>
                    <td>$ ${venta.exento.toFixed(2)}</td>
                    <td>$ ${venta.iva.toFixed(2)}</td>
                    <td>$ ${venta.percepciones.toFixed(2)}</td>
                    <td>$ ${venta.retenciones.toFixed(2)}</td>
                    <td>$ ${venta.total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // Reemplazar totales
        htmlTemplate = htmlTemplate
            .replace(/{{total_neto}}/g, datos.totales.neto.toFixed(2))
            .replace(/{{total_exento}}/g, datos.totales.exento.toFixed(2))
            .replace(/{{total_iva}}/g, datos.totales.iva.toFixed(2))
            .replace(/{{total_percepciones}}/g, datos.totales.percepciones.toFixed(2))
            .replace(/{{total_retenciones}}/g, datos.totales.retenciones.toFixed(2))
            .replace(/{{total_total}}/g, datos.totales.total.toFixed(2));

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR PDF - Lista de Precios por Categorías
    async generarListaPreciosCategorias(datos) {
        const templatePath = path.join(this.templatesPath, 'lista_precio_categorias.html');

        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla lista_precio_categorias.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        const fechaActual = this.formatearFecha(new Date());
        htmlTemplate = htmlTemplate.replace(/{{fecha}}/g, fechaActual);

        // Generar HTML para cada categoría
        const categoriasHTML = datos.categorias.map(categoria => {
            const productos = datos.productosPorCategoria[categoria];

            const productosRows = productos.map(producto => {
                // Ya viene calculado desde el controlador con el IVA correspondiente
                const precioConIva = parseFloat(producto.precio_con_iva) || 0;
                return `
                    <tr>
                        <td>${producto.id}</td>
                        <td>${producto.nombre}</td>
                        <td>${producto.unidad_medida}</td>
                        <td>$ ${precioConIva.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="categoria-titulo">${categoria}</div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Nombre</th>
                            <th>Unidad de Medida</th>
                            <th>Precio Venta (IVA incl.)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${productosRows}
                    </tbody>
                </table>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{categorias}}/g, categoriasHTML);

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR PDF - Control de Stock
    async generarControlStock(datos) {
        const templatePath = path.join(this.templatesPath, 'control_stock.html');

        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla control_stock.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        const fechaActual = this.formatearFecha(new Date());
        htmlTemplate = htmlTemplate.replace(/{{fecha}}/g, fechaActual);
        htmlTemplate = htmlTemplate.replace(/{{cantidad_productos}}/g, datos.cantidad);

        // Determinar el título según el tipo de filtro
        let tipoFiltro = '';
        if (datos.tipo === 'menor') {
            tipoFiltro = `${datos.cantidad} PRODUCTOS CON MENOR STOCK`;
        } else if (datos.tipo === 'mayor') {
            tipoFiltro = `${datos.cantidad} PRODUCTOS CON MAYOR STOCK`;
        } else {
            tipoFiltro = `CONTROL DE STOCK - ${datos.cantidad} PRODUCTOS SELECCIONADOS`;
        }
        htmlTemplate = htmlTemplate.replace(/{{tipo_filtro}}/g, tipoFiltro);

        // Generar HTML para cada categoría
        const categoriasHTML = datos.categorias.map(categoria => {
            const productos = datos.productosPorCategoria[categoria];

            const productosRows = productos.map(producto => {
                const stock = parseFloat(producto.stock_actual) || 0;
                // Formatear stock: si es entero mostrar sin decimales, si tiene decimales mostrar con 1 decimal
                const stockFormateado = stock % 1 === 0 ? stock.toString() : stock.toFixed(1);
                return `
                    <tr>
                        <td>${producto.id}</td>
                        <td>${producto.nombre}</td>
                        <td>${producto.unidad_medida}</td>
                        <td>${stockFormateado}</td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="categoria-titulo">${categoria}</div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Nombre</th>
                            <th>Unidad de Medida</th>
                            <th>Stock Actual</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${productosRows}
                    </tbody>
                </table>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{categorias}}/g, categoriasHTML);

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR PDF - Listado de Vendedores
    async generarListadoVendedores(datos) {
        const templatePath = path.join(this.templatesPath, 'listado_vendedores.html');

        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla listado_vendedores.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        const mesesNombres = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        const mesNombre = mesesNombres[parseInt(datos.mes) - 1];

        // Reemplazar datos del encabezado
        htmlTemplate = htmlTemplate
            .replace(/{{vendedor}}/g, datos.vendedorNombre)
            .replace(/{{mes}}/g, mesNombre)
            .replace(/{{anio}}/g, datos.anio);

        // Generar filas de la tabla
        const itemsHTML = datos.ventas.map(venta => {
            const fecha = this.formatearFecha(venta.fecha);
            return `
                <tr>
                    <td>${fecha}</td>
                    <td>${venta.comprobante}</td>
                    <td>${venta.numero}</td>
                    <td>${venta.cliente}</td>
                    <td>${venta.cuit}</td>
                    <td>$ ${venta.neto.toFixed(2)}</td>
                    <td>$ ${venta.exento.toFixed(2)}</td>
                    <td>$ ${venta.iva.toFixed(2)}</td>
                    <td>$ ${venta.percepciones.toFixed(2)}</td>
                    <td>$ ${venta.retenciones.toFixed(2)}</td>
                    <td>$ ${venta.total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // Reemplazar totales
        htmlTemplate = htmlTemplate
            .replace(/{{total_neto}}/g, datos.totales.neto.toFixed(2))
            .replace(/{{total_exento}}/g, datos.totales.exento.toFixed(2))
            .replace(/{{total_iva}}/g, datos.totales.iva.toFixed(2))
            .replace(/{{total_percepciones}}/g, datos.totales.percepciones.toFixed(2))
            .replace(/{{total_retenciones}}/g, datos.totales.retenciones.toFixed(2))
            .replace(/{{total_total}}/g, datos.totales.total.toFixed(2));

        return await this.generatePdfFromHtml(htmlTemplate);
    }
}

const pdfGenerator = new PdfGenerator();
module.exports = pdfGenerator;