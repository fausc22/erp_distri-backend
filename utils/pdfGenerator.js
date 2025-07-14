const htmlpdf = require('html-pdf-node');
const fs = require('fs');
const path = require('path');

class PdfGenerator {
    constructor() {
        this.templatesPath = path.join(__dirname, '../resources/documents');
    }

    // ✅ FORMATEAR FECHA
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

        return fecha.toLocaleDateString('es-AR', opciones); // Solo devuelve la parte de la fecha
    } catch (error) {
        console.error('Error formateando fecha:', error, 'Fecha original:', fechaBD);
        return 'Error en fecha';
    }
}



    // ✅ CONFIGURACIÓN INTELIGENTE (DESARROLLO vs PRODUCCIÓN)
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

        // ✅ CONFIGURACIÓN ESPECÍFICA PARA VPS/PRODUCCIÓN
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

        // ✅ CONFIGURACIÓN PARA DESARROLLO (Windows/Mac/Linux local)
        return {
            ...baseOptions,
            args: [
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            ...customOptions
        };
    }

    // ✅ FUNCIÓN GENÉRICA PARA GENERAR PDF
    async generatePdfFromHtml(htmlContent, options = {}) {
        try {
            const environment = process.env.NODE_ENV === 'production' ? 'PRODUCCIÓN' : 'DESARROLLO';
            console.log(`🔧 Generando PDF con html-pdf-node (${environment})...`);
            
            const pdfOptions = this.getOptions(options);
            const file = { content: htmlContent };
            
            const buffer = await htmlpdf.generatePdf(file, pdfOptions);
            
            console.log(`✅ PDF generado exitosamente en ${environment} - Tamaño: ${buffer.length} bytes`);
            return buffer;
            
        } catch (error) {
            console.error('❌ Error generando PDF:', error);
            
            // ✅ REINTENTO SOLO EN PRODUCCIÓN
            if (process.env.NODE_ENV === 'production') {
                console.log('🔄 Reintentando con configuración simplificada...');
                try {
                    const simpleOptions = {
                        format: 'A4',
                        args: ['--no-sandbox', '--disable-setuid-sandbox'],
                        timeout: 60000
                    };
                    
                    const file = { content: htmlContent };
                    const buffer = await htmlpdf.generatePdf(file, simpleOptions);
                    
                    console.log(`✅ PDF generado en segundo intento - Tamaño: ${buffer.length} bytes`);
                    return buffer;
                    
                } catch (retryError) {
                    console.error('❌ Error en segundo intento:', retryError);
                    throw retryError;
                }
            } else {
                throw error;
            }
        }
    }

    // ✅ GENERAR FACTURA
    async generarFactura(venta, productos) {
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


        const itemsHTML = productos.map(producto => {
            const subtotal = parseFloat(producto.subtotal) || 0;
            const iva = parseFloat(producto.iva || producto.IVA) || 0;
            const total = subtotal + iva;
            const productoPrecioIva = (total  / producto.cantidad) ;

            return `
                <tr>
                    <td>${producto.producto_id}</td>
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um}</td>
                    <td style="text-align: center;">${producto.cantidad}</td>
                    <td style="text-align: right;">$${productoPrecioIva.toFixed(2)}</td>
                    <td style="text-align: right;">$${total.toFixed(2)}</td>
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

    // ✅ GENERAR NOTA DE PEDIDO
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
                <td style="text-align: center;">${producto.cantidad || 0}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR LISTA DE PRECIOS
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

        const itemsHTML = productos.map(producto => {
            const precio = parseFloat(producto.precio_venta) || 0;
            const cantidad = parseInt(producto.cantidad) || 1;
            const subtotal = precio * cantidad;

            return `
                <tr>
                    <td>${producto.id}</td>
                    <td>${producto.nombre}</td>
                    <td>${producto.unidad_medida}</td>
                    <td>${cantidad}</td>
                    <td style="text-align: right;">$${precio.toFixed(2)}</td>
                    <td style="text-align: right;">$${subtotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR REMITO (CON DOBLE COPIA)
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
            .replace(/{{cliente_telefono}}/g, remito.cliente_telefono || 'No informado')
            

        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id}</td>
                <td>${producto.producto_nombre}</td>
                <td>${producto.producto_um}</td>
                <td style="text-align: center;">${producto.cantidad}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);

        // ✅ DUPLICAR EL REMITO (2 COPIAS)
        const htmlDoble = htmlTemplate + '<div style="page-break-before: always;"></div>' + htmlTemplate;

        return await this.generatePdfFromHtml(htmlDoble);
    }

    // ✅ GENERAR PDFs MÚLTIPLES
    async generarPDFsMultiples(documentos, tipo) {
        try {
            const htmlSections = [];

            for (const doc of documentos) {
                let htmlContent;
                
                switch (tipo) {
                    case 'facturas':
                        htmlContent = await this.generarFacturaHTML(doc.venta, doc.productos);
                        htmlSections.push(htmlContent);
                        break;
                        
                    case 'remitos':
                        // Para remitos: generar HTML y agregarlo 2 veces
                        const htmlRemito = await this.generarRemitoHTML(doc.remito, doc.productos);
                        htmlSections.push(htmlRemito); // Primera copia
                        htmlSections.push(htmlRemito); // Segunda copia
                        break;
                        
                    case 'notas_pedido':
                        htmlContent = await this.generarNotaPedidoHTML(doc.pedido, doc.productos);
                        htmlSections.push(htmlContent);
                        break;
                        
                    default:
                        throw new Error(`Tipo de documento no soportado: ${tipo}`);
                }
            }

            if (htmlSections.length === 0) {
                throw new Error('No se generaron secciones HTML');
            }

            const combinedHTML = htmlSections.join('<div style="page-break-before: always;"></div>');

            return await this.generatePdfFromHtml(combinedHTML, { timeout: 60000 });

        } catch (error) {
            console.error('❌ Error en generarPDFsMultiples:', error);
            throw error;
        }
    }

    // ✅ FUNCIONES HELPER PARA GENERAR SOLO HTML
    async generarFacturaHTML(venta, productos) {
        const templatePath = path.join(this.templatesPath, 'factura.html');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        const fechaFormateada = this.formatearFecha(venta.fecha);
        htmlTemplate = htmlTemplate
            .replace(/{{fecha}}/g, fechaFormateada)
            .replace(/{{cliente_nombre}}/g, venta.cliente_nombre || 'No informado')
            .replace(/{{cliente_direccion}}/g, venta.cliente_direccion || 'No informado');


        const itemsHTML = productos.map(producto => {
            const subtotal = parseFloat(producto.subtotal) || 0;
            const iva = parseFloat(producto.iva || producto.IVA) || 0;
            const total = subtotal + iva;
            const productoPrecioIva = (total  / producto.cantidad) ;

            return `
                <tr>
                    <td>${producto.producto_id}</td>
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um}</td>
                    <td style="text-align: center;">${producto.cantidad}</td>
                    <td style="text-align: right;">$${productoPrecioIva.toFixed(2)}</td>
                    <td style="text-align: right;">$${total.toFixed(2)}</td>
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
        
        return htmlTemplate;
    }

    async generarRemitoHTML(remito, productos) {
        const templatePath = path.join(this.templatesPath, 'remito.html');
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
            .replace(/{{cliente_telefono}}/g, remito.cliente_telefono || 'No informado')
            

        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id}</td>
                <td>${producto.producto_nombre}</td>
                <td>${producto.producto_um}</td>
                <td style="text-align: center;">${producto.cantidad}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
        
        return htmlTemplate;
    }

    async generarNotaPedidoHTML(pedido, productos) {
        const templatePath = path.join(this.templatesPath, 'nota_pedido2.html');
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
                <td style="text-align: center;">${producto.cantidad || 0}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace(/{{items}}/g, itemsHTML);
        
        return htmlTemplate;
    }
}

// ✅ EXPORTAR INSTANCIA ÚNICA
const pdfGenerator = new PdfGenerator();
module.exports = pdfGenerator;