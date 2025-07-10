const htmlPdf = require('html-pdf-node');
const fs = require('fs');
const path = require('path');

class PDFGeneratorOptimized {
    constructor() {
        this.templatesPath = path.join(__dirname, '../resources/documents');
    }

    // Formatear fecha igual que antes
    formatearFecha(fechaBD) {
        if (!fechaBD) return 'Fecha no disponible';
        
        try {
            const fecha = new Date(fechaBD);
            if (isNaN(fecha.getTime())) return 'Fecha inválida';
            
            const dia = String(fecha.getDate()).padStart(2, '0');
            const mes = String(fecha.getMonth() + 1).padStart(2, '0');
            const año = fecha.getFullYear();
            const horas = String(fecha.getHours()).padStart(2, '0');
            const minutos = String(fecha.getMinutes()).padStart(2, '0');
            const segundos = String(fecha.getSeconds()).padStart(2, '0');
            
            return `${dia}/${mes}/${año} - ${horas}:${minutos}:${segundos}`;
        } catch (error) {
            return 'Error en fecha';
        }
    }

    // ✅ GENERAR PDF MANTENIENDO DISEÑO EXACTO
    async generatePdfFromHtml(htmlContent) {
        const options = {
            format: 'A4',
            border: {
                top: "8mm",
                right: "6mm",
                bottom: "8mm",
                left: "6mm"
            },
            type: 'pdf',
            quality: '75',
            timeout: 30000,
            httpHeaders: {},
            // Optimizaciones para velocidad
            zoomFactor: 1,
            javascriptEnabled: false,
            waitForJS: false,
            waitForNetworkIdle: false
        };

        const file = { content: htmlContent };
        
        try {
            const pdfBuffer = await htmlPdf.generatePdf(file, options);
            return pdfBuffer;
        } catch (error) {
            console.error('Error generando PDF:', error);
            throw error;
        }
    }

    // ✅ GENERAR FACTURA (usando plantilla HTML exacta)
    async generarFactura(venta, productos) {
        const templatePath = path.join(this.templatesPath, 'factura.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla HTML de factura no encontrada en: ' + templatePath);
        }
        
        console.log('📄 Leyendo plantilla de factura...');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // ✅ REEMPLAZAR PLACEHOLDERS EXACTAMENTE IGUAL QUE ANTES
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', this.formatearFecha(venta.fecha))
            .replace('{{cliente_nombre}}', venta.cliente_nombre);
        
