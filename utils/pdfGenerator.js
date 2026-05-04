const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const db = require('../controllers/db.js');   

// URL del microservicio ARCA (desde .env)
const ARCA_MICROSERVICE_URL = process.env.ARCA_MICROSERVICE_URL;

class PdfGenerator {
    constructor() {
        this.templatesPath = path.join(__dirname, '../resources/documents');
        this.maxRowsIntermediaARCA = this.parsePositiveInt(process.env.ARCA_MAX_ROWS_INTERMEDIA, 10);
        this.maxRowsFinalARCA = this.parsePositiveInt(process.env.ARCA_MAX_ROWS_FINAL, 10);
        /* Nota de Pedido A4 — Etapa 4: máx. 16 ítems primera página, 24 en siguientes (configurable por NOTA_PEDIDO_MAX_ROWS_FIRST / NEXT). */
        this.notaPedidoMaxRowsFirst = this.parsePositiveInt(process.env.NOTA_PEDIDO_MAX_ROWS_FIRST, 16);
        this.notaPedidoMaxRowsNext = this.parsePositiveInt(process.env.NOTA_PEDIDO_MAX_ROWS_NEXT, 24);
    }

    parsePositiveInt(value, fallback) {
        const parsed = parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

    formatearFechaFiscalQR(venta) {
        const fuenteFecha = venta?.fecha_fiscal || venta?.cae_solicitud_fecha || venta?.fecha;
        if (!fuenteFecha) return null;
        const fecha = new Date(fuenteFecha);
        if (isNaN(fecha.getTime())) return null;
        return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    }

    obtenerCuitEmisorQR() {
        const cuit = (process.env.AFIP_CUIT || '').replace(/\D/g, '');
        if (cuit.length !== 11) {
            throw new Error('AFIP_CUIT inválido o no configurado para generar QR');
        }
        return parseInt(cuit, 10);
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

    formatearMoneda(valor) {
        const num = parseFloat(valor);
        if (isNaN(num)) return '0,00';

        return num.toLocaleString('es-AR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    formatearMonedaRedondeadaCeroCentavos(valor) {
        const num = parseFloat(valor);
        if (isNaN(num)) return '0,00';
        return this.formatearMoneda(Math.round(num));
    }

    construirTotalesVisualesRedondeados(items = [], totalObjetivo = null) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const rounded = items.map((item) => Math.round(Number(item) || 0));
        const totalCalculado = rounded.reduce((acc, n) => acc + n, 0);
        const totalEsperado = Number.isFinite(Number(totalObjetivo))
            ? Math.round(Number(totalObjetivo))
            : totalCalculado;
        const diferencia = totalEsperado - totalCalculado;
        if (diferencia !== 0) {
            const ultimoIdx = rounded.length - 1;
            rounded[ultimoIdx] += diferencia;
        }
        return rounded;
    }

    normalizarCondicionIva(condicion) {
        return (condicion || '')
            .toString()
            .trim()
            .toUpperCase()
            .replace(/\s+/g, ' ');
    }

    esCondicionExento(condicion) {
        return this.normalizarCondicionIva(condicion) === 'EXENTO';
    }

    esCondicionConsumidorFinal(condicion) {
        const normalized = this.normalizarCondicionIva(condicion);
        return normalized === 'CONSUMIDOR FINAL' || normalized === 'CONSUMIDOR_FINAL' || normalized === 'CF';
    }

    debeOcultarIvaDiscriminadoEnComprobanteB(tipoFiscal, condicionIva) {
        const tipo = (tipoFiscal || '').toString().trim().toUpperCase();
        if (tipo !== 'B') return false;
        return this.esCondicionExento(condicionIva) || this.esCondicionConsumidorFinal(condicionIva);
    }

    obtenerCodigoComprobanteVisual(tipoFiscal, tipoDoc = 'FACTURA') {
        const tipo = (tipoFiscal || '').toString().trim().toUpperCase();
        const doc = (tipoDoc || 'FACTURA').toString().trim().toUpperCase();

        if (doc === 'NOTA_DEBITO') {
            return tipo === 'A' ? '2' : '7';
        }
        if (doc === 'NOTA_CREDITO') {
            return tipo === 'A' ? '3' : '8';
        }
        return tipo === 'A' ? '1' : '6';
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
            
            // Viewport A4 para que mm/CSS se interpreten bien (210×297mm ≈ 794×1123px @96dpi)
            await page.setViewport({
                width: 794,
                height: 1123,
                deviceScaleFactor: 1
            });
            
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
            // Detectar si es una nota
            const esNota = venta.tipo_doc === 'NOTA_DEBITO' || venta.tipo_doc === 'NOTA_CREDITO';
            
            let tipoComprobante;
            if (esNota) {
                const esNotaDebito = venta.tipo_doc === 'NOTA_DEBITO';
                if (venta.tipo_f === 'A') {
                    tipoComprobante = esNotaDebito ? 2 : 3; // NOTA_DEBITO_A: 2, NOTA_CREDITO_A: 3
                } else if (venta.tipo_f === 'B') {
                    tipoComprobante = esNotaDebito ? 7 : 8; // NOTA_DEBITO_B: 7, NOTA_CREDITO_B: 8
                } else {
                    tipoComprobante = esNotaDebito ? 7 : 8; // Default a tipo B
                }
            } else {
                const tipoComprobanteMap = { 
                    'A': 1,   // Factura A
                    'B': 6,   // Factura B
                    'C': 11   // Factura C
                };
                tipoComprobante = tipoComprobanteMap[venta.tipo_f] || 6;
            }
            
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
            const fechaFormateada = this.formatearFechaFiscalQR(venta);
            if (!fechaFormateada) {
                throw new Error('No se pudo determinar fecha fiscal para QR');
            }

            // ✅ VALIDAR CAE
            const cae = venta.cae_id;
            if (!cae) {
                console.warn('⚠️ Venta sin CAE, no se puede generar QR válido');
                return this.generarQRPlaceholder();
            }

            // ✅ DESGLOSAR NÚMERO DE FACTURA/NOTA
            let puntoVenta = 1;
            let numeroComprobante = venta.id;
            
            if (venta.numero_factura) {
                // Formato factura: "A 0004-00000001"
                const regexFactura = /^([A-Z]+)\s+(\d{4})-(\d{8})$/;
                // Formato nota: "0004-00001"
                const regexNota = /^(\d{4})-(\d{5})$/;
                
                const matchFactura = venta.numero_factura.trim().match(regexFactura);
                const matchNota = venta.numero_factura.trim().match(regexNota);
                
                if (matchFactura) {
                    puntoVenta = parseInt(matchFactura[2]);
                    numeroComprobante = parseInt(matchFactura[3]);
                } else if (matchNota) {
                    puntoVenta = parseInt(matchNota[1]);
                    numeroComprobante = parseInt(matchNota[2]);
                }
            }
            
            // ✅ CONSTRUIR JSON SEGÚN ESPECIFICACIÓN ARCA v1
            const datosQR = {
                ver: 1,                                          // Versión del formato
                fecha: fechaFormateada,                          // Fecha emisión (YYYY-MM-DD)
                cuit: this.obtenerCuitEmisorQR(),                      // CUIT emisor (sin guiones)
                ptoVta: puntoVenta,                               // Punto de venta
                tipoCmp: tipoComprobante,                        // Tipo comprobante
                nroCmp: numeroComprobante,                        // Número de comprobante
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
            // Detectar si es una nota
            const esNota = venta.tipo_doc === 'NOTA_DEBITO' || venta.tipo_doc === 'NOTA_CREDITO';
            
            let tipoComprobante;
            if (esNota) {
                const esNotaDebito = venta.tipo_doc === 'NOTA_DEBITO';
                if (venta.tipo_f === 'A') {
                    tipoComprobante = esNotaDebito ? 2 : 3; // NOTA_DEBITO_A: 2, NOTA_CREDITO_A: 3
                } else if (venta.tipo_f === 'B') {
                    tipoComprobante = esNotaDebito ? 7 : 8; // NOTA_DEBITO_B: 7, NOTA_CREDITO_B: 8
                } else {
                    tipoComprobante = esNotaDebito ? 7 : 8; // Default a tipo B
                }
            } else {
                const tipoComprobanteMap = { 'A': 1, 'B': 6, 'C': 11 };
                tipoComprobante = tipoComprobanteMap[venta.tipo_f] || 6;
            }
            
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

            const fechaFormateada = this.formatearFechaFiscalQR(venta);
            if (!fechaFormateada) {
                throw new Error('No se pudo determinar fecha fiscal para QR local');
            }

            // ✅ VALIDAR CAE
            if (!venta.cae_id) {
                console.warn('⚠️ No hay CAE, usando QR placeholder');
                return this.generarQRPlaceholder();
            }

            // ✅ DESGLOSAR NÚMERO DE FACTURA/NOTA
            let puntoVenta = 1;
            let numeroComprobante = venta.id;
            
            if (venta.numero_factura) {
                // Formato factura: "A 0004-00000001"
                const regexFactura = /^([A-Z]+)\s+(\d{4})-(\d{8})$/;
                // Formato nota: "0004-00001"
                const regexNota = /^(\d{4})-(\d{5})$/;
                
                const matchFactura = venta.numero_factura.trim().match(regexFactura);
                const matchNota = venta.numero_factura.trim().match(regexNota);
                
                if (matchFactura) {
                    puntoVenta = parseInt(matchFactura[2]);
                    numeroComprobante = parseInt(matchFactura[3]);
                } else if (matchNota) {
                    puntoVenta = parseInt(matchNota[1]);
                    numeroComprobante = parseInt(matchNota[2]);
                }
            }

            // ✅ JSON CON DATOS DEL COMPROBANTE
            const datosComprobante = {
                ver: 1,
                fecha: fechaFormateada,
                cuit: this.obtenerCuitEmisorQR(),
                ptoVta: puntoVenta,
                tipoCmp: tipoComprobante,
                nroCmp: numeroComprobante,
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
            const qrUrl = `https://www.arca.gob.ar/fe/qr/?p=${encodeURIComponent(base64Data)}`;
            
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

    reemplazarPlaceholders(template, values = {}) {
        let result = template;
        for (const [key, value] of Object.entries(values)) {
            const safeValue = value === undefined || value === null ? '' : String(value);
            result = result.replace(new RegExp(`{{${key}}}`, 'g'), safeValue);
        }
        return result;
    }

    construirFooterFacturaARCA({
        observacionesHTML,
        subtotal,
        ivaTotal,
        total,
        qrBase64,
        logoARCABase64,
        cae,
        fechaVencimientoCAE,
        esExento = false,
        forzarCentavosCero = false
    }) {
        const fmtImporte = forzarCentavosCero
            ? (v) => this.formatearMonedaRedondeadaCeroCentavos(v)
            : (v) => this.formatearMoneda(v);
        const filasTotales = esExento
            ? `
                        <tr class="total-row">
                            <td><strong>TOTAL:</strong></td>
                            <td class="text-right" style="white-space: nowrap;"><strong>${fmtImporte(total)}</strong></td>
                        </tr>`
            : `
                        <tr>
                            <td>Neto Gravado:</td>
                            <td class="text-right" style="white-space: nowrap;"><strong>${fmtImporte(subtotal)}</strong></td>
                        </tr>
                        <tr>
                            <td>Exento:</td>
                            <td class="text-right" style="white-space: nowrap;"><strong>0,00</strong></td>
                        </tr>
                        <tr>
                            <td>IVA:</td>
                            <td class="text-right" style="white-space: nowrap;"><strong>${fmtImporte(ivaTotal)}</strong></td>
                        </tr>
                        <tr>
                            <td>Percepciones:</td>
                            <td class="text-right" style="white-space: nowrap;"><strong>0,00</strong></td>
                        </tr>
                        <tr class="total-row">
                            <td><strong>TOTAL:</strong></td>
                            <td class="text-right" style="white-space: nowrap;"><strong>${fmtImporte(total)}</strong></td>
                        </tr>`;
        return `
        <div class="factura-footer-wrapper">
            <div class="totales-observaciones-container">
                <div class="observaciones-section">
                    ${observacionesHTML}
                </div>
                <div class="totales-box" style="width: 260px;">
                    <div class="totales-box-header">
                        <strong>PESOS</strong>
                    </div>
                    <table>
                        ${filasTotales}
                    </table>
                </div>
            </div>
            <div class="legal-footer">
                <p><strong>Observaciones:</strong> El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.</p>
            </div>
            <div class="qr-footer">
                <div class="qr-section">
                    <img src="${qrBase64}" alt="Código QR AFIP">
                    <div class="qr-text-content">
                        <p style="font-weight: bold; margin-bottom: 5px;">Comprobante Autorizado</p>
                        <img src="${logoARCABase64}" alt="Logo ARCA" style="width: 100px; height: 35px; object-fit: contain;">
                    </div>
                    <div style="clear: both;"></div>
                </div>
                <div class="cae-section">
                    <p><strong>CAE Nº:</strong> ${cae}</p>
                    <p><strong>Fecha de Vto. de CAE:</strong> ${fechaVencimientoCAE}</p>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * REGLAS DE PAGINACIÓN ARCA (Factura / Nota Débito / Nota Crédito)
     * ───────────────────────────────────────────────────────────────
     * Regla 1: El encabezado completo (todo lo anterior a la tabla de ítems)
     *          se repite idéntico en todas las páginas. No se negocia ni se
     *          modifica por página.
     * Regla 2: El bloque Totales + Legal + QR + CAE aparece SOLO en la última página.
     * Regla 3: En páginas intermedias solo va la tabla de ítems (sin totales).
     * Regla 4: Mostrar numeración visible "Página X/Y" en todas las páginas.
     * Objetivo: Maximizar uso de páginas intermedias sin romper la estética actual.
     *
     * Medición: solo se considera "footer" el bloque visible (.factura-footer-wrapper:not(.is-empty))
     * para que availableFinal se mida correctamente cuando el HTML tiene footer completo.
     */
    async medirLayoutFacturaARCA(htmlMedicion) {
        let browser = null;
        try {
            const pdfOptions = this.getOptions();
            const launchOptions = {
                headless: 'new',
                args: pdfOptions.args || [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            };

            if (pdfOptions.executablePath && fs.existsSync(pdfOptions.executablePath)) {
                launchOptions.executablePath = pdfOptions.executablePath;
            }

            browser = await puppeteer.launch(launchOptions);
            const page = await browser.newPage();
            await page.setViewport({
                width: 794,
                height: 1123,
                deviceScaleFactor: 1
            });

            await page.setContent(htmlMedicion, {
                waitUntil: 'networkidle0',
                timeout: pdfOptions.timeout || 30000
            });

            const safePadding = 8;
            const metrics = await page.evaluate((padding) => {
                const facturaPage = document.querySelector('.factura-page');
                if (!facturaPage) return null;

                const theadEl = facturaPage.querySelector('.row-details thead');
                const footerEl = facturaPage.querySelector('.factura-footer-wrapper:not(.is-empty)');
                const rows = Array.from(facturaPage.querySelectorAll('.row-details tbody tr'));
                if (!theadEl) return null;

                const pageRect = facturaPage.getBoundingClientRect();
                const theadBottom = theadEl.getBoundingClientRect().bottom;
                const pageHeight = pageRect.height;

                // Espacio bajo el thead en hoja sin footer (páginas intermedias)
                const availableIntermedia = Math.max(0, pageRect.bottom - theadBottom - padding);

                // Espacio para filas en la ÚLTIMA hoja: altura fija A4 menos encabezado menos bloque totales/QR
                let availableFinal = availableIntermedia;
                if (footerEl) {
                    const headerHeight = theadBottom - pageRect.top;
                    const footerHeight = footerEl.getBoundingClientRect().height;
                    availableFinal = Math.max(0, pageHeight - headerHeight - footerHeight - padding);
                }

                return {
                    availableIntermedia,
                    availableFinal,
                    rowHeights: rows.map((row) => row.getBoundingClientRect().height)
                };
            }, safePadding);

            await browser.close();
            browser = null;

            if (!metrics || !Array.isArray(metrics.rowHeights)) {
                throw new Error('No se pudieron medir alturas de la factura ARCA');
            }

            return metrics;
        } catch (error) {
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    console.error('Error cerrando navegador de medición ARCA:', closeError.message);
                }
            }
            throw error;
        }
    }

    /**
     * Paginación por llenado progresivo: llena cada página intermedia hasta
     * availableIntermedia; la última página lleva el remanente (y debe caber en availableFinal).
     *
     * Importante: si el remanente cabe en altura de hoja "sin pie" pero no en availableFinal
     * (hoja con totales/QR), no se puede cerrar esa tanda en una sola página con pie: se dejan
     * filas para la siguiente página o para una última más corta, evitando solapamiento tabla/footer.
     */
    paginarFilasFacturaARCA(rowHeights, availableIntermedia, availableFinal, limits = {}) {
        if (!Array.isArray(rowHeights) || rowHeights.length === 0) {
            return [{ start: 0, end: 0, isLast: true }];
        }

        const maxRowsIntermedia = this.parsePositiveInt(limits.maxRowsIntermedia, this.maxRowsIntermediaARCA);
        const maxRowsFinal = this.parsePositiveInt(limits.maxRowsFinal, this.maxRowsFinalARCA);
        const prefix = [0];
        for (const height of rowHeights) {
            prefix.push(prefix[prefix.length - 1] + (parseFloat(height) || 0));
        }

        const sumRange = (start, end) => prefix[end] - prefix[start];
        const pages = [];
        const totalRows = rowHeights.length;
        let start = 0;

        while (start < totalRows) {
            const remainingRows = totalRows - start;
            if (remainingRows <= maxRowsFinal && sumRange(start, totalRows) <= availableFinal) {
                pages.push({ start, end: totalRows, isLast: true });
                break;
            }

            let end = start;
            let used = 0;

            while (end < totalRows) {
                const nextRowHeight = parseFloat(rowHeights[end]) || 0;

                if (end === start && nextRowHeight > availableIntermedia) {
                    end = start + 1;
                    break;
                }

                if (used + nextRowHeight > availableIntermedia) {
                    break;
                }
                if ((end - start) >= maxRowsIntermedia) {
                    break;
                }

                // Al añadir la siguiente fila se completaría todo el remanente: esa hoja sería
                // la última (con pie). Si la suma de alturas del remanente supera availableFinal,
                // no cerrar aquí (salvo una sola fila inevitable); dejar filas para otra página.
                if (end + 1 === totalRows) {
                    const heightAllRemaining = sumRange(start, totalRows);
                    if (heightAllRemaining > availableFinal && end > start) {
                        break;
                    }
                }

                used += nextRowHeight;
                end += 1;
            }

            if (end === start) {
                end = start + 1;
            }

            pages.push({ start, end, isLast: false });
            start = end;
        }

        if (pages.length === 0) {
            pages.push({ start: 0, end: totalRows, isLast: true });
        } else {
            pages.forEach((page) => {
                page.isLast = false;
            });
            pages[pages.length - 1].isLast = true;
        }

        return pages;
    }

    /**
     * Construye el HTML multipágina para Factura ARCA y Notas ARCA (Débito/Crédito).
     * Única implementación compartida: garantiza Reglas 1-4 (encabezado fijo, footer solo
     * en última, numeración Página X/Y). En plantillas de notas, la sección "comprobante
     * asociado" está dentro del bloque de página y se repite en todas las hojas (encabezado).
     */
    async construirHtmlMultipaginaARCA({
        templatePath,
        commonReplacements,
        rowsByItem,
        footerContent,
        tableHeader
    }) {
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla no encontrada: ${path.basename(templatePath)}`);
        }

        const htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        const templateMatch = htmlTemplate.match(/<!-- PAGE_TEMPLATE_START -->([\s\S]*?)<!-- PAGE_TEMPLATE_END -->/);
        if (!templateMatch) {
            throw new Error(`No se encontró bloque de página reutilizable en ${path.basename(templatePath)}`);
        }

        const htmlSkeleton = htmlTemplate.replace(templateMatch[0], '{{pages_html}}');
        let pageTemplate = templateMatch[1].trim();

        if (tableHeader) {
            pageTemplate = pageTemplate.replace(/<thead>[\s\S]*?<\/thead>/m, tableHeader);
        }

        pageTemplate = this.reemplazarPlaceholders(pageTemplate, commonReplacements);

        const rowsHtml = rowsByItem.join('');
        const emptyFooter = '<div class="factura-footer-wrapper is-empty"></div>';

        // Medición 1: todos los ítems + footer vacío → rowHeights y availableIntermedia (hoja sin totales)
        const medicionIntermediaHtml = pageTemplate
            .replace(/{{items}}/g, rowsHtml)
            .replace(/{{footer_content}}/g, emptyFooter)
            .replace(/{{page_class}}/g, '')
            .replace(/\{\{page_number\}\}/g, '1')
            .replace(/\{\{page_total\}\}/g, '1');
        const htmlMedicionIntermedia = htmlSkeleton.replace('{{pages_html}}', medicionIntermediaHtml);
        const metricsIntermedia = await this.medirLayoutFacturaARCA(htmlMedicionIntermedia);
        const { rowHeights, availableIntermedia } = metricsIntermedia;

        // Medición 2: una fila + footer completo → availableFinal (espacio para ítems en la hoja que lleva total/QR)
        const unaFilaHtml = rowsByItem.length > 0 ? rowsByItem.slice(0, 1).join('') : '';
        const medicionFinalHtml = pageTemplate
            .replace(/{{items}}/g, unaFilaHtml)
            .replace(/{{footer_content}}/g, footerContent)
            .replace(/{{page_class}}/g, 'last-page')
            .replace(/\{\{page_number\}\}/g, '1')
            .replace(/\{\{page_total\}\}/g, '1');
        const htmlMedicionFinal = htmlSkeleton.replace('{{pages_html}}', medicionFinalHtml);
        const metricsFinal = await this.medirLayoutFacturaARCA(htmlMedicionFinal);
        const availableFinal = metricsFinal.availableFinal;

        const pages = this.paginarFilasFacturaARCA(rowHeights, availableIntermedia, availableFinal, {
            maxRowsIntermedia: this.maxRowsIntermediaARCA,
            maxRowsFinal: this.maxRowsFinalARCA
        });
        const totalRowsHeight = rowHeights.reduce((acc, height) => acc + (parseFloat(height) || 0), 0);
        console.log(
            `📐 ARCA layout: filas=${rowHeights.length}, altoFilas=${totalRowsHeight.toFixed(2)}, ` +
            `intermedia=${availableIntermedia.toFixed(2)}, final=${availableFinal.toFixed(2)}, ` +
            `maxIntermedia=${this.maxRowsIntermediaARCA}, maxFinal=${this.maxRowsFinalARCA}`
        );

        const pagesHtml = pages.map((page, index) => {
            const pageItems = rowsByItem.slice(page.start, page.end).join('');
            const isLastPage = index === pages.length - 1;
            const pageFooter = isLastPage
                ? footerContent
                : '<div class="factura-footer-wrapper is-empty"></div>';

            return pageTemplate
                .replace(/{{items}}/g, pageItems)
                .replace(/{{footer_content}}/g, pageFooter)
                .replace(/{{page_class}}/g, isLastPage ? 'last-page' : '')
                .replace(/\{\{page_number\}\}/g, String(index + 1))
                .replace(/\{\{page_total\}\}/g, String(pages.length));
        }).join('\n');

        return {
            html: htmlSkeleton.replace('{{pages_html}}', pagesHtml),
            pageCount: pages.length
        };
    }

    /**
     * Pagina ítems de Nota de Pedido: primera página hasta notaPedidoMaxRowsFirst,
     * siguientes hasta notaPedidoMaxRowsNext cada una.
     */
    paginarFilasNotaPedido(totalRows) {
        const first = this.notaPedidoMaxRowsFirst;
        const next = this.notaPedidoMaxRowsNext;
        if (totalRows <= 0) return [{ start: 0, end: 0 }];
        const pages = [];
        pages.push({ start: 0, end: Math.min(first, totalRows) });
        let start = pages[0].end;
        while (start < totalRows) {
            const end = Math.min(start + next, totalRows);
            pages.push({ start, end });
            start = end;
        }
        return pages;
    }

    /**
     * Construye HTML multipágina para Nota de Pedido (A4).
     * Encabezado (empresa, NP, datos cliente) se repite en cada página.
     * Observaciones solo en la primera; "Continuación NP Nº X" en el resto.
     * Leyenda "Gracias por su preferencia" solo en la última.
     */
    construirHtmlMultipaginaNotaPedido({
        templatePath,
        commonReplacements,
        rowsByItem,
        observacionesHTML,
        footerLeyendaHTML,
        continuacionHTML
    }) {
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla no encontrada: ${path.basename(templatePath)}`);
        }
        const htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        const templateMatch = htmlTemplate.match(/<!-- PAGE_TEMPLATE_START -->([\s\S]*?)<!-- PAGE_TEMPLATE_END -->/);
        if (!templateMatch) {
            throw new Error(`No se encontró bloque de página reutilizable en ${path.basename(templatePath)}`);
        }
        const htmlSkeleton = htmlTemplate.replace(templateMatch[0], '{{pages_html}}');
        let pageTemplate = templateMatch[1].trim();
        pageTemplate = this.reemplazarPlaceholders(pageTemplate, commonReplacements);

        const totalRows = rowsByItem.length;
        const pages = this.paginarFilasNotaPedido(totalRows);
        const pageCount = pages.length;

        const pagesHtml = pages.map((page, index) => {
            const pageItems = rowsByItem.slice(page.start, page.end).join('');
            const isFirst = index === 0;
            const isLast = index === pageCount - 1;
            const obsOrCont = isFirst ? observacionesHTML : continuacionHTML;
            const footer = isLast ? footerLeyendaHTML : '';
            return pageTemplate
                .replace(/{{items}}/g, pageItems)
                .replace(/\{\{observaciones_or_continuation\}\}/g, obsOrCont)
                .replace(/\{\{footer_leyenda\}\}/g, footer)
                .replace(/\{\{page_number\}\}/g, String(index + 1))
                .replace(/\{\{page_total\}\}/g, String(pageCount))
                .replace(/\{\{page_class\}\}/g, isLast ? 'last-page' : '');
        }).join('\n');

        return {
            html: htmlSkeleton.replace('{{pages_html}}', pagesHtml),
            pageCount
        };
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
     * Integración Etapa 4: usa construirHtmlMultipaginaARCA para garantizar
     * - Encabezado idéntico en todas las páginas (Regla 1)
     * - Totales + QR + CAE solo en la última (Regla 2)
     * - Páginas intermedias solo con tabla, footer vacío (Regla 3)
     */
  async generarFacturaARCA(venta, productos) {
    const templatePath = path.join(this.templatesPath, 'factura_arca.html');

    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla factura_arca.html no encontrada');
    }

    console.log('📱 Generando QR...');
    const qrBase64 = await this.generarQRDesdeARCA(venta);
    const logoARCABase64 = this.obtenerLogoARCABase64();
    
    const tipoComprobante = venta.tipo_f;
    const codigoComprobante = this.obtenerCodigoComprobanteVisual(tipoComprobante, venta.tipo_doc || 'FACTURA');
    const fechaFormateada = this.formatearFecha(venta.fecha_fiscal || venta.fecha);
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
    
    // ✅ Determinar si el cliente está EXENTO (insensible a mayúsculas)
    const condicionIVA = (venta.cliente_condicion || '').toString().trim();
    const esExento = this.esCondicionExento(condicionIVA);
    
    console.log(`🔖 Cliente ${condicionIVA} ${esExento ? '(SIN IVA)' : '(CON IVA)'}`);
    
    // ✅ MANEJO CONDICIONAL DE OBSERVACIONES + transparencia fiscal (solo Factura B Exento)
    let observacionesHTML = '';
    const observaciones = (venta.observaciones || '').toString().trim();
    const esFacturaB = (tipoComprobante || '').toString().trim().toUpperCase() === 'B';
    const ocultarIvaDiscriminado = (tipoComprobante || '').toString().trim().toUpperCase() === 'B'
      || this.debeOcultarIvaDiscriminadoEnComprobanteB(tipoComprobante, condicionIVA);
    const mostrarTransparenciaFiscal = ocultarIvaDiscriminado;
    const ivaContenidoRaw = Number.isFinite(parseFloat(venta.exento)) && parseFloat(venta.exento) > 0
      ? parseFloat(venta.exento)
      : (Number.isFinite(parseFloat(venta.iva_total)) ? parseFloat(venta.iva_total) : 0);
    const ivaContenidoTexto = this.formatearMonedaRedondeadaCeroCentavos(ivaContenidoRaw);

    if (observaciones && observaciones.toLowerCase() !== 'sin observaciones') {
      observacionesHTML += `
            <p><strong>OBSERVACIONES:</strong></p>
            <p>${observaciones}</p>
        `;
      console.log('📝 Observaciones incluidas en la factura');
    } else {
      console.log('📝 Sin observaciones para mostrar');
    }

    if (mostrarTransparenciaFiscal) {
      observacionesHTML += `
            <div style="margin-top: 6px; font-size: 10px; line-height: 1.2;">
                <p style="margin: 0;">Regimen de transparencia fiscal al consumidor (Ley 27.743)</p>
                <p style="margin: 2px 0 0 0;">IVA contenido: $${ivaContenidoTexto}</p>
            </div>
        `;
      console.log(`🧾 Transparencia fiscal agregada (Factura B Exento): IVA contenido $${ivaContenidoTexto}`);
    }
    
    // ✅ DETECTAR SI HAY DESCUENTOS EN ALGÚN PRODUCTO
    const hayDescuentos = productos.some(p => parseFloat(p.descuento_porcentaje || 0) > 0);
    const totalFacturaCabecera = Number.isFinite(parseFloat(venta.total)) ? parseFloat(venta.total) : null;
    const totalesVisualesFacturaB = esFacturaB
      ? this.construirTotalesVisualesRedondeados(
          productos.map((p) => (parseFloat(p.subtotal) || 0) + (parseFloat(p.iva || 0))),
          totalFacturaCabecera
        )
      : [];

    const fmtMontoFactura = esFacturaB
      ? (v) => this.formatearMonedaRedondeadaCeroCentavos(v)
      : (v) => this.formatearMoneda(v);
    
    // ✅ FILAS HTML de ítems (array para poder paginar)
    const rowsByItem = productos.map((producto, index) => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotalItem = parseFloat(producto.subtotal) || 0;
      const ivaItem = parseFloat(producto.iva || 0);
      const descuento = parseFloat(producto.descuento_porcentaje || 0);
      const cantidadFormateada = this.formatearCantidad(cantidad);

      // Para toda Factura B (consumidor final, monotributo, exento): mostrar precios CON IVA
      // incluido, para que el cliente vea el valor real que paga (números redondos).
      // La diferencia entre exento y no exento es solo la columna de IVA en el encabezado.
      // Para Factura A (Responsable Inscripto): mantener base imponible SIN IVA (correcto legalmente).
      const totalItemRaw = esFacturaB ? (subtotalItem + ivaItem) : subtotalItem;
      const totalItemBase = esFacturaB
        ? (totalesVisualesFacturaB[index] ?? Math.round(totalItemRaw))
        : totalItemRaw;
      const precioConDescuento = cantidad > 0 ? (totalItemBase / cantidad) : 0;
      const precioOriginal = descuento > 0
        ? precioConDescuento / (1 - descuento / 100)
        : precioConDescuento;

      // Si hay descuentos en la factura, agregar columnas de precio original y descuento
      if (hayDescuentos) {
        if (ocultarIvaDiscriminado) {
          return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(precioOriginal)}</td>
          <td style="text-align: center;">${descuento.toFixed(0)}%</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(precioConDescuento)}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(totalItemBase)}</td>
        </tr>
      `;
        }
        return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: center;">21.00</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(precioOriginal)}</td>
          <td style="text-align: center;">${descuento.toFixed(0)}%</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(precioConDescuento)}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(totalItemBase)}</td>
        </tr>
      `;
      }
      // Layout sin descuentos
      if (ocultarIvaDiscriminado) {
        return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(precioConDescuento)}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(totalItemBase)}</td>
        </tr>
      `;
      }
      return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre} - ${producto.producto_um}</td>
          <td style="text-align: center;">21.00</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(precioConDescuento)}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFactura(totalItemBase)}</td>
        </tr>
      `;
    });

    // ✅ REEMPLAZAR HEADER DE LA TABLA: según descuentos y si es exento (exento → sin columna % IVA)
    let tableHeader;
    if (ocultarIvaDiscriminado && hayDescuentos) {
        tableHeader = `
                <thead>
                    <tr>
                        <th style="width: 8%;">Cant.</th>
                        <th style="width: 32%;">Producto/Servicio/Detalle</th>
                        <th style="width: 14%;">P. Original</th>
                        <th style="width: 8%;">Desc.</th>
                        <th style="width: 14%;">P. Final</th>
                        <th style="width: 14%;">Total</th>
                    </tr>
                </thead>
    `;
    } else if (ocultarIvaDiscriminado) {
        tableHeader = `
                <thead>
                    <tr>
                        <th style="width: 10%;">Cantidad</th>
                        <th style="width: 50%;">Producto/Servicio/Detalle</th>
                        <th style="width: 20%;">Precio</th>
                        <th style="width: 20%;">Total</th>
                    </tr>
                </thead>
    `;
    } else if (hayDescuentos) {
        tableHeader = `
                <thead>
                    <tr>
                        <th style="width: 7%;">Cant.</th>
                        <th style="width: 24%;">Producto/Servicio/Detalle</th>
                        <th style="width: 7%;">IVA</th>
                        <th style="width: 14%;">P. Original</th>
                        <th style="width: 7%;">Desc.</th>
                        <th style="width: 14%;">P. Final</th>
                        <th style="width: 14%;">Total</th>
                    </tr>
                </thead>
    `;
    } else {
        tableHeader = `
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
    }

    // ✅ TOTALES: priorizar importes persistidos en la venta para evitar divergencias
    const subtotalCalculado = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    const subtotal = Number.isFinite(parseFloat(venta.subtotal))
      ? parseFloat(venta.subtotal)
      : subtotalCalculado;
    const ivaTotal = Number.isFinite(parseFloat(venta.iva_total))
      ? parseFloat(venta.iva_total)
      : (ocultarIvaDiscriminado ? 0 : subtotal * 0.21);
    const total = Number.isFinite(parseFloat(venta.total))
      ? parseFloat(venta.total)
      : (subtotal + ivaTotal);

    const footerContent = this.construirFooterFacturaARCA({
      observacionesHTML,
      subtotal,
      ivaTotal,
      total,
      qrBase64,
      logoARCABase64,
      cae: venta.cae_id,
      fechaVencimientoCAE,
      esExento: ocultarIvaDiscriminado,
      forzarCentavosCero: esFacturaB
    });

    const commonReplacements = {
      tipo_comprobante: tipoComprobante,
      codigo_comprobante: codigoComprobante,
      punto_venta: puntoVenta,
      numero_comprobante: numeroComprobante,
      fecha: fechaFormateada,
      cuit_emisor: process.env.AFIP_CUIT || '30714525030',
      ingresos_brutos: process.env.IIBB || '251491/4',
      fecha_inicio_actividades: process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016',
      telefono: process.env.EMPRESA_TELEFONO || '',
      email: process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com',
      cliente_cuit: venta.cliente_cuit || 'No informado',
      cliente_nombre: venta.cliente_nombre || 'No informado',
      cliente_condicion: venta.cliente_condicion || 'No informado',
      cliente_direccion: venta.cliente_direccion || 'No informado'
    };

    const { html: finalHtml, pageCount } = await this.construirHtmlMultipaginaARCA({
      templatePath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });

    console.log('📄 Generando PDF de Factura ARCA...');
    console.log(`   Subtotal: $${subtotal.toFixed(2)}`);
    console.log(`   IVA: $${ivaTotal.toFixed(2)} ${ocultarIvaDiscriminado ? '(NO DISCRIMINADO)' : ''}`);
    console.log(`   Total: $${total.toFixed(2)}`);
    console.log(`   Páginas generadas: ${pageCount}`);

    return await this.generatePdfFromHtml(finalHtml);
  }

  /**
   * ✅ GENERAR NOTA DE CRÉDITO ARCA (A y B)
   * Maneja: Responsable Inscripto, Monotributo, Consumidor Final, Exento
   * Integración Etapa 5: usa construirHtmlMultipaginaARCA; encabezado (incl. comprobante
   * asociado) idéntico en todas las páginas; total y QR solo en la última.
   */
  async generarNotaCreditoARCA(nota, productos, facturaAsociada) {
    const templatePath = path.join(this.templatesPath, 'nota_credito_arca.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla nota_credito_arca.html no encontrada');
    }

    console.log('📱 Generando QR para Nota de Crédito...');
    const qrBase64 = await this.generarQRDesdeARCA(nota);
    const logoARCABase64 = this.obtenerLogoARCABase64();
    
    const tipoComprobante = nota.tipo_f || 'NC';
    const codigoComprobante = this.obtenerCodigoComprobanteVisual(tipoComprobante, 'NOTA_CREDITO');
    const fechaFormateada = this.formatearFecha(nota.fecha_fiscal || nota.fecha);
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
    const ocultarIvaDiscriminado = (tipoComprobante || '').toString().trim().toUpperCase() === 'B'
      || this.debeOcultarIvaDiscriminadoEnComprobanteB(tipoComprobante, condicionIVA);
    
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
    const facturaAsociadaTipo = facturaAsociada?.tipo || 'N/A';
    const facturaAsociadaPV = facturaAsociada?.puntoVenta || 'N/A';
    const facturaAsociadaNum = facturaAsociada?.numero || 'N/A';
    const facturaAsociadaFecha = facturaAsociada?.fecha ? this.formatearFecha(facturaAsociada.fecha) : '';
    const facturaAsociadaTotal = this.formatearMoneda(facturaAsociada?.total || 0);

    const totalNotaCabecera = Number.isFinite(parseFloat(nota.total)) ? parseFloat(nota.total) : null;
    const totalesVisualesNota = ocultarIvaDiscriminado
      ? this.construirTotalesVisualesRedondeados(
          productos.map((p) => (parseFloat(p.subtotal) || 0) + (parseFloat(p.iva || p.iva_calculado) || 0)),
          totalNotaCabecera
        )
      : [];

    const rowsByItem = productos.map((producto, index) => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const ivaItem = parseFloat(producto.iva || producto.iva_calculado) || 0;
      const cantidadFormateada = this.formatearCantidad(cantidad);
      const subtotalMostrado = ocultarIvaDiscriminado
        ? (totalesVisualesNota[index] ?? Math.round(subtotal + ivaItem))
        : subtotal;
      const precioUnitario = cantidad > 0 ? (subtotalMostrado / cantidad) : 0;
      
      if (ocultarIvaDiscriminado) {
        return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre || producto.descripcion || 'Item'} - ${producto.producto_um || ''}</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioUnitario)}</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotalMostrado)}</td>
        </tr>
      `;
      }

      return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre || producto.descripcion || 'Item'} - ${producto.producto_um || ''}</td>
          <td style="text-align: center;">21.00</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioUnitario)}</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotalMostrado)}</td>
        </tr>
      `;
    });

    // ✅ TOTALES
    const subtotalCalculado = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    const subtotal = Number.isFinite(parseFloat(nota.subtotal))
      ? parseFloat(nota.subtotal)
      : subtotalCalculado;
    const ivaTotal = Number.isFinite(parseFloat(nota.iva_total))
      ? parseFloat(nota.iva_total)
      : (ocultarIvaDiscriminado ? 0 : subtotal * 0.21);
    const total = Number.isFinite(parseFloat(nota.total))
      ? parseFloat(nota.total)
      : (subtotal + ivaTotal);

    const tableHeader = ocultarIvaDiscriminado
      ? `
                <thead>
                    <tr>
                        <th style="width: 10%;">Cantidad</th>
                        <th style="width: 50%;">Producto/Servicio/Detalle</th>
                        <th style="width: 20%;">Precio</th>
                        <th style="width: 20%;">Total</th>
                    </tr>
                </thead>
    `
      : undefined;

    const footerContent = this.construirFooterFacturaARCA({
      observacionesHTML,
      subtotal,
      ivaTotal,
      total,
      qrBase64,
      logoARCABase64,
      cae: nota.cae_id,
      fechaVencimientoCAE,
      esExento: ocultarIvaDiscriminado
    });

    const commonReplacements = {
      tipo_comprobante: tipoComprobante,
      codigo_comprobante: codigoComprobante,
      punto_venta: puntoVenta,
      numero_comprobante: numeroComprobante,
      fecha: fechaFormateada,
      cuit_emisor: process.env.AFIP_CUIT || '30714525030',
      ingresos_brutos: process.env.IIBB || '251491/4',
      fecha_inicio_actividades: process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016',
      telefono: process.env.EMPRESA_TELEFONO || '',
      email: process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com',
      cliente_cuit: nota.cliente_cuit || 'No informado',
      cliente_nombre: nota.cliente_nombre || 'No informado',
      cliente_condicion: nota.cliente_condicion || 'No informado',
      cliente_direccion: nota.cliente_direccion || 'No informado',
      observaciones_html: observacionesHTML,
      factura_asociada_tipo: facturaAsociadaTipo,
      factura_asociada_punto_venta: facturaAsociadaPV,
      factura_asociada_numero: facturaAsociadaNum,
      factura_asociada_fecha: facturaAsociadaFecha,
      factura_asociada_total: facturaAsociadaTotal
    };

    const { html: finalHtml, pageCount } = await this.construirHtmlMultipaginaARCA({
      templatePath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });
    
    console.log('📄 Generando PDF de Nota de Crédito ARCA...');
    console.log(`   Páginas generadas: ${pageCount}`);
    
    return await this.generatePdfFromHtml(finalHtml);
  }

  /**
   * ✅ GENERAR NOTA DE DÉBITO ARCA (A y B)
   * Maneja: Responsable Inscripto, Monotributo, Consumidor Final, Exento
   * Integración Etapa 5: usa construirHtmlMultipaginaARCA; encabezado (incl. comprobante
   * asociado) idéntico en todas las páginas; total y QR solo en la última.
   */
  async generarNotaDebitoARCA(nota, productos, facturaAsociada) {
    const templatePath = path.join(this.templatesPath, 'nota_debito_arca.html');
    
    if (!fs.existsSync(templatePath)) {
      throw new Error('Plantilla nota_debito_arca.html no encontrada');
    }

    console.log('📱 Generando QR para Nota de Débito...');
    const qrBase64 = await this.generarQRDesdeARCA(nota);
    const logoARCABase64 = this.obtenerLogoARCABase64();
    
    const tipoComprobante = nota.tipo_f || 'ND';
    const codigoComprobante = this.obtenerCodigoComprobanteVisual(tipoComprobante, 'NOTA_DEBITO');
    const fechaFormateada = this.formatearFecha(nota.fecha_fiscal || nota.fecha);
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
    const ocultarIvaDiscriminado = this.debeOcultarIvaDiscriminadoEnComprobanteB(tipoComprobante, condicionIVA);
    
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
    const facturaAsociadaTipo = facturaAsociada?.tipo || 'N/A';
    const facturaAsociadaPV = facturaAsociada?.puntoVenta || 'N/A';
    const facturaAsociadaNum = facturaAsociada?.numero || 'N/A';
    const facturaAsociadaFecha = facturaAsociada?.fecha ? this.formatearFecha(facturaAsociada.fecha) : '';
    const facturaAsociadaTotal = this.formatearMoneda(facturaAsociada?.total || 0);

    const rowsByItem = productos.map(producto => {
      const cantidad = parseFloat(producto.cantidad) || 0;
      const subtotal = parseFloat(producto.subtotal) || 0;
      const ivaItem = parseFloat(producto.iva || producto.iva_calculado) || 0;
      const cantidadFormateada = this.formatearCantidad(cantidad);
      const subtotalMostrado = ocultarIvaDiscriminado ? (subtotal + ivaItem) : subtotal;
      const precioUnitario = cantidad > 0 ? (subtotalMostrado / cantidad) : 0;
      
      if (ocultarIvaDiscriminado) {
        return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre || producto.descripcion || 'Item'} - ${producto.producto_um || ''}</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioUnitario)}</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotalMostrado)}</td>
        </tr>
      `;
      }

      return `
        <tr>
          <td style="text-align: center;">${cantidadFormateada}</td>
          <td>${producto.producto_nombre || producto.descripcion || 'Item'} - ${producto.producto_um || ''}</td>
          <td style="text-align: center;">21.00</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioUnitario)}</td>
          <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotalMostrado)}</td>
        </tr>
      `;
    });

    // ✅ TOTALES
    const subtotalCalculado = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    const subtotal = Number.isFinite(parseFloat(nota.subtotal))
      ? parseFloat(nota.subtotal)
      : subtotalCalculado;
    const ivaTotal = Number.isFinite(parseFloat(nota.iva_total))
      ? parseFloat(nota.iva_total)
      : (ocultarIvaDiscriminado ? 0 : subtotal * 0.21);
    const total = Number.isFinite(parseFloat(nota.total))
      ? parseFloat(nota.total)
      : (subtotal + ivaTotal);

    const tableHeader = ocultarIvaDiscriminado
      ? `
                <thead>
                    <tr>
                        <th style="width: 10%;">Cantidad</th>
                        <th style="width: 50%;">Producto/Servicio/Detalle</th>
                        <th style="width: 20%;">Precio</th>
                        <th style="width: 20%;">Total</th>
                    </tr>
                </thead>
    `
      : undefined;

    const footerContent = this.construirFooterFacturaARCA({
      observacionesHTML,
      subtotal,
      ivaTotal,
      total,
      qrBase64,
      logoARCABase64,
      cae: nota.cae_id,
      fechaVencimientoCAE,
      esExento: ocultarIvaDiscriminado
    });

    const commonReplacements = {
      tipo_comprobante: tipoComprobante,
      codigo_comprobante: codigoComprobante,
      punto_venta: puntoVenta,
      numero_comprobante: numeroComprobante,
      fecha: fechaFormateada,
      cuit_emisor: process.env.AFIP_CUIT || '30714525030',
      ingresos_brutos: process.env.IIBB || '251491/4',
      fecha_inicio_actividades: process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016',
      telefono: process.env.EMPRESA_TELEFONO || '',
      email: process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com',
      cliente_cuit: nota.cliente_cuit || 'No informado',
      cliente_nombre: nota.cliente_nombre || 'No informado',
      cliente_condicion: nota.cliente_condicion || 'No informado',
      cliente_direccion: nota.cliente_direccion || 'No informado',
      observaciones_html: observacionesHTML,
      factura_asociada_tipo: facturaAsociadaTipo,
      factura_asociada_punto_venta: facturaAsociadaPV,
      factura_asociada_numero: facturaAsociadaNum,
      factura_asociada_fecha: facturaAsociadaFecha,
      factura_asociada_total: facturaAsociadaTotal
    };

    const { html: finalHtml, pageCount } = await this.construirHtmlMultipaginaARCA({
      templatePath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });
    
    console.log('📄 Generando PDF de Nota de Débito ARCA...');
    console.log(`   Páginas generadas: ${pageCount}`);
    
    return await this.generatePdfFromHtml(finalHtml);
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

    const esFacturaB = (venta.tipo_f || '').toString().trim().toUpperCase() === 'B';
    const fmtMontoFacturaGen = esFacturaB
      ? (v) => this.formatearMonedaRedondeadaCeroCentavos(v)
      : (v) => this.formatearMoneda(v);

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
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFacturaGen(precioOriginalConIva)}</td>
          <td style="text-align: center;">${descuento.toFixed(0)}%</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFacturaGen(precioConDescuentoConIva)}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFacturaGen(total)}</td>
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
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFacturaGen(precioConDescuentoConIva)}</td>
          <td style="text-align: right; white-space: nowrap;">${fmtMontoFacturaGen(total)}</td>
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

    const totalFacturaMostrado = Number.isFinite(parseFloat(venta.total)) ? parseFloat(venta.total) : totalFactura;
    htmlTemplate = htmlTemplate.replace(/{{total}}/g, fmtMontoFacturaGen(totalFacturaMostrado));

    return await this.generatePdfFromHtml(htmlTemplate);
  }

    // ✅ RESTO DE FUNCIONES SIN CAMBIOS
    async generarRankingVentas(fecha, ventas) {
        const templatePath = path.join(this.templatesPath, 'ranking_ventas.html');

        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla ranking_ventas.html no encontrada');
        }

        const toNumber = (value) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 0;
        };

        const normalizeText = (value) => String(value || '').trim();
        const normalizeNameKey = (value) => normalizeText(value).toUpperCase().replace(/\s+/g, ' ');
        const pickFirst = (...values) => values.find((value) => normalizeText(value) !== '') || '';
        const formatMoney = (value) => this.formatearMoneda(toNumber(value));

        const getTipoFactor = (tipoDocRaw) => {
            const tipoDoc = normalizeText(tipoDocRaw).toUpperCase();
            if (tipoDoc === 'NOTA_CREDITO') return -1;
            if (tipoDoc === 'FACTURA' || tipoDoc === 'NOTA_DEBITO') return 1;
            return 1;
        };

        const groupedByClient = new Map();

        for (const venta of ventas) {
            const clienteId = venta?.cliente_id ?? null;
            const dni = normalizeText(venta?.dni);
            const clienteNombre = normalizeText(venta?.cliente_nombre) || 'CLIENTE SIN NOMBRE';
            const clienteKey = clienteId !== null && clienteId !== ''
                ? `ID:${clienteId}`
                : (dni ? `DNI:${dni}` : `NOMBRE:${normalizeNameKey(clienteNombre)}`);

            const tipoFactor = getTipoFactor(venta?.tipo_doc);
            const subtotalSigned = toNumber(venta?.subtotal) * tipoFactor;
            const ivaSigned = toNumber(venta?.iva_total) * tipoFactor;
            const totalSigned = toNumber(venta?.total) * tipoFactor;

            if (!groupedByClient.has(clienteKey)) {
                groupedByClient.set(clienteKey, {
                    cliente_nombre: clienteNombre,
                    direccion: normalizeText(venta?.direccion),
                    telefono: normalizeText(venta?.telefono),
                    email: normalizeText(venta?.email),
                    dni,
                    subtotal: 0,
                    iva_total: 0,
                    total: 0
                });
            }

            const group = groupedByClient.get(clienteKey);
            group.subtotal += subtotalSigned;
            group.iva_total += ivaSigned;
            group.total += totalSigned;

            group.cliente_nombre = pickFirst(group.cliente_nombre, clienteNombre, 'CLIENTE SIN NOMBRE');
            group.direccion = pickFirst(group.direccion, venta?.direccion);
            group.telefono = pickFirst(group.telefono, venta?.telefono);
            group.email = pickFirst(group.email, venta?.email);
            group.dni = pickFirst(group.dni, venta?.dni);
        }

        const rankingConsolidado = Array.from(groupedByClient.values())
            .sort((a, b) => b.total - a.total);

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        htmlTemplate = htmlTemplate.replace(/{{fecha}}/g, this.formatearFecha(fecha));

        const itemsHTML = rankingConsolidado.map((cliente) => `
                <tr>
                    <td>${cliente.cliente_nombre}</td>
                    <td>${cliente.direccion}</td>
                    <td>${cliente.telefono}</td>
                    <td>${cliente.email}</td>
                    <td>${cliente.dni}</td>
                    <td style="text-align: right;">${formatMoney(cliente.subtotal)}</td>
                    <td style="text-align: right;">0,00</td>
                    <td style="text-align: right;">${formatMoney(cliente.iva_total)}</td>
                    <td style="text-align: right;">0,00</td>
                    <td style="text-align: right;">0,00</td>
                    <td style="text-align: right;">${formatMoney(cliente.total)}</td>
                </tr>
            `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    async generarNotaPedido(pedido, productos) {
        const templatePath = path.join(this.templatesPath, 'nota_pedido2.html');
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla nota_pedido2.html no encontrada');
        }

        const fechaFormateada = this.formatearFecha(pedido.fecha);
        const commonReplacements = {
            fecha: fechaFormateada,
            id: pedido.id,
            cliente_nombre: pedido.cliente_nombre || 'No informado',
            cliente_direccion: pedido.cliente_direccion || 'No informado',
            cliente_ciudad: pedido.cliente_ciudad || 'No informado',
            cliente_telefono: pedido.cliente_telefono || 'No informado',
            empleado_nombre: pedido.empleado_nombre || 'No informado'
        };

        const observacionesTexto = pedido.observaciones || 'No informado';
        const observacionesHTML = `
        <div class="observaciones-box">
            <strong>Observaciones</strong>
            ${observacionesTexto}
        </div>`;
        const continuacionHTML = `<p class="continuacion-texto">Continuación NP Nº ${pedido.id}</p>`;
        const footerLeyendaHTML = `<div class="footer-leyenda"><p>Gracias por su preferencia.</p></div>`;

        const rowsByItem = productos.map(producto => `
            <tr>
                <td>${producto.producto_id || ''}</td>
                <td>${producto.producto_nombre || ''}</td>
                <td>${producto.producto_um || ''}</td>
                <td style="text-align: center;">${this.formatearCantidad(producto.cantidad || 0)}</td>
            </tr>
        `);

        const { html: finalHtml, pageCount } = this.construirHtmlMultipaginaNotaPedido({
            templatePath,
            commonReplacements,
            rowsByItem,
            observacionesHTML,
            footerLeyendaHTML,
            continuacionHTML
        });

        if (pageCount > 1) {
            console.log(`📄 Nota de Pedido NP ${pedido.id}: ${productos.length} ítems, ${pageCount} página(s)`);
        }
        return await this.generatePdfFromHtml(finalHtml);
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
            .replace(/{{cliente_nombre}}/g, cliente.nombre || 'No informado');

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
                    <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioConIva)}</td>
                    <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotal)}</td>
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

        htmlTemplate = htmlTemplate.replace(/{{total}}/g, this.formatearMoneda(totalConIva));

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
        
        const {
            periodo,
            resumen,
            comparacion_periodo_anterior,
            top_productos,
            vendedores,
            clientes = [],
            ciudades = [],
            cuentas = [],
            alertas
        } = dashboardData;
        
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
                               (comparacion_periodo_anterior.tendencia === 'DISMINUCION' || comparacion_periodo_anterior.tendencia === 'DISMINUCIÓN') ? 'disminucion' : '';
        const diferenciaClase = comparacion_periodo_anterior.diferencia >= 0 ? 'positivo' : 'negativo';
        
        // ✅ Generar HTML de alertas
        let alertasHTML = '';
        if (alertas && alertas.length > 0) {
            alertasHTML = '<div class="seccion"><div class="seccion-titulo">⚠️ Alertas</div>';
            alertas.forEach(alerta => {
                const claseAlerta = (alerta.tipo === 'CRÍTICO' || alerta.tipo === 'CRITICO') ? 'critico' :
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
                    <td class="text-center">${p.ventas || '-'}</td>
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

        let clientesRows = '';
        if (clientes && clientes.length > 0) {
            clientesRows = clientes.map(c => `
                <tr>
                    <td>${c.nombre}</td>
                    <td class="text-center">${c.cantidad_ventas}</td>
                    <td class="text-right">$ ${formatMoney(c.monto_total)}</td>
                    <td class="text-right">$ ${formatMoney(c.ticket_promedio)}</td>
                </tr>
            `).join('');
        } else {
            clientesRows = '<tr><td colspan="4" class="text-center" style="padding: 20px; color: #94a3b8;">No hay datos de clientes en este período</td></tr>';
        }

        let ciudadesRows = '';
        if (ciudades && ciudades.length > 0) {
            ciudadesRows = ciudades.map(c => `
                <tr>
                    <td>${c.ciudad}</td>
                    <td>${c.provincia}</td>
                    <td class="text-center">${c.clientes_unicos}</td>
                    <td class="text-right">$ ${formatMoney(c.monto_total)}</td>
                </tr>
            `).join('');
        } else {
            ciudadesRows = '<tr><td colspan="4" class="text-center" style="padding: 20px; color: #94a3b8;">No hay datos geográficos en este período</td></tr>';
        }

        const totalCuentas = cuentas.reduce((sum, c) => sum + parseFloat(c.facturacion_neta || 0), 0);
        let cuentasRows = '';
        if (cuentas && cuentas.length > 0) {
            cuentasRows = cuentas.map(c => {
                const participacion = totalCuentas > 0 ? ((parseFloat(c.facturacion_neta || 0) / totalCuentas) * 100) : 0;
                return `
                    <tr>
                        <td>${c.nombre}</td>
                        <td class="text-right">$ ${formatMoney(c.facturacion_neta)}</td>
                        <td class="text-right">${participacion.toFixed(1)}%</td>
                    </tr>
                `;
            }).join('');
        } else {
            cuentasRows = '<tr><td colspan="3" class="text-center" style="padding: 20px; color: #94a3b8;">No hay datos de cuentas en este período</td></tr>';
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
            .replace(/{{porcentaje_cambio}}/g, Number(comparacion_periodo_anterior.porcentaje_cambio || 0).toFixed(1))
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
            .replace(/{{clientes_rows}}/g, clientesRows)
            .replace(/{{ciudades_rows}}/g, ciudadesRows)
            .replace(/{{cuentas_rows}}/g, cuentasRows)
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

        // Generar filas de la tabla principal
        const itemsHTML = datos.ventas.map(venta => {
            const fecha = this.formatearFecha(venta.fecha);
            return `
                <tr>
                    <td>${fecha}</td>
                    <td>${venta.comprobante}</td>
                    <td>${venta.numero}</td>
                    <td>${venta.cliente}</td>
                    <td>${venta.cuit}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.neto)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.exento)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.iva)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.percepciones)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.retenciones)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.total)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // Reemplazar totales de la tabla principal
        htmlTemplate = htmlTemplate
            .replace(/{{total_neto}}/g, this.formatearMoneda(datos.totales.neto))
            .replace(/{{total_exento}}/g, this.formatearMoneda(datos.totales.exento))
            .replace(/{{total_iva}}/g, this.formatearMoneda(datos.totales.iva))
            .replace(/{{total_percepciones}}/g, this.formatearMoneda(datos.totales.percepciones))
            .replace(/{{total_retenciones}}/g, this.formatearMoneda(datos.totales.retenciones))
            .replace(/{{total_total}}/g, this.formatearMoneda(datos.totales.total));

        // ✅ GENERAR FILAS DE LA TABLA DE DESGLOSE POR CONDICIÓN IVA
        const desglosePorCondicion = datos.desglosePorCondicion || [];
        const desgloseItemsHTML = desglosePorCondicion
            .filter(item => item.cantidadVentas > 0) // Solo mostrar condiciones con ventas
            .map(item => {
                return `
                    <tr>
                        <td style="font-weight: 600; text-align: left;">${item.condicion}</td>
                        <td style="text-align: center; font-weight: 500;">${item.cantidadVentas}</td>
                        <td style="text-align: right; white-space: nowrap;">$ ${item.neto.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="text-align: right; white-space: nowrap;">$ ${item.exento.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="text-align: right; white-space: nowrap;">$ ${item.iva.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="text-align: right; white-space: nowrap;">$ ${item.percepciones.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="text-align: right; white-space: nowrap; font-weight: 600;">$ ${item.total.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    </tr>
                `;
            }).join('');

        htmlTemplate = htmlTemplate.replace(/{{desglose_items}}/g, desgloseItemsHTML);

        // ✅ REEMPLAZAR TOTALES DEL DESGLOSE (deben coincidir con los totales principales)
        htmlTemplate = htmlTemplate
            .replace(/{{desglose_total_neto}}/g, this.formatearMoneda(datos.totales.neto))
            .replace(/{{desglose_total_exento}}/g, this.formatearMoneda(datos.totales.exento))
            .replace(/{{desglose_total_iva}}/g, this.formatearMoneda(datos.totales.iva))
            .replace(/{{desglose_total_percepciones}}/g, this.formatearMoneda(datos.totales.percepciones))
            .replace(/{{desglose_total_total}}/g, this.formatearMoneda(datos.totales.total));

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
                        <td style="white-space: nowrap;">$ ${this.formatearMoneda(precioConIva)}</td>
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
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.neto)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.exento)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.iva)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.percepciones)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.retenciones)}</td>
                    <td style="white-space: nowrap;">$ ${this.formatearMoneda(venta.total)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // Reemplazar totales
        htmlTemplate = htmlTemplate
            .replace(/{{total_neto}}/g, this.formatearMoneda(datos.totales.neto))
            .replace(/{{total_exento}}/g, this.formatearMoneda(datos.totales.exento))
            .replace(/{{total_iva}}/g, this.formatearMoneda(datos.totales.iva))
            .replace(/{{total_percepciones}}/g, this.formatearMoneda(datos.totales.percepciones))
            .replace(/{{total_retenciones}}/g, this.formatearMoneda(datos.totales.retenciones))
            .replace(/{{total_total}}/g, this.formatearMoneda(datos.totales.total));

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    /**
     * ✅ GENERAR NOTA DE DÉBITO O CRÉDITO
     * Detecta si tiene CAE y usa template ARCA o genérico
     */
    async generarNota(venta, productos) {
        const tipoFiscal = (venta.tipo_f || '').toString().trim().toUpperCase();
        const tipoDoc = (venta.tipo_doc || '').toString().trim();
        const esNotaDebito = tipoDoc === 'NOTA_DEBITO';
        
        console.log(`📋 Generando ${tipoDoc} tipo ${tipoFiscal}...`);
        
        // ✅ Notas A o B → ARCA con CAE
        if (tipoFiscal === 'A' || tipoFiscal === 'B') {
            const tieneCAEAprobado = venta.cae_id && 
                                    venta.cae_resultado && 
                                    venta.cae_resultado.toString().trim().toUpperCase() === 'A';

            if (tieneCAEAprobado) {
                console.log(`📋 Generando ${tipoDoc} ARCA tipo ${tipoFiscal} con CAE:`, venta.cae_id);
                return await this.generarNotaARCA(venta, productos);
            } else {
                console.warn(`⚠️ ${tipoDoc} tipo ${tipoFiscal} sin CAE aprobado, usando genérica`);
                return await this.generarNotaGenerica(venta, productos);
            }
        } else {
            // ✅ Notas X o cualquier otro tipo → Genérica
            console.log(`📋 Generando ${tipoDoc} Genérica tipo ${tipoFiscal}`);
            return await this.generarNotaGenerica(venta, productos);
        }
    }

    /**
     * ✅ GENERAR NOTA ARCA (A y B con CAE)
     * Integración Etapa 5: usa construirHtmlMultipaginaARCA; mismas reglas que Factura
     * y Notas D/C (encabezado fijo, total/QR solo última, numeración). Comprobante asociado
     * en encabezado, se repite en todas las páginas.
     */
    async generarNotaARCA(venta, productos) {
        const esNotaDebito = venta.tipo_doc === 'NOTA_DEBITO';
        const templateName = esNotaDebito ? 'nota_debito_arca.html' : 'nota_credito_arca.html';
        const templatePath = path.join(this.templatesPath, templateName);
        
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla ${templateName} no encontrada`);
        }

        console.log('📱 Generando QR...');
        const qrBase64 = await this.generarQRDesdeARCA(venta);
        const logoARCABase64 = this.obtenerLogoARCABase64();
        
        const tipoComprobante = venta.tipo_f;
        const codigoComprobante = this.obtenerCodigoComprobanteVisual(tipoComprobante, venta.tipo_doc);
        const fechaFormateada = this.formatearFecha(venta.fecha_fiscal || venta.fecha);
        const fechaVencimientoCAE = this.formatearFecha(venta.cae_fecha);
        
        // ✅ DESGLOSAR NÚMERO DE NOTA: "0004-00001"
        let puntoVenta = '';
        let numeroComprobante = '';
        
        if (venta.numero_factura) {
            const regex = /^(\d{4})-(\d{5})$/;
            const match = venta.numero_factura.trim().match(regex);
            
            if (match) {
                puntoVenta = match[1];           // "0004"
                numeroComprobante = match[2];     // "00001"
                console.log(`📋 Número desglosado: PV=${puntoVenta}, Comp=${numeroComprobante}`);
            } else {
                console.warn(`⚠️ Formato de numero_factura inesperado: ${venta.numero_factura}, usando valores por defecto`);
                puntoVenta = '0004';
                numeroComprobante = String(venta.id).padStart(5, '0');
            }
        } else {
            console.warn(`⚠️ numero_factura no disponible, usando ID de venta: ${venta.id}`);
            puntoVenta = '0004';
            numeroComprobante = String(venta.id).padStart(5, '0');
        }
        
        // ✅ Determinar si el cliente está EXENTO
        const condicionIVA = (venta.cliente_condicion || '').toString().trim();
        const ocultarIvaDiscriminado = (tipoComprobante || '').toString().trim().toUpperCase() === 'B'
            || this.debeOcultarIvaDiscriminadoEnComprobanteB(tipoComprobante, condicionIVA);
        
        console.log(`🔖 Cliente ${condicionIVA} ${ocultarIvaDiscriminado ? '(SIN IVA DISCRIMINADO)' : '(CON IVA DISCRIMINADO)'}`);
        
        // ✅ MANEJO CONDICIONAL DE OBSERVACIONES
        let observacionesHTML = '';
        const observaciones = (venta.observaciones || '').toString().trim();
        
        if (observaciones && observaciones.toLowerCase() !== 'sin observaciones') {
            observacionesHTML = `
                <p><strong>OBSERVACIONES:</strong></p>
                <p>${observaciones}</p>
            `;
            console.log('📝 Observaciones incluidas en la nota');
        } else {
            console.log('📝 Sin observaciones para mostrar');
        }
        
        // ✅ OBTENER DATOS DE LA FACTURA ASOCIADA
        let facturaAsociadaTipo = 'N/A';
        let facturaAsociadaNumero = 'N/A';
        let facturaAsociadaFecha = 'N/A';
        let facturaAsociadaTotal = '0.00';
        
        if (venta.venta_referencia_id) {
            try {
                console.log(`🔍 Buscando factura asociada ID: ${venta.venta_referencia_id}`);
                const [facturaRows] = await db.execute(
                    `SELECT tipo_f, numero_factura, fecha, total, tipo_doc 
                     FROM ventas 
                     WHERE id = ?`,
                    [venta.venta_referencia_id]
                );
                
                if (facturaRows.length > 0) {
                    const facturaRef = facturaRows[0];
                    
                    // Determinar tipo de comprobante
                    if (facturaRef.tipo_doc === 'NOTA_DEBITO' || facturaRef.tipo_doc === 'NOTA_CREDITO') {
                        facturaAsociadaTipo = `${facturaRef.tipo_doc} ${facturaRef.tipo_f}`;
                    } else {
                        facturaAsociadaTipo = `FACTURA ${facturaRef.tipo_f}`;
                    }
                    
                    // Extraer número de factura
                    if (facturaRef.numero_factura) {
                        // Formato factura: "A 0004-00000001"
                        const regexFactura = /^([A-Z]+)\s+(\d{4})-(\d{8})$/;
                        // Formato nota: "0004-00001"
                        const regexNota = /^(\d{4})-(\d{5})$/;
                        
                        const matchFactura = facturaRef.numero_factura.trim().match(regexFactura);
                        const matchNota = facturaRef.numero_factura.trim().match(regexNota);
                        
                        if (matchFactura) {
                            facturaAsociadaNumero = `${matchFactura[1]} ${matchFactura[2]}-${matchFactura[3]}`;
                        } else if (matchNota) {
                            facturaAsociadaNumero = `${matchNota[1]}-${matchNota[2]}`;
                        } else {
                            facturaAsociadaNumero = facturaRef.numero_factura;
                        }
                    }
                    
                    // Formatear fecha
                    facturaAsociadaFecha = this.formatearFecha(facturaRef.fecha);
                    
                    // Formatear total
                    facturaAsociadaTotal = this.formatearMoneda(facturaRef.total || 0);
                    
                    console.log(`✅ Factura asociada encontrada: ${facturaAsociadaTipo} ${facturaAsociadaNumero}`);
                } else {
                    console.warn(`⚠️ No se encontró la factura asociada con ID: ${venta.venta_referencia_id}`);
                }
            } catch (error) {
                console.error(`❌ Error obteniendo factura asociada:`, error);
            }
        } else {
            console.log('📝 No hay factura asociada (venta_referencia_id no disponible)');
        }
        
        // ✅ ITEMS - Mostrar precios según si es EXENTO o no
        const totalComprobanteCabecera = Number.isFinite(parseFloat(venta.total)) ? parseFloat(venta.total) : null;
        const totalesVisualesComprobante = ocultarIvaDiscriminado
            ? this.construirTotalesVisualesRedondeados(
                productos.map((p) => (parseFloat(p.subtotal) || 0) + (parseFloat(p.iva || p.iva_calculado) || 0)),
                totalComprobanteCabecera
            )
            : [];

        const rowsByItem = productos.map((producto, index) => {
            const cantidad = parseFloat(producto.cantidad) || 0;
            const subtotal = parseFloat(producto.subtotal) || 0;
            const ivaItem = parseFloat(producto.iva || producto.iva_calculado) || 0;
            const cantidadFormateada = this.formatearCantidad(cantidad);
            
            const subtotalMostrado = ocultarIvaDiscriminado
                ? (totalesVisualesComprobante[index] ?? Math.round(subtotal + ivaItem))
                : subtotal;
            const precioUnitarioSinIva = cantidad > 0 ? (subtotalMostrado / cantidad) : 0;
            if (ocultarIvaDiscriminado) {
                return `
                    <tr>
                        <td style="text-align: center;">${cantidadFormateada}</td>
                        <td>${producto.producto_nombre} - ${producto.producto_um || 'unidad'}</td>
                        <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioUnitarioSinIva)}</td>
                        <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotalMostrado)}</td>
                    </tr>
                `;
            }

            return `
                <tr>
                    <td style="text-align: center;">${cantidadFormateada}</td>
                    <td>${producto.producto_nombre} - ${producto.producto_um || 'unidad'}</td>
                    <td style="text-align: center;">21.00</td>
                    <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(precioUnitarioSinIva)}</td>
                    <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(subtotalMostrado)}</td>
                </tr>
            `;
        });

        // ✅ TOTALES: priorizar importes persistidos en cabecera de venta
        const subtotalCalculado = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
        const subtotal = Number.isFinite(parseFloat(venta.subtotal))
            ? parseFloat(venta.subtotal)
            : subtotalCalculado;
        const ivaTotal = Number.isFinite(parseFloat(venta.iva_total))
            ? parseFloat(venta.iva_total)
            : (ocultarIvaDiscriminado ? 0 : subtotal * 0.21);
        const total = Number.isFinite(parseFloat(venta.total))
            ? parseFloat(venta.total)
            : (subtotal + ivaTotal);

        const tableHeader = ocultarIvaDiscriminado
            ? `
                <thead>
                    <tr>
                        <th style="width: 10%;">Cantidad</th>
                        <th style="width: 50%;">Producto/Servicio/Detalle</th>
                        <th style="width: 20%;">Precio</th>
                        <th style="width: 20%;">Total</th>
                    </tr>
                </thead>
            `
            : undefined;

        const footerContent = this.construirFooterFacturaARCA({
            observacionesHTML,
            subtotal,
            ivaTotal,
            total,
            qrBase64,
            logoARCABase64,
            cae: venta.cae_id,
            fechaVencimientoCAE,
            esExento: ocultarIvaDiscriminado
        });

        const commonReplacements = {
            tipo_comprobante: tipoComprobante,
            codigo_comprobante: codigoComprobante,
            punto_venta: puntoVenta,
            numero_comprobante: numeroComprobante,
            fecha: fechaFormateada,
            cuit_emisor: process.env.AFIP_CUIT || '30714525030',
            ingresos_brutos: process.env.IIBB || '251491/4',
            fecha_inicio_actividades: process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016',
            telefono: process.env.EMPRESA_TELEFONO || '',
            email: process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com',
            cliente_cuit: venta.cliente_cuit || 'No informado',
            cliente_nombre: venta.cliente_nombre || 'No informado',
            cliente_condicion: venta.cliente_condicion || 'No informado',
            cliente_direccion: venta.cliente_direccion || 'No informado',
            observaciones_html: observacionesHTML,
            factura_asociada_tipo: facturaAsociadaTipo,
            factura_asociada_numero: facturaAsociadaNumero,
            factura_asociada_fecha: facturaAsociadaFecha,
            factura_asociada_total: facturaAsociadaTotal
        };

        const { html: finalHtml, pageCount } = await this.construirHtmlMultipaginaARCA({
            templatePath,
            commonReplacements,
            rowsByItem,
            footerContent,
            tableHeader
        });

        console.log(`📄 Generando PDF de Nota ARCA - Páginas: ${pageCount}`);
        return await this.generatePdfFromHtml(finalHtml);
    }

    /**
     * ✅ GENERAR NOTA GENÉRICA (X o sin CAE)
     */
    async generarNotaGenerica(venta, productos) {
        const esNotaDebito = venta.tipo_doc === 'NOTA_DEBITO';
        const templateName = esNotaDebito ? 'nota_debito.html' : 'nota_credito.html';
        const templatePath = path.join(this.templatesPath, templateName);
        
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Plantilla ${templateName} no encontrada`);
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
            console.log('📝 Observaciones incluidas en la nota genérica');
        } else {
            console.log('📝 Sin observaciones para mostrar en nota genérica');
        }
        
        htmlTemplate = htmlTemplate
            .replace(/{{fecha}}/g, fechaFormateada)
            .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
            .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado')
            .replace(/{{observaciones_html}}/g, observacionesHTML);

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
                    <td>${producto.producto_id || ''}</td>
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um || 'unidad'}</td>
                    <td style="text-align: center;">${cantidadFormateada}</td>
                    <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(productoPrecioIva)}</td>
                    <td style="text-align: right; white-space: nowrap;">${this.formatearMoneda(total)}</td>
                </tr>
            `;
        }).join('');
        
        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
        
        const totalNota = productos.reduce((acc, item) => {
            const subtotal = parseFloat(item.subtotal) || 0;
            const iva = parseFloat(item.iva || item.IVA) || 0;
            return acc + subtotal + iva;
        }, 0);

        const totalNotaMostrado = Number.isFinite(parseFloat(venta.total)) ? parseFloat(venta.total) : totalNota;
        htmlTemplate = htmlTemplate.replace(/{{total}}/g, this.formatearMoneda(totalNotaMostrado));

        return await this.generatePdfFromHtml(htmlTemplate);
    }
}

const pdfGenerator = new PdfGenerator();
module.exports = pdfGenerator;