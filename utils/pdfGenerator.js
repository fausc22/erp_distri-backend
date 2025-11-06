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

    // ✅ ITEMS - Mostrar precios según si es EXENTO o no
    const itemsHTML = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const precioUnitarioSinIva = cantidad > 0 ? (subtotal / cantidad) : 0;
      const cantidadFormateada = this.formatearCantidad(cantidad);

      return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: center;">${esExento ? '0.00' : '21.00'}</td>
          <td style="text-align: right;">${precioUnitarioSinIva.toFixed(2)}</td>
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
      .replace(/{{cae}}/g, venta.cae_id)
      .replace(/{{cae_vencimiento}}/g, fechaVencimientoCAE);
    
    console.log('📄 Generando PDF de Factura ARCA...');
    console.log(`   Subtotal: $${subtotal.toFixed(2)}`);
    console.log(`   IVA 21%: $${ivaTotal.toFixed(2)} ${esExento ? '(EXENTO)' : ''}`);
    console.log(`   Total: $${total.toFixed(2)}`);
    
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
    htmlTemplate = htmlTemplate
      .replace(/{{fecha}}/g, fechaFormateada)
      .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
      .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado');

    // ✅ ITEMS CON IVA INCLUIDO
    const itemsHTML = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const iva = parseFloat(producto.iva || producto.IVA) || 0;
      const total = subtotal + iva;
      const productoPrecioIva = cantidad > 0 ? (total / cantidad) : 0;
      const cantidadFormateada = this.formatearCantidad(cantidad);

      return `
        <tr>
          <td>${producto.producto_id}</td>
          <td>${producto.producto_nombre}</td>
          <td>${producto.producto_um}</td>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td style="text-align: right;">${productoPrecioIva.toFixed(2)}</td>
          <td style="text-align: right;">${total.toFixed(2)}</td>
        </tr>
      `;
    }).join('');
    
    htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
    
    const totalFactura = productos.reduce((acc, item) => {
      const subtotal = parseFloat(item.subtotal) || 0;
      const iva = parseFloat(item.iva || item.IVA) || 0;
      return acc + subtotal + iva;
    }, 0);

    htmlTemplate = htmlTemplate.replace(/{{total}}/g, venta.total || totalFactura.toFixed(2));

    return await this.generatePdfFromHtml(htmlTemplate);
  }

    // ✅ FACTURA GENÉRICA (C) - SIN SÍMBOLO $
    async generarFacturaGenerica(venta, productos) {
        const templatePath = path.join(this.templatesPath, 'factura.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla factura.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        const fechaFormateada = this.formatearFecha(venta.fecha);
        htmlTemplate = htmlTemplate
            .replace(/{{fecha}}/g, fechaFormateada)
            .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
            .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado');

        // ✅ ITEMS CON IVA INCLUIDO - SIN SÍMBOLO $
        const itemsHTML = productos.map(producto => {
            const cantidad = parseFloat(producto.cantidad) || 0;
            const subtotal = parseFloat(producto.subtotal) || 0;
            const iva = parseFloat(producto.iva || producto.IVA) || 0;
            const total = subtotal + iva;
            const productoPrecioIva = cantidad > 0 ? (total / cantidad) : 0;
            const cantidadFormateada = this.formatearCantidad(cantidad);

            return `
                <tr>
                    <td>${producto.producto_id}</td>
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um}</td>
                    <td style="text-align: center;">${cantidadFormateada}</td>
                    <td style="text-align: right;">${productoPrecioIva.toFixed(2)}</td>
                    <td style="text-align: right;">${total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

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
}

const pdfGenerator = new PdfGenerator();
module.exports = pdfGenerator;