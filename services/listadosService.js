const db = require('../db/legacyAdapter');
const pdfGenerator = require('../utils/pdfGenerator');
const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');
const { resolvePorcentajeIva } = require('../utils/rounding');
const { fetchProyeccion } = require('../consultas/proyeccion');
const { libroIvaRevision, sumMoneyField } = require('../consultas/vistas');

/** Excluye productos cuyo nombre contiene "flete" (servicios internos, no mercadería de listados). */
const SQL_EXCLUIR_FLETE_PRODUCTO = `AND UPPER(p.nombre) NOT LIKE '%FLETE%'`;

/** Listados mensuales: día calendario comercial de la venta (no fecha_fiscal ARCA). */
const FECHA_LISTADO_SQL = `DATE(v.fecha)`;
const FECHA_LISTADO_FMT = `DATE_FORMAT(v.fecha, '%Y-%m-%d')`;

// Función auxiliar para convertir consultas callback a promesas
const queryPromise = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

const obtenerNombreComprobante = (tipoDocRaw, tipoFRaw) => {
    const tipoDoc = (tipoDocRaw || '').toString().trim().toUpperCase();
    const tipoF = (tipoFRaw || '').toString().trim().toUpperCase();

    if (tipoDoc === 'NOTA_DEBITO' || tipoDoc === 'NOTA DEBITO') {
        return `NOTA DE DÉBITO ${tipoF}`.trim();
    }
    if (tipoDoc === 'NOTA_CREDITO' || tipoDoc === 'NOTA CREDITO') {
        return `NOTA DE CRÉDITO ${tipoF}`.trim();
    }
    if (tipoDoc === 'FACTURA' || !tipoDoc) {
        return `FACTURA ${tipoF}`.trim();
    }
    return `${tipoDoc.replace(/_/g, ' ')} ${tipoF}`.trim();
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

        // Libro IVA de presentación: solo A/B con CAE del mes comercial (DATE(v.fecha)).
        const proyeccion = await fetchProyeccion({
            where: `UPPER(TRIM(COALESCE(v.tipo_f,''))) IN ('A','B')
              AND ${FECHA_LISTADO_SQL} BETWEEN ? AND ?`,
            params: [primerDia, ultimaFecha]
        });
        const { acreditados, seccionPendientes } = libroIvaRevision(proyeccion);

        if (acreditados.length === 0) {
            return res.status(404).json({
                error: "No se encontraron comprobantes A/B con CAE para el período seleccionado"
            });
        }

        if (seccionPendientes.length > 0) {
            console.log(
                `ℹ️ Libro IVA ${mes}/${anio}: ${acreditados.length} con CAE en PDF; ` +
                `${seccionPendientes.length} A/B sin CAE omitidos del documento de presentación`
            );
        }

        const formatearFila = (venta) => {
            const tipoDoc = (venta.tipo_doc || '').toString().trim().toUpperCase();
            const tipoF = (venta.tipo_f || '').toString().trim().toUpperCase();
            let nombreComprobante = '';
            if (tipoDoc === 'NOTA_DEBITO' || tipoDoc === 'NOTA DEBITO') {
                nombreComprobante = `NOTA DE DÉBITO ${tipoF}`;
            } else if (tipoDoc === 'NOTA_CREDITO' || tipoDoc === 'NOTA CREDITO') {
                nombreComprobante = `NOTA DE CRÉDITO ${tipoF}`;
            } else if (tipoDoc === 'FACTURA' || !tipoDoc) {
                nombreComprobante = `FACTURA ${tipoF}`;
            } else {
                nombreComprobante = `${tipoDoc.replace(/_/g, ' ')} ${tipoF}`;
            }

            const signo = Number(venta.signo) || 1;
            return {
                // Día comercial del comprobante (mismo criterio que el filtro del mes).
                fecha: venta.fecha_comercial || venta.fecha_revision || venta.fecha_fiscal_acreditada,
                comprobante: nombreComprobante,
                numero: venta.numero_factura || '-',
                cliente: venta.cliente_nombre || 'Sin nombre',
                cuit: venta.cliente_cuit || '-',
                condicionIva: (venta.cliente_condicion || 'Sin especificar').toString().trim(),
                neto: Number(venta.neto_presentacion ?? venta.comercial_neto) || 0,
                exento: (Number(venta.exento) || 0) * signo,
                iva: Number(venta.iva_presentacion ?? venta.comercial_iva) || 0,
                percepciones: 0,
                retenciones: 0,
                total: Number(venta.total_presentacion ?? venta.comercial_total) || 0
            };
        };

        const ventasFormateadas = acreditados.map(formatearFila);

        const sumSeccion = (filas) => ({
            ...Object.fromEntries(['neto','exento','iva','percepciones','retenciones','total']
              .map(field => [field, Number(sumMoneyField(filas, field).total)]))
        });

        const totales = sumSeccion(ventasFormateadas);

        const addSafe = (a, b) => a + (b == null || Number.isNaN(Number(b)) ? 0 : Number(b));
        const sumFilas = (filas) => filas.reduce((acc, venta) => ({
            neto: addSafe(acc.neto, venta.neto),
            exento: addSafe(acc.exento, venta.exento),
            iva: addSafe(acc.iva, venta.iva),
            percepciones: addSafe(acc.percepciones, venta.percepciones),
            retenciones: addSafe(acc.retenciones, venta.retenciones),
            total: addSafe(acc.total, venta.total)
        }), { neto: 0, exento: 0, iva: 0, percepciones: 0, retenciones: 0, total: 0 });

        const condicionesIva = ['Responsable Inscripto', 'Monotributo', 'Consumidor Final', 'Exento'];
        const desglosePorCondicion = condicionesIva.map(condicion => {
            const ventasCondicion = ventasFormateadas.filter(v =>
                v.condicionIva.toLowerCase().includes(condicion.toLowerCase())
            );
            return {
                condicion,
                cantidadVentas: ventasCondicion.length,
                ...sumFilas(ventasCondicion)
            };
        });

        const ventasOtras = ventasFormateadas.filter(v => {
            const condicionLower = v.condicionIva.toLowerCase();
            return !condicionesIva.some(c => condicionLower.includes(c.toLowerCase()));
        });

        if (ventasOtras.length > 0) {
            desglosePorCondicion.push({
                condicion: 'Otros',
                cantidadVentas: ventasOtras.length,
                ...sumFilas(ventasOtras)
            });
        }

        console.log(`📊 Libro IVA ${mes}/${anio}: ${ventasFormateadas.length} comprobantes A/B con CAE`);

        const pdfBuffer = await pdfGenerator.generarLibroIva({
            mes,
            anio,
            ventas: ventasFormateadas,
            totales,
            desglosePorCondicion
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Libro IVA generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Libro IVA generado - ${mes}/${anio} - ${ventasFormateadas.length} A/B con CAE en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Libro_IVA_${mes}_${anio}.pdf"`);
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

// Generar PDF de Reporte mensual de Fletes (líneas con LIKE '%FLETE%')
const generarPdfReporteFletes = async (req, res) => {
    const { mes, anio } = req.body;

    if (!mes || !anio) {
        return res.status(400).json({ error: "Debe especificar mes y año" });
    }

    try {
        console.log(`📄 Generando Reporte de Fletes para ${mes}/${anio}...`);
        const startTime = Date.now();

        const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const ultimoDia = new Date(anio, mes, 0).getDate();
        const ultimaFecha = `${anio}-${String(mes).padStart(2, '0')}-${ultimoDia}`;

        const query = `
            SELECT
                v.id AS venta_id,
                ${FECHA_LISTADO_FMT} AS fecha_fiscal,
                v.numero_factura,
                v.tipo_f,
                v.tipo_doc,
                v.cliente_nombre,
                v.cliente_cuit,
                vc.producto_nombre,
                vc.cantidad,
                vc.subtotal,
                vc.iva
            FROM ventas_cont vc
            INNER JOIN ventas v ON v.id = vc.venta_id
            WHERE ${FECHA_LISTADO_SQL} BETWEEN ? AND ?
                AND (v.tipo_f = 'A' OR v.tipo_f = 'B')
                AND UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO')
                AND UPPER(vc.producto_nombre) LIKE '%FLETE%'
            ORDER BY
                ${FECHA_LISTADO_SQL} ASC,
                CASE
                    WHEN UPPER(TRIM(v.tipo_doc)) = 'FACTURA' THEN 1
                    WHEN UPPER(TRIM(v.tipo_doc)) = 'NOTA_DEBITO' THEN 2
                    WHEN UPPER(TRIM(v.tipo_doc)) = 'NOTA_CREDITO' THEN 3
                    ELSE 9
                END ASC,
                v.numero_factura ASC,
                vc.id ASC
        `;

        const lineasFlete = await queryPromise(query, [primerDia, ultimaFecha]);

        console.log(`📊 Se encontraron ${lineasFlete.length} líneas de flete para el período`);

        if (lineasFlete.length === 0) {
            return res.status(404).json({
                error: "No se encontraron líneas de flete para el período seleccionado"
            });
        }

        const lineasFormateadas = lineasFlete.map(item => {
            const tipoDoc = (item.tipo_doc || 'FACTURA').toString().trim().toUpperCase();
            const multiplicador = tipoDoc === 'NOTA_CREDITO' ? -1 : 1;

            const neto = (parseFloat(item.subtotal) || 0) * multiplicador;
            const iva = (parseFloat(item.iva) || 0) * multiplicador;
            const total = neto + iva;

            return {
                fecha: item.fecha_fiscal,
                comprobante: obtenerNombreComprobante(item.tipo_doc, item.tipo_f),
                numero: item.numero_factura || '-',
                cliente: item.cliente_nombre || 'Sin nombre',
                cuit: item.cliente_cuit || '-',
                producto: item.producto_nombre || 'FLETE',
                cantidad: parseFloat(item.cantidad) || 0,
                neto,
                iva,
                total
            };
        });

        const totales = lineasFormateadas.reduce((acc, item) => ({
            neto: acc.neto + item.neto,
            iva: acc.iva + item.iva,
            total: acc.total + item.total
        }), { neto: 0, iva: 0, total: 0 });

        const cantidadComprobantes = new Set(lineasFlete.map(item => item.venta_id)).size;

        const pdfBuffer = await pdfGenerator.generarReporteFletes({
            mes,
            anio,
            lineas: lineasFormateadas,
            totales,
            cantidadComprobantes
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Reporte de Fletes generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Reporte de Fletes generado - ${mes}/${anio} - ${lineasFlete.length} líneas en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Reporte_Fletes_${mes}_${anio}.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Reporte de Fletes enviado exitosamente');
    } catch (error) {
        console.error("❌ Error generando Reporte de Fletes:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Error generando Reporte de Fletes: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar el Reporte de Fletes",
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
            WHERE p.activo = 1 AND p.stock_actual > 0
            ${SQL_EXCLUIR_FLETE_PRODUCTO}
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
            const iva = resolvePorcentajeIva(producto.iva);
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
        res.setHeader("Content-Disposition", `inline; filename="Lista_Precios_${new Date().toISOString().split('T')[0]}.pdf"`);
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
            WHERE p.activo = 1 AND UPPER(p.nombre) NOT LIKE '%FLETE%'
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
        res.setHeader("Content-Disposition", `inline; filename="Control_Stock_${tipo}_${cantidad}_productos.pdf"`);
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

    const productosSinFlete = productos.filter(
        (p) => !String(p.nombre || '').toUpperCase().includes('FLETE')
    );

    if (productosSinFlete.length === 0) {
        return res.status(400).json({ error: "No hay productos válidos (se excluyen ítems de flete)" });
    }

    try {
        console.log(`📄 Generando Control de Stock para ${productosSinFlete.length} productos seleccionados...`);
        const startTime = Date.now();

        // Agrupar productos por categoría
        const productosPorCategoria = productosSinFlete.reduce((acc, producto) => {
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
            cantidad: productosSinFlete.length,
            categorias: categoriasOrdenadas,
            productosPorCategoria
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Control de Stock generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'productos',
            detallesAdicionales: `Control de Stock generado - selección manual - ${productosSinFlete.length} productos en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Control_Stock_Seleccion_${productosSinFlete.length}_productos.pdf"`);
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

// Generar PDF de Listado de Vendedores
const generarPdfListadoVendedores = async (req, res) => {
    const { vendedorId, mes, anio } = req.body;

    if (!vendedorId || !mes || !anio) {
        return res.status(400).json({ error: "Debe especificar vendedor, mes y año" });
    }

    try {
        console.log(`📄 Generando Listado de Vendedores para vendedor ${vendedorId} - ${mes}/${anio}...`);
        const startTime = Date.now();

        // Calcular rango de fechas para el mes seleccionado
        const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`;
        const ultimoDia = new Date(anio, mes, 0).getDate();
        const ultimaFecha = `${anio}-${String(mes).padStart(2, '0')}-${ultimoDia}`;

        // Obtener información del vendedor
        const queryVendedor = `SELECT id, nombre, apellido FROM empleados WHERE id = ?`;
        const vendedor = await queryPromise(queryVendedor, [vendedorId]);

        if (vendedor.length === 0) {
            return res.status(404).json({ error: "Vendedor no encontrado" });
        }

        const vendedorNombre = `${vendedor[0].nombre} ${vendedor[0].apellido}`;

        // Consulta SQL para obtener operaciones comerciales del vendedor:
        // - FACTURA: se imputa por el empleado de la propia factura.
        // - NOTA_DEBITO / NOTA_CREDITO: se imputan por el empleado de la venta de referencia.
        // Regla comercial de signos:
        // FACTURA y NOTA_DEBITO suman; NOTA_CREDITO resta.
        const query = `
            SELECT
                v.id,
                ${FECHA_LISTADO_FMT} AS fecha,
                v.numero_factura,
                v.tipo_doc,
                v.tipo_f,
                v.cliente_nombre,
                v.cliente_cuit,
                v.subtotal,
                v.iva_total,
                v.exento,
                v.total,
                v.venta_referencia_id,
                vr.empleado_id AS referencia_empleado_id
            FROM ventas v
            LEFT JOIN ventas vr ON vr.id = v.venta_referencia_id
            WHERE ${FECHA_LISTADO_SQL} BETWEEN ? AND ?
                AND UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO')
                AND UPPER(TRIM(COALESCE(v.estado, 'FACTURADA'))) IN ('FACTURADA', 'FACTURADO')
                AND (
                    (
                        UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) = 'FACTURA'
                        AND v.empleado_id = ?
                    )
                    OR
                    (
                        UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_DEBITO', 'NOTA_CREDITO')
                        AND v.venta_referencia_id IS NOT NULL
                        AND vr.empleado_id = ?
                    )
                )
            ORDER BY ${FECHA_LISTADO_SQL} ASC, v.numero_factura ASC
        `;

        const ventas = await queryPromise(query, [primerDia, ultimaFecha, vendedorId, vendedorId]);

        console.log(`📊 Se encontraron ${ventas.length} ventas para el vendedor ${vendedorNombre} en el período`);

        if (ventas.length === 0) {
            return res.status(404).json({
                error: `No se encontraron ventas para el vendedor ${vendedorNombre} en el período seleccionado`
            });
        }

        // Formatear datos para el PDF
        const ventasFormateadas = ventas.map(venta => {
            const tipoDoc = (venta.tipo_doc || 'FACTURA').toString().trim().toUpperCase();
            const tipoFiscal = (venta.tipo_f || '').toString().trim().toUpperCase();

            let comprobante = '';
            if (tipoDoc === 'NOTA_DEBITO') {
                comprobante = `NOTA DE DÉBITO ${tipoFiscal || ''}`.trim();
            } else if (tipoDoc === 'NOTA_CREDITO') {
                comprobante = `NOTA DE CRÉDITO ${tipoFiscal || ''}`.trim();
            } else if (tipoFiscal === 'A') {
                comprobante = 'FACTURA A';
            } else if (tipoFiscal === 'B') {
                comprobante = 'FACTURA B';
            } else if (tipoFiscal === 'X') {
                comprobante = 'FACTURA X';
            } else {
                comprobante = `FACTURA ${tipoFiscal || 'N/A'}`.trim();
            }

            // Regla de signos: FACTURA/NOTA_DEBITO suman, NOTA_CREDITO resta
            const multiplicador = tipoDoc === 'NOTA_CREDITO' ? -1 : 1;

            const netoCabecera = parseFloat(venta.subtotal) || 0;
            const ivaCabecera = parseFloat(venta.iva_total) || 0;
            const exentoCabecera = parseFloat(venta.exento) || 0;
            const totalCabecera = parseFloat(venta.total) || 0;

            return {
                fecha: venta.fecha,
                comprobante: comprobante,
                numero: venta.numero_factura || '-',
                cliente: venta.cliente_nombre || 'Sin nombre',
                cuit: venta.cliente_cuit || '-',
                // Desglose fiscal de cabecera (sin cambiar criterio de columnas neto/exento/iva)
                neto: netoCabecera * multiplicador,
                exento: exentoCabecera * multiplicador,
                iva: ivaCabecera * multiplicador,
                percepciones: 0, // Siempre 0 según especificación
                retenciones: 0, // Siempre 0 según especificación
                // E3: el listado de vendedores imputa total final para A/B y X.
                total: totalCabecera * multiplicador
            };
        });

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
        const pdfBuffer = await pdfGenerator.generarListadoVendedores({
            vendedorId,
            vendedorNombre,
            mes,
            anio,
            ventas: ventasFormateadas,
            totales
        });

        const generationTime = Date.now() - startTime;
        console.log(`✅ Listado de Vendedores generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Listado de Vendedores generado - ${vendedorNombre} - ${mes}/${anio} - ${ventas.length} registros en ${generationTime}ms`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Listado_Vendedores_${vendedorNombre.replace(/[^a-zA-Z0-9]/g, '_')}_${mes}_${anio}.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Listado de Vendedores enviado exitosamente');

    } catch (error) {
        console.error("❌ Error generando Listado de Vendedores:", error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Error generando Listado de Vendedores: ${error.message}`
        });

        res.status(500).json({
            error: "Error al generar el Listado de Vendedores",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const getTipoFactorResumen = (tipoDocRaw) => {
    const tipoDoc = (tipoDocRaw || '').toString().trim().toUpperCase();
    if (tipoDoc === 'NOTA_CREDITO') return -1;
    if (tipoDoc === 'FACTURA' || tipoDoc === 'NOTA_DEBITO') return 1;
    return 1;
};

const generarPdfResumenCuenta = async (req, res) => {
    const { ventasIds } = req.body;

    if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
        return res.status(400).json({ error: 'Debe proporcionar al menos un ID de venta válido' });
    }

    const ids = ventasIds
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);

    if (ids.length === 0) {
        return res.status(400).json({ error: 'No se encontraron IDs de venta válidos' });
    }

    if (ids.length !== ventasIds.length) {
        return res.status(400).json({ error: 'Uno o más IDs de venta no son válidos' });
    }

    try {
        console.log(`📄 Generando Resumen de Cuenta para ${ids.length} comprobante(s)...`);
        const startTime = Date.now();

        const placeholders = ids.map(() => '?').join(', ');
        const query = `
            SELECT
                id, fecha, fecha_fiscal, numero_factura, cliente_id, cliente_nombre,
                cliente_direccion, cliente_ciudad, cliente_cuit, tipo_doc, tipo_f,
                subtotal, iva_total, total, estado
            FROM ventas
            WHERE id IN (${placeholders})
              AND estado = 'Facturada'
              AND tipo_doc IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO')
        `;

        const ventas = await queryPromise(query, ids);

        if (ventas.length !== ids.length) {
            return res.status(400).json({
                error: 'Una o más ventas no existen, no están facturadas o no son comprobantes válidos para el resumen'
            });
        }

        const clienteIds = new Set(ventas.map((venta) => venta.cliente_id).filter((id) => id != null));
        if (clienteIds.size > 1) {
            return res.status(400).json({
                error: 'Todas las facturas deben pertenecer al mismo cliente'
            });
        }

        const primeraVenta = ventas[0];
        const cliente = {
            cliente_nombre: primeraVenta.cliente_nombre,
            cliente_cuit: primeraVenta.cliente_cuit,
            cliente_direccion: primeraVenta.cliente_direccion,
            cliente_ciudad: primeraVenta.cliente_ciudad
        };

        const totales = ventas.reduce((acc, venta) => {
            const factor = getTipoFactorResumen(venta.tipo_doc);
            return {
                neto: acc.neto + (Number(venta.subtotal) || 0) * factor,
                iva: acc.iva + (Number(venta.iva_total) || 0) * factor,
                total: acc.total + (Number(venta.total) || 0) * factor
            };
        }, { neto: 0, iva: 0, total: 0 });

        const pdfBuffer = await pdfGenerator.generarResumenCuenta({ cliente, ventas, totales });

        const generationTime = Date.now() - startTime;
        const clienteSlug = (cliente.cliente_nombre || 'cliente').replace(/[^a-zA-Z0-9]/g, '_');

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Resumen de Cuenta generado - ${cliente.cliente_nombre} - ${ventas.length} comprobante(s) en ${generationTime}ms`
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Resumen_Cuenta_${clienteSlug}.pdf"`);
        res.end(pdfBuffer);

        console.log('✅ Resumen de Cuenta enviado exitosamente');
    } catch (error) {
        console.error('❌ Error generando Resumen de Cuenta:', error);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'ventas',
            detallesAdicionales: `Error generando Resumen de Cuenta: ${error.message}`
        });

        res.status(500).json({
            error: 'Error al generar el Resumen de Cuenta',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = {
    generarPdfLibroIva,
    generarPdfReporteFletes,
    generarPdfListaPrecios,
    generarPdfControlStockFiltro,
    generarPdfControlStockSeleccion,
    generarPdfListadoVendedores,
    generarPdfResumenCuenta
};
