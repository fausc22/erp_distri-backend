const pdf = require('html-pdf');
const fs = require('fs');
const path = require('path');

class PdfGenerator {
    constructor() {
        this.templatesPath = path.join(__dirname, '../resources/documents');
    }

    // ✅ FORMATEAR FECHA (mantener la misma lógica exacta)
    formatearFecha(fechaBD) {
        if (!fechaBD) return 'Fecha no disponible';
        
        try {
            const fecha = new Date(fechaBD);
            
            if (isNaN(fecha.getTime())) {
                console.warn('Fecha inválida recibida:', fechaBD);
                return 'Fecha inválida';
            }
            
            const dia = String(fecha.getDate()).padStart(2, '0');
            const mes = String(fecha.getMonth() + 1).padStart(2, '0');
            const año = fecha.getFullYear();
            
            const horas = String(fecha.getHours()).padStart(2, '0');
            const minutos = String(fecha.getMinutes()).padStart(2, '0');
            const segundos = String(fecha.getSeconds()).padStart(2, '0');
            
            return `${dia}/${mes}/${año} - ${horas}:${minutos}:${segundos}`;
            
        } catch (error) {
            console.error('Error formateando fecha:', error, 'Fecha original:', fechaBD);
            return 'Error en fecha';
        }
    }

    // ✅ FUNCIÓN GENÉRICA PARA GENERAR PDF DESDE HTML
    async generatePdfFromHtml(htmlContent, options = {}) {
        const defaultOptions = {
            format: 'A4',
            border: {
                top: '10mm',
                right: '8mm',
                bottom: '10mm',
                left: '8mm'
            },
            timeout: 30000,
            quality: "75",
            type: "pdf"
        };

        const pdfOptions = { ...defaultOptions, ...options };

        return new Promise((resolve, reject) => {
            pdf.create(htmlContent, pdfOptions).toBuffer((err, buffer) => {
                if (err) {
                    console.error('❌ Error generando PDF:', err);
                    reject(err);
                } else {
                    resolve(buffer);
                }
            });
        });
    }

    // ✅ GENERAR FACTURA (usando tu plantilla factura.html)
    async generarFactura(venta, productos) {
        const templatePath = path.join(this.templatesPath, 'factura.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla factura.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar datos de la venta
        const fechaFormateada = this.formatearFecha(venta.fecha);
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', fechaFormateada)
            .replace('{{cliente_nombre}}', venta.cliente_nombre || 'No informado');

        // Generar filas de productos
        const itemsHTML = productos.map(producto => {
            const subtotal = parseFloat(producto.subtotal) || 0;
            const iva = parseFloat(producto.iva || producto.IVA) || 0;
            const total = subtotal + iva;

            return `
                <tr>
                    <td>${producto.producto_id}</td>
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um}</td>
                    <td>${producto.cantidad}</td>
                    <td style="text-align: right;">$${parseFloat(producto.precio).toFixed(2)}</td>
                    <td style="text-align: right;">$${total.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);

        // Calcular y reemplazar total
        const totalFactura = productos.reduce((acc, item) => {
            const subtotal = parseFloat(item.subtotal) || 0;
            const iva = parseFloat(item.iva || item.IVA) || 0;
            return acc + subtotal + iva;
        }, 0);

        htmlTemplate = htmlTemplate.replace('{{total}}', venta.total || totalFactura.toFixed(2));

        // Generar PDF
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR NOTA DE PEDIDO (usando tu plantilla nota_pedido2.html)
    async generarNotaPedido(pedido, productos) {
        const templatePath = path.join(this.templatesPath, 'nota_pedido2.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla nota_pedido2.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar datos del pedido
        const fechaFormateada = this.formatearFecha(pedido.fecha);
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', fechaFormateada)
            .replace('{{id}}', pedido.id)
            .replace('{{cliente_nombre}}', pedido.cliente_nombre)
            .replace('{{cliente_direccion}}', pedido.cliente_direccion || 'No informado')
            .replace('{{cliente_telefono}}', pedido.cliente_telefono || 'No informado')
            .replace('{{empleado_nombre}}', pedido.empleado_nombre || 'No informado')
            .replace('{{pedido_observacion}}', pedido.observaciones || 'No informado');

        // Generar filas de productos
        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id || ''}</td>
                <td>${producto.producto_nombre || ''}</td>
                <td>${producto.producto_descripcion || ''}</td>
                <td>${producto.producto_um || ''}</td>
                <td style="text-align: right;">${producto.cantidad || 0}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);

        // Generar PDF con opciones específicas para nota de pedido
        return await this.generatePdfFromHtml(htmlTemplate, {
            format: 'A4',
            border: {
                top: '8mm',
                right: '6mm',
                bottom: '8mm',
                left: '6mm'
            }
        });
    }

    // ✅ GENERAR LISTA DE PRECIOS (usando tu plantilla lista_precio.html)
    async generarListaPrecios(cliente, productos) {
        const templatePath = path.join(this.templatesPath, 'lista_precio.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Plantilla lista_precio.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar datos del cliente
        const fechaActual = this.formatearFecha(new Date());
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', fechaActual)
            .replace('{{cliente_nombre}}', cliente.nombre || 'No informado')
            .replace('{{cliente_cuit}}', cliente.cuit || 'No informado')
            .replace('{{cliente_cativa}}', cliente.condicion_iva || 'No informado');

        // Generar filas de productos
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

        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);

        // Generar PDF
        return await this.generatePdfFromHtml(htmlTemplate);
    }

    // ✅ GENERAR REMITO (usando tu plantilla remito.html)
    async generarRemito(remito, productos) {
        const templatePath = path.join(this.templatesPath, 'remito.html');
        
        if (!fs.existsExists(templatePath)) {
            throw new Error('Plantilla remito.html no encontrada');
        }

        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');
        
        // Reemplazar datos del remito
        const fechaFormateada = this.formatearFecha(remito.fecha);
        htmlTemplate = htmlTemplate
            .replace('{{fecha}}', fechaFormateada)
            .replace('{{cliente_nombre}}', remito.cliente_nombre || 'No informado')
            .replace('{{cliente_cuit}}', remito.cliente_cuit || 'No informado')
            .replace('{{cliente_cativa}}', remito.cliente_condicion || 'No informado')
            .replace('{{cliente_direccion}}', remito.cliente_direccion || 'No informado')
            .replace('{{cliente_ciudad}}', remito.cliente_ciudad || 'No informado')
            .replace('{{cliente_provincia}}', remito.cliente_provincia || 'No informado')
            .replace('{{cliente_telefono}}', remito.cliente_telefono || 'No informado')
            .replace('{{observacion}}', remito.observaciones || 'Sin observaciones');

        // Generar filas de productos
        const itemsHTML = productos.map(producto => `
            <tr>
                <td>${producto.producto_id}</td>
                <td>${producto.producto_nombre}</td>
                <td>${producto.producto_um}</td>
                <td>${producto.cantidad}</td>
            </tr>
        `).join('');

        htmlTemplate = htmlTemplate.replace('{{items}}', itemsHTML);

        // Generar PDF con opciones específicas para remito
        return await this.generatePdfFromHtml(htmlTemplate, {
            format: 'A4',
            border: {
                top: '8mm',
                right: '6mm',
                bottom: '8mm',
                left: '6mm'
            }
        });
    }
}

// ✅ EXPORTAR INSTANCIA ÚNICA
const pdfGenerator = new PdfGenerator();
module.exports = pdfGenerator;