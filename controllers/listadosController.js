const db = require('./db');
const pdfGenerator = require('../utils/pdfGenerator');
const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');

// Función auxiliar para convertir consultas callback a promesas
const queryPromise = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

// Generar PDF del Libro IVA
const generarPdfLibroIva = async (req, res) => {
    const { mes, anio } = req.body;

    if (!mes || !anio) {
        return res.status(400).json({ error: "Debe especificar mes y año" });
    }

    try {
        console.log(`📄 Generando Libro IVA para ${mes}/${anio}...`);
        const startTime = Date.now();

        // Calcular rango de fechas para el mes seleccionado
        const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const ultimoDia = new Date(anio, mes, 0).getDate(); // Obtiene último día del mes
        const ultimaFecha = `${anio}-${String(mes).padStart(2, '0')}-${ultimoDia}`;

        // Consulta SQL para obtener ventas tipo A y B del mes
        const query = `
            SELECT
                v.id,
                v.fecha,
                v.numero_factura,
                v.tipo_f,
                v.cliente_nombre,
                v.cliente_cuit,
                v.subtotal,
                v.iva_total,
                v.total
            FROM ventas v
            WHERE DATE(v.fecha) BETWEEN ? AND ?
                AND (v.tipo_f = 'A' OR v.tipo_f = 'B')
            ORDER BY v.fecha ASC, v.numero_factura ASC
        `;

        const ventas = await queryPromise(query, [primerDia, ultimaFecha]);

        console.log(`📊 Se encontraron ${ventas.length} ventas para el período`);

        if (ventas.length === 0) {
            return res.status(404).json({
                error: "No se encontraron ventas tipo A o B para el período seleccionado"
            });
        }

        // Formatear datos para el PDF
        const ventasFormateadas = ventas.map(venta => ({
            fecha: venta.fecha,
            comprobante: venta.tipo_f === 'A' ? 'FACTURA A' : 'FACTURA B',
            numero: venta.numero_factura || '-',
            cliente: venta.cliente_nombre || 'Sin nombre',
            cuit: venta.cliente_cuit || '-',
            neto: parseFloat(venta.subtotal) || 0,
            exento: 0, // Siempre 0 según especificación
            iva: parseFloat(venta.iva_total) || 0,
            percepciones: 0, // Siempre 0 según especificación
            retenciones: 0, // Siempre 0 según especificación
            total: parseFloat(venta.total) || 0
        }));

        // Calcular totales
        const totales = ventasFormateadas.reduce((acc, venta) => ({
            neto: acc.neto + venta.neto,
            exento: acc.exento + venta.exento,
            iva: acc.iva + venta.iva,
            percepciones: acc.percepciones + venta.percepciones,
            retenciones: acc.retenciones + venta.retenciones,
            total: acc.total + venta.total
        }), { neto: 0, exento: 0, iva: 0, percepciones: 0, retenciones: 0, total: 0 });

        // Generar PDF usando el generador con la plantilla
        const pdfBuffer = await pdfGenerator.generarLibroIva({
            mes,
            anio,
            ventas: ventasFormateadas,
            totales
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Libro IVA generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Libro IVA generado - ${mes}/${anio} - ${ventas.length} registros en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Libro_IVA_${mes}_${anio}.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Libro IVA enviado exitosamente');

    } catch (error) {
        console.error("❌ Error generando Libro IVA:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Error generando Libro IVA: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar el Libro IVA",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Generar PDF de Lista de Precios (filtrado por categorías)
const generarPdfListaPrecios = async (req, res) => {
    const { categorias } = req.body; // Array de IDs de categorías seleccionadas (opcional)

    try {
        console.log('📄 Generando Lista de Precios...');
        const startTime = Date.now();

        let query = `
            SELECT
                p.id,
                p.nombre,
                p.precio,
                p.iva,
                p.unidad_medida,
                c.nombre as categoria_nombre,
                c.id as categoria_id
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
            WHERE p.stock_actual > 0
        `;

        let params = [];

        // Filtrar por categorías si se proporcionaron
        if (categorias && categorias.length > 0) {
            query += ` AND p.categoria_id IN (?)`;
            params.push(categorias);
        }

        query += ` ORDER BY c.nombre ASC, p.nombre ASC`;

        const productos = await queryPromise(query, params);

        console.log(`📦 Se encontraron ${productos.length} productos`);

        if (productos.length === 0) {
            return res.status(404).json({
                error: "No se encontraron productos con stock"
            });
        }

        // Agrupar productos por categoría
        const productosPorCategoria = productos.reduce((acc, producto) => {
            const categoriaNombre = producto.categoria_nombre || 'Sin Categoría';
            if (!acc[categoriaNombre]) {
                acc[categoriaNombre] = [];
            }

            // Calcular precio con IVA
            const precioBase = parseFloat(producto.precio) || 0;
            const iva = parseFloat(producto.iva) || 21.00;
            const precioConIva = precioBase * (1 + iva / 100);

            acc[categoriaNombre].push({
                id: producto.id,
                nombre: producto.nombre,
                unidad_medida: producto.unidad_medida || 'Unidad',
                precio: precioBase,
                iva: iva,
                precio_con_iva: precioConIva
            });
            return acc;
        }, {});

        // Ordenar categorías alfabéticamente
        const categoriasOrdenadas = Object.keys(productosPorCategoria).sort();

        // Generar PDF usando el generador con la plantilla
        const pdfBuffer = await pdfGenerator.generarListaPreciosCategorias({
            categorias: categoriasOrdenadas,
            productosPorCategoria
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Lista de Precios generada en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Lista de Precios generada - ${productos.length} productos en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Lista_Precios_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Lista de Precios enviada exitosamente');

    } catch (error) {
        console.error("❌ Error generando Lista de Precios:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Error generando Lista de Precios: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar la Lista de Precios",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Generar PDF de Control de Stock por filtro (menor/mayor stock)
const generarPdfControlStockFiltro = async (req, res) => {
    const { tipo, cantidad } = req.body; // tipo: 'menor' o 'mayor', cantidad: número de productos

    if (!tipo || !cantidad) {
        return res.status(400).json({ error: "Debe especificar tipo y cantidad" });
    }

    if (!['menor', 'mayor'].includes(tipo)) {
        return res.status(400).json({ error: "Tipo debe ser 'menor' o 'mayor'" });
    }

    try {
        console.log(`📄 Generando Control de Stock (${tipo} stock) para ${cantidad} productos...`);
        const startTime = Date.now();

        // Consulta SQL para obtener productos con menor o mayor stock
        const orderDirection = tipo === 'menor' ? 'ASC' : 'DESC';
        const query = `
            SELECT
                p.id,
                p.nombre,
                p.unidad_medida,
                p.stock_actual,
                c.nombre as categoria_nombre
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
            ORDER BY p.stock_actual ${orderDirection}
            LIMIT ?
        `;

        const productos = await queryPromise(query, [parseInt(cantidad)]);

        console.log(`📦 Se encontraron ${productos.length} productos`);

        if (productos.length === 0) {
            return res.status(404).json({
                error: "No se encontraron productos"
            });
        }

        // Agrupar productos por categoría
        const productosPorCategoria = productos.reduce((acc, producto) => {
            const categoriaNombre = producto.categoria_nombre || 'Sin Categoría';
            if (!acc[categoriaNombre]) {
                acc[categoriaNombre] = [];
            }

            acc[categoriaNombre].push({
                id: producto.id,
                nombre: producto.nombre,
                unidad_medida: producto.unidad_medida || 'Unidad',
                stock_actual: parseFloat(producto.stock_actual) || 0
            });
            return acc;
        }, {});

        // Ordenar categorías alfabéticamente
        const categoriasOrdenadas = Object.keys(productosPorCategoria).sort();

        // Generar PDF usando el generador con la plantilla
        const pdfBuffer = await pdfGenerator.generarControlStock({
            tipo,
            cantidad,
            categorias: categoriasOrdenadas,
            productosPorCategoria
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Control de Stock generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Control de Stock generado - ${tipo} stock - ${productos.length} productos en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Control_Stock_${tipo}_${cantidad}_productos.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Control de Stock enviado exitosamente');

    } catch (error) {
        console.error("❌ Error generando Control de Stock:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Error generando Control de Stock: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar el Control de Stock",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Generar PDF de Control de Stock por selección manual
const generarPdfControlStockSeleccion = async (req, res) => {
    const { productos } = req.body; // Array de productos seleccionados

    if (!productos || productos.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un producto" });
    }

    try {
        console.log(`📄 Generando Control de Stock para ${productos.length} productos seleccionados...`);
        const startTime = Date.now();

        // Agrupar productos por categoría
        const productosPorCategoria = productos.reduce((acc, producto) => {
            const categoriaNombre = producto.categoria_nombre || 'Sin Categoría';
            if (!acc[categoriaNombre]) {
                acc[categoriaNombre] = [];
            }

            acc[categoriaNombre].push({
                id: producto.id,
                nombre: producto.nombre,
                unidad_medida: producto.unidad_medida || 'Unidad',
                stock_actual: parseFloat(producto.stock_actual) || 0
            });
            return acc;
        }, {});

        // Ordenar categorías alfabéticamente
        const categoriasOrdenadas = Object.keys(productosPorCategoria).sort();

        // Generar PDF usando el generador con la plantilla
        const pdfBuffer = await pdfGenerator.generarControlStock({
            tipo: 'seleccion',
            cantidad: productos.length,
            categorias: categoriasOrdenadas,
            productosPorCategoria
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Control de Stock generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Control de Stock generado - selección manual - ${productos.length} productos en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Control_Stock_Seleccion_${productos.length}_productos.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Control de Stock enviado exitosamente');

    } catch (error) {
        console.error("❌ Error generando Control de Stock:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Error generando Control de Stock: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar el Control de Stock",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    generarPdfLibroIva,
    generarPdfListaPrecios,
    generarPdfControlStockFiltro,
    generarPdfControlStockSeleccion
};