        // ✅ GENERAR HTML DE PRODUCTOS EXACTAMENTE IGUAL
        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id}</td>
                <td>${producto.producto_nombre}</td>
                <td>${producto.producto_um}</td>
                <td>${producto.cantidad}</td>
                <td style="text-align: right;">$${parseFloat(producto.precio).toFixed(2)}</td>
                <td style="text-align: right;">$${(parseFloat(producto.subtotal || 0) + parseFloat(producto.iva || producto.IVA || 0)).toFixed(2)}</td>
            </tr>
        `).join('');
        
        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
        
        // ✅ CALCULAR TOTALES EXACTAMENTE IGUAL
        const subtotalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0).toFixed(2);
        const ivaPdf = productos.reduce((acc, item) => acc + (parseFloat(item.iva) || 0), 0).toFixed(2);
        const totalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0) + (parseFloat(item.iva) || 0), 0).toFixed(2);

        htmlTemplate = htmlTemplate.replace('{{total}}', totalPdf);
        
        console.log('📄 Generando PDF de factura...');
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR REMITO (usando plantilla HTML exacta)
    async generarRemito(remito, productos) {
        const templatePath = path.join(this.templatesPath, 'remito.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla HTML de remito no encontrada en: ' + templatePath);
        }
        
        console.log('📄 Leyendo plantilla de remito...');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // ✅ REEMPLAZAR PLACEHOLDERS EXACTAMENTE IGUAL QUE ANTES
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', this.formatearFecha(remito.fecha))
            .replace('{{cliente_nombre}}', remito.cliente_nombre)
            .replace('{{cliente_cuit}}', remito.cliente_cuit || 'No informado')
            .replace('{{cliente_cativa}}', remito.cliente_condicion || 'No informado')
            .replace('{{cliente_direccion}}', remito.cliente_direccion || 'No informado')
            .replace('{{cliente_ciudad}}', remito.cliente_ciudad || 'No informado')
            .replace('{{cliente_provincia}}', remito.cliente_provincia || 'No informado')
            .replace('{{cliente_telefono}}', remito.cliente_telefono || 'No informado')
            .replace('{{observacion}}', remito.observaciones || 'Sin Observaciones');
        
        // ✅ GENERAR HTML DE PRODUCTOS EXACTAMENTE IGUAL
        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id}</td>
                <td>${producto.producto_nombre}</td>
                <td>${producto.producto_um}</td>
                <td>${producto.cantidad}</td>
            </tr>
        `).join('');
        
        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
        
        // ✅ CORREGIDO: GENERAR 2 COPIAS DEL REMITO (como en múltiples)
        const dosCopias = htmlTemplate + '<div style="page-break-before: always;"></div>' + htmlTemplate;
        
        console.log('📄 Generando PDF de remito con 2 copias...');
        return await this.generatePdfFromHtml(dosCopias);
    }

    // ✅ GENERAR NOTA DE PEDIDO (usando plantilla HTML exacta)
    async generarNotaPedido(pedido, productos) {
        const templatePath = path.join(this.templatesPath, 'nota_pedido2.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla HTML de nota de pedido no encontrada en: ' + templatePath);
        }
        
        console.log('📄 Leyendo plantilla de nota de pedido...');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // ✅ REEMPLAZAR PLACEHOLDERS EXACTAMENTE IGUAL QUE ANTES
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', this.formatearFecha(pedido.fecha))
            .replace('{{id}}', pedido.id)
            .replace('{{cliente_nombre}}', pedido.cliente_nombre)
            .replace('{{cliente_direccion}}', pedido.cliente_direccion || 'No informado')
            .replace('{{cliente_telefono}}', pedido.cliente_telefono || 'No informado')
            .replace('{{empleado_nombre}}', pedido.empleado_nombre || 'No informado')
            .replace('{{pedido_observacion}}', pedido.observaciones || 'sin observaciones');
        
        // ✅ GENERAR HTML DE PRODUCTOS EXACTAMENTE IGUAL
        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id || ''}</td>
                <td>${producto.producto_nombre || ''}</td>
                <td>${producto.producto_descripcion || ''}</td>
                <td>${producto.producto_um || ''}</td>
                <td class="text-right">${producto.cantidad || 0}</td>
            </tr>
        `).join('');
        
        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
        
        console.log('📄 Generando PDF de nota de pedido...');
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR LISTA DE PRECIOS (usando plantilla HTML exacta)
    async generarListaPrecios(cliente, productos) {
    const templatePath = path.join(this.templatesPath, 'lista_precio.html');
    
    if (!fs.existsSync(templatePath)) {
        throw new Error('Plantilla HTML de lista de precios no encontrada en: ' + templatePath);
    }
    
    console.log('📄 Leyendo plantilla de lista de precios...');
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
    
    // ✅ REEMPLAZAR TODOS LOS PLACEHOLDERS
    htmlTemplate = htmlTemplate
        .replace('{{fecha}}', this.formatearFecha(new Date()))
        .replace('{{cliente_nombre}}', cliente.nombre || 'No informado')
        .replace('{{cliente_cuit}}', cliente.cuit || 'No informado')
        .replace('{{cliente_cativa}}', cliente.categoria_iva || cliente.condicion_iva || 'No informado');
    
    // ✅ GENERAR HTML DE PRODUCTOS EXACTAMENTE IGUAL
    const itemsHTML = productos.map(producto => `
        <tr>
            <td>${producto.id}</td>
            <td>${producto.nombre}</td>
            <td>${producto.unidad_medida}</td>
            <td>${producto.cantidad}</td>
            <td style="text-align: right;">$${parseFloat(producto.precio).toFixed(2)}</td>
            
            <td style="text-align: right;">$${(parseFloat(producto.subtotal || 0) + parseFloat(producto.iva || producto.IVA || 0)).toFixed(2)}</td>
        </tr>
    `).join('');
    
    htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
    
    console.log('📄 Generando PDF de lista de precios...');
    return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR PDFs MÚLTIPLES (combinando HTML)
    async generarPDFsMultiples(documentos, tipo) {
        console.log(`📄 Generando ${documentos.length} PDFs múltiples del tipo: ${tipo}...`);
        
        const htmlSections = [];
        
        for (let i = 0; i < documentos.length; i++) {
            const doc = documentos[i];
            let templatePath;
            let htmlTemplate;
            
            // Determinar plantilla según tipo
            switch (tipo) {
                case 'facturas':
                    templatePath = path.join(this.templatesPath, 'factura.html');
                    break;
                case 'remitos':
                    templatePath = path.join(this.templatesPath, 'remito.html');
                    break;
                case 'notas_pedido':
                    templatePath = path.join(this.templatesPath, 'nota_pedido2.html');
                    break;
                default:
                    throw new Error(`Tipo de documento no soportado: ${tipo}`);
            }
            
            if (!fs.existsSync(templatePath)) {
                console.warn(`Plantilla no encontrada: ${templatePath}, saltando...`);
                continue;
            }
            
            htmlTemplate = fs.readFileSync(templatePath, 'utf8');
            
            // Procesar según tipo
            switch (tipo) {
                case 'facturas':
                    htmlTemplate = this.procesarFacturaTemplate(htmlTemplate, doc.venta, doc.productos);
                    break;
                case 'remitos':
                    htmlTemplate = this.procesarRemitoTemplate(htmlTemplate, doc.remito, doc.productos);
                    break;
                case 'notas_pedido':
                    htmlTemplate = this.procesarNotaPedidoTemplate(htmlTemplate, doc.pedido, doc.productos);
                    break;
            }
            
            htmlSections.push(htmlTemplate);
        }
        
        if (htmlSections.length === 0) {
            throw new Error('No se pudieron procesar documentos para PDFs múltiples');
        }
        
        // ✅ COMBINAR TODAS LAS SECCIONES CON SALTO DE PÁGINA
        const combinedHTML = htmlSections.join('<div style="page-break-before: always;"></div>');
        
        console.log('📄 Generando PDF múltiple combinado...');
        return await this.generatePdfFromHtml(combinedHTML);
    }

    // ✅ MÉTODOS AUXILIARES PARA PROCESAR TEMPLATES
    procesarFacturaTemplate(htmlTemplate, venta, productos) {
    htmlTemplate = htmlTemplate
        .replace('{{fecha}}', this.formatearFecha(venta.fecha))
        .replace('{{cliente_nombre}}', venta.cliente_nombre);
    
    const itemsHTML = productos.map(producto => `
        <tr>
            <td>${producto.producto_id}</td>
            <td>${producto.producto_nombre}</td>
            <td>${producto.producto_um}</td>
            <td>${producto.cantidad}</td>
            <td style="text-align: right;">$${parseFloat(producto.precio).toFixed(2)}</td>
            <td style="text-align: right;">$${parseFloat(producto.subtotal).toFixed(2)}</td>
        </tr>
    `).join('');
    
    htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
    
    // ✅ CÁLCULO CORRECTO: IGUAL QUE EN FACTURAS INDIVIDUALES
    const subtotalPdf = productos.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0);
    const ivaPdf = productos.reduce((acc, item) => acc + (parseFloat(item.iva) || 0), 0);
    const totalPdf = (subtotalPdf + ivaPdf).toFixed(2);
    
    console.log(`💰 Factura múltiple - Subtotal: ${subtotalPdf}, IVA: ${ivaPdf}, Total: ${totalPdf}`);
    
    return htmlTemplate.replace('{{total}}', totalPdf);
    }
    

    procesarRemitoTemplate(htmlTemplate, remito, productos) {
    htmlTemplate = htmlTemplate
        .replace('{{fecha}}', this.formatearFecha(remito.fecha))
        .replace('{{cliente_nombre}}', remito.cliente_nombre)
        .replace('{{cliente_cuit}}', remito.cliente_cuit || 'No informado')
        .replace('{{cliente_cativa}}', remito.cliente_condicion || 'No informado')
        .replace('{{cliente_direccion}}', remito.cliente_direccion || 'No informado')
        .replace('{{cliente_ciudad}}', remito.cliente_ciudad || 'No informado')
        .replace('{{cliente_provincia}}', remito.cliente_provincia || 'No informado')
        .replace('{{cliente_telefono}}', remito.cliente_telefono || 'No informado')
        .replace('{{observacion}}', remito.observaciones || 'Sin Observaciones');
    
    const itemsHTML = productos.map(producto => `
        <tr>
            <td>${producto.producto_id}</td>
            <td>${producto.producto_nombre}</td>
            <td>${producto.producto_um}</td>
            <td>${producto.cantidad}</td>
        </tr>
    `).join('');
    
    htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);
    
    // ✅ AGREGAR DOBLE COPIA IGUAL QUE EN REMITO INDIVIDUAL
    const dosCopias = htmlTemplate + '<div style="page-break-before: always;"></div>' + htmlTemplate;
    
    return dosCopias;
    }

    procesarNotaPedidoTemplate(htmlTemplate, pedido, productos) {
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', this.formatearFecha(pedido.fecha))
            .replace('{{id}}', pedido.id)
            .replace('{{cliente_nombre}}', pedido.cliente_nombre)
            .replace('{{cliente_direccion}}', pedido.cliente_direccion || 'No informado')
            .replace('{{cliente_telefono}}', pedido.cliente_telefono || 'No informado')
            .replace('{{empleado_nombre}}', pedido.empleado_nombre || 'No informado')
            .replace('{{pedido_observacion}}', pedido.observaciones || 'sin observaciones');
        
        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id || ''}</td>
                <td>${producto.producto_nombre || ''}</td>
                <td>${producto.producto_descripcion || ''}</td>
                <td>${producto.producto_um || ''}</td>
                <td class="text-right">${producto.cantidad || 0}</td>
            </tr>
        `).join('');
        
        return htmlTemplate.replace('{{items}}', itemsHTML);
    }
}

module.exports = new PDFGeneratorOptimized();