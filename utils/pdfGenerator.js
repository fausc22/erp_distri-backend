const htmlpdf = require('html-pdf-node');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
        const isVPS = process.platform === 'linux' && isProduction;
        
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

        if (isVPS) {
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

        return {
            ...baseOptions,
            args: [
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            ...customOptions
        };
    }

    async generatePdfFromHtml(htmlContent, options = {}) {
        try {
            const environment = process.env.NODE_ENV === 'production' ? 'PRODUCCIÓN' : 'DESARROLLO';
            console.log(`🔧 Generando PDF con html-pdf-node (${environment})...`);
            
            const pdfOptions = this.getOptions(options);
            const file = { content: htmlContent };
            const buffer = await htmlpdf.generatePdf(file, pdfOptions);
            
            console.log(`✅ PDF generado exitosamente - Tamaño: ${buffer.length} bytes`);
            return buffer;
            
        } catch (error) {
            console.error('❌ Error generando PDF:', error);
            
            if (process.env.NODE_ENV === 'production') {
                console.log('🔄 Reintentando con configuración simplificada...');
                const simpleOptions = {
                    format: 'A4',
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                    timeout: 60000
                };
                const file = { content: htmlContent };
                const buffer = await htmlpdf.generatePdf(file, simpleOptions);
                console.log(`✅ PDF generado en segundo intento`);
                return buffer;
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
            console.log(`🔍 Solicitando QR al microservicio ARCA para venta ${venta.id}...`);
            
            const tipoComprobanteMap = { 'A': 1, 'B': 6, 'C': 11 };
            const tipoComprobante = tipoComprobanteMap[venta.tipo_f] || 6;
            let tipoDocReceptor = 99;
            if (venta.cliente_cuit) {
                tipoDocReceptor = 80;
            }

            const response = await axios.post(
                `${ARCA_MICROSERVICE_URL}/api/generar-qr`, 
                {
                    cae: venta.cae_id,
                    tipoComprobante: tipoComprobante,
                    puntoVenta: 1,
                    numeroComprobante: venta.id,
                    fechaEmision: venta.fecha,
                    total: venta.total,
                    cuitEmisor: process.env.AFIP_CUIT || '20409378472',
                    cuitReceptor: venta.cliente_cuit || '0',
                    tipoDocReceptor: tipoDocReceptor
                }, 
                { timeout: 5000 }
            );

            if (response.data && response.data.qrBase64) {
                console.log('✅ QR obtenido del microservicio ARCA');
                return response.data.qrBase64;
            }

            throw new Error('No se recibió QR del microservicio');
            
        } catch (error) {
            console.warn('⚠️ Error obteniendo QR desde ARCA:', error.message);
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        }
    }

    // ✅ FUNCIÓN PRINCIPAL MEJORADA: DETECTAR QUÉ FACTURA USAR SEGÚN TIPO_F
    async generarFactura(venta, productos) {
        const tipoFiscal = (venta.tipo_f || '').toString().trim().toUpperCase();
        
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
            // ✅ Facturas C o cualquier otro tipo → Genérica (factura.html)
            console.log(`📋 Generando Factura Genérica tipo ${tipoFiscal}`);
            return await this.generarFacturaGenerica(venta, productos);
        }
    }

    // ✅ GENERAR FACTURA ARCA (A y B) - PRECIOS SIN IVA
    async generarFacturaARCA(venta, productos) {
        const templatePath = path.join(this.templatesPath, 'factura_arca.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla factura_arca.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        console.log('📱 Generando QR...');
        const qrBase64 = await this.generarQRDesdeARCA(venta);
        const logoARCABase64 = this.obtenerLogoARCABase64();

        const tipoComprobante = venta.tipo_f || 'B';
        const fechaFormateada = this.formatearFecha(venta.fecha);
        const fechaVencimientoCAE = this.formatearFecha(venta.cae_fecha);
        
        htmlTemplate = htmlTemplate
            .replace(/{{tipo_comprobante}}/g, tipoComprobante)
            .replace(/{{punto_venta}}/g, String(1).padStart(4, '0'))
            .replace(/{{numero_comprobante}}/g, String(venta.id).padStart(8, '0'))
            .replace(/{{fecha}}/g, fechaFormateada)
            .replace(/{{cuit_emisor}}/g, process.env.AFIP_CUIT || '30714525030')
            .replace(/{{ingresos_brutos}}/g, process.env.IIBB || '251491/4')
            .replace(/{{fecha_inicio_actividades}}/g, process.env.EMPRESA_INICIO_ACTIVIDADES || '01/02/2016')
            .replace(/{{telefono}}/g, process.env.EMPRESA_TELEFONO || '')
            .replace(/{{email}}/g, process.env.EMPRESA_EMAIL || 'vertimar@hotmail.com')
            .replace(/{{cliente_cuit}}/g, venta.cliente_cuit || 'No informado')
            .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
            .replace(/{{cliente_condicion}}/g, venta.cliente_condicion || 'No informado')
            .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado');

        // ✅ ITEMS SIN IVA - PRECIOS Y TOTALES SIN IVA
        const itemsHTML = productos.map(producto => {
            const cantidad = parseFloat(producto.cantidad) || 0;
            const subtotal = parseFloat(producto.subtotal) || 0; // Sin IVA
            const precioUnitarioSinIva = cantidad > 0 ? (subtotal / cantidad) : 0;
            const cantidadFormateada = this.formatearCantidad(cantidad);

            return `
                <tr>
                    <td style="text-align: center;">${cantidadFormateada}</td>
                    <td>${producto.producto_nombre} - ${producto.producto_um}</td>
                    <td style="text-align: center;">21.00</td>
                    <td style="text-align: right;">${precioUnitarioSinIva.toFixed(2)}</td>
                    <td style="text-align: right;">${subtotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // ✅ CALCULAR TOTALES: SUBTOTAL (sin IVA) + IVA 21%
        const subtotal = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
        const ivaTotal = subtotal * 0.21; // IVA 21% sobre el neto
        const total = subtotal + ivaTotal;

        htmlTemplate = htmlTemplate
            .replace(/{{subtotal}}/g, subtotal.toFixed(2))
            .replace(/{{iva_total}}/g, ivaTotal.toFixed(2))
            .replace(/{{total}}/g, total.toFixed(2))
            .replace(/{{qr_base64}}/g, qrBase64)
            .replace(/{{logo_arca}}/g, logoARCABase64)
            .replace(/{{cae}}/g, venta.cae_id)
            .replace(/{{cae_vencimiento}}/g, fechaVencimientoCAE);

        console.log('📄 Generando PDF de Factura ARCA...');
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