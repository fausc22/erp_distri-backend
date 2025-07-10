const db = require('./db');
const puppeteer = require("puppeteer");
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const puppeteerManager = require('../utils/puppeteerConfig');
const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const pdfGenerator = require('../utils/pdfGenerator');

const formatearFecha = (fechaBD) => {
    if (!fechaBD) return 'Fecha no disponible';
    
    try {
        // Crear objeto Date desde string de BD (MySQL datetime format)
        const fecha = new Date(fechaBD);
        
        // Verificar que la fecha es válida
        if (isNaN(fecha.getTime())) {
            console.warn('Fecha inválida recibida:', fechaBD);
            return 'Fecha inválida';
        }
        
        // Formatear componentes
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0'); // +1 porque getMonth() empieza en 0
        const año = fecha.getFullYear();
        
        const horas = String(fecha.getHours()).padStart(2, '0');
        const minutos = String(fecha.getMinutes()).padStart(2, '0');
        const segundos = String(fecha.getSeconds()).padStart(2, '0');
        
        // Retornar formato deseado: DD/MM/AAAA - HH:mm:ss
        return `${dia}/${mes}/${año} - ${horas}:${minutos}:${segundos}`;
        
    } catch (error) {
        console.error('Error formateando fecha:', error, 'Fecha original:', fechaBD);
        return 'Error en fecha';
    }
};

const nuevoProducto = async (req, res) => {
    const { nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual } = req.body;

    if (!nombre || !unidad_medida || !costo || !precio || !categoria_id || !iva || stock_actual === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const query = `
        INSERT INTO productos (nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual], async (err, results) => {
        if (err) {
            console.error('Error al insertar el producto:', err);
            
            // Auditar error en creación
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'productos',
                detallesAdicionales: `Error al crear producto: ${err.message}`,
                datosNuevos: req.body
            });
            
            return res.status(500).json({ success: false, message: "Error al insertar el producto" });
        }
        
        // Auditar creación exitosa del producto
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'productos',
            registroId: results.insertId,
            datosNuevos: { 
                id: results.insertId,
                ...req.body
            },
            detallesAdicionales: `Producto creado: ${nombre} - Stock inicial: ${stock_actual}`
        });
        
        res.json({ success: true, message: "Producto agregado correctamente", data: results });
    });
};

const buscarProducto = (req, res) => {
    const searchTerm = req.query.search ? `%${req.query.search}%` : '%';

    const query = `
        SELECT * FROM productos
        WHERE nombre LIKE ?;
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los productos:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los productos" });
        }
        res.json({ success: true, data: results });
    });
};

const actualizarProducto = async (req, res) => {
    const productoId = req.params.id;
    const { nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual } = req.body;

    if (!nombre || !unidad_medida || !costo || !precio || !categoria_id || !iva || stock_actual === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    // Obtener datos anteriores para auditoría
    const obtenerDatosAnterioresPromise = () => {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM productos WHERE id = ?', [productoId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
    };

    try {
        const datosAnteriores = await obtenerDatosAnterioresPromise();
        
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: "Producto no encontrado" });
        }

        // Verificar si el producto existe antes de actualizar
        const checkQuery = `SELECT id FROM productos WHERE id = ?`;
        db.query(checkQuery, [productoId], (err, results) => {
            if (err) {
                console.error('Error al verificar el producto:', err);
                return res.status(500).json({ success: false, message: "Error al verificar el producto" });
            }

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "Producto no encontrado" });
            }

            // Si el producto existe, proceder con la actualización
            const updateQuery = `
                UPDATE productos 
                SET nombre = ?, unidad_medida = ?, costo = ?, precio = ?, categoria_id = ?, iva = ?, stock_actual = ? 
                WHERE id = ?
            `;

            db.query(updateQuery, [nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual, productoId], async (error, updateResults) => {
                if (error) {
                    console.error('Error al actualizar el producto:', error);
                    
                    // Auditar error en actualización
                    await auditarOperacion(req, {
                        accion: 'UPDATE',
                        tabla: 'productos',
                        registroId: productoId,
                        detallesAdicionales: `Error al actualizar producto: ${error.message}`,
                        datosAnteriores,
                        datosNuevos: req.body
                    });
                    
                    return res.status(500).json({ success: false, message: "Error al actualizar el producto" });
                }

                if (updateResults.affectedRows === 0) {
                    return res.status(400).json({ success: false, message: "No se realizaron cambios" });
                }

                // Calcular cambio en stock para detalles adicionales
                const cambioStock = stock_actual - datosAnteriores.stock_actual;
                const detalleStock = cambioStock !== 0 ? ` - Cambio en stock: ${cambioStock > 0 ? '+' : ''}${cambioStock}` : '';

                // Auditar actualización exitosa
                await auditarOperacion(req, {
                    accion: 'UPDATE',
                    tabla: 'productos',
                    registroId: productoId,
                    datosAnteriores,
                    datosNuevos: { 
                        id: productoId,
                        ...req.body
                    },
                    detallesAdicionales: `Producto actualizado: ${nombre}${detalleStock}`
                });

                res.json({ success: true, message: "Producto actualizado correctamente" });
            });
        });
    } catch (error) {
        console.error('Error al obtener datos anteriores:', error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};

const registrarRemito = (pedidoData, callback) => {
    const { venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre} = pedidoData;

    const registrarVentaQuery = `
        INSERT INTO remitos
        (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre)
        VALUES 
        (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const ventaValues = [venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, empleado_id, empleado_nombre];

    db.query(registrarVentaQuery, ventaValues, (err, result) => {
        if (err) {
            console.error('Error al insertar el remito:', err);
            return callback(err);
        }
        callback(null, result.insertId); // Devuelve el ID del remito recién insertado
    });
};

const insertarProductos = async (remitoId, productos) => {
    const insertProductoQuery = `
        INSERT INTO detalle_remitos (remito_id, producto_id, producto_nombre, producto_um, cantidad) 
        VALUES (?, ?, ?, ?, ?)
    `;

    try {
        await Promise.all(productos.map(producto => {
            const {  producto_id, producto_nombre, producto_um, cantidad } = producto;
            const productoValues = [remitoId, producto_id, producto_nombre, producto_um, cantidad];

            return new Promise((resolve, reject) => {
                db.query(insertProductoQuery, productoValues, (err, result) => {
                    if (err) {
                        console.error('Error al insertar el producto del remito:', err);
                        return reject(err);
                    }
                    resolve(result);
                });
            });
        }));
        return null;
    } catch (error) {
        return error;
    }
};

const nuevoRemito = async (req, res) => {
    const { venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, productos } = req.body;
    
    registrarRemito({
        venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones
    }, async (err, remitoId) => {
        if (err) {
            // Auditar error en creación del remito
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'remitos',
                detallesAdicionales: `Error al crear remito: ${err.message}`,
                datosNuevos: req.body
            });
            
            return res.status(500).json({ success: false, message: 'Error al insertar el remito' });
        }

        const errorProductos = await insertarProductos(remitoId, productos);
        if (errorProductos) {
            // Auditar error en inserción de productos
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'detalle_remitos',
                detallesAdicionales: `Error al insertar productos del remito: ${errorProductos.message}`,
                datosNuevos: { remitoId, productos }
            });
            
            return res.status(500).json({ success: false, message: 'Error al insertar los productos del remito' });
        }

        // Auditar creación exitosa del remito
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'remitos',
            registroId: remitoId,
            datosNuevos: { 
                id: remitoId,
                ...req.body
            },
            detallesAdicionales: `Remito creado para cliente: ${cliente_nombre} - ${productos.length} productos`
        });

        res.json({ success: true, message: 'Remito y productos insertados correctamente'});
    });
};

const obtenerStock = async (req, res) => {
   const productoId = req.params.id;
    
    try {
        console.log('🔍 Consultando stock para producto ID:', productoId);
        
        const result = await new Promise((resolve, reject) => {
            db.query(
                'SELECT id, nombre, stock_actual FROM productos WHERE id = ?', 
                [productoId], 
                (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                }
            );
        });
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Producto no encontrado' 
            });
        }
        
        const producto = result[0];
        console.log('✅ Stock encontrado:', producto.stock_actual);
        
        res.json({ 
            success: true, 
            data: { 
                stock_actual: Number(producto.stock_actual) || 0,
                nombre: producto.nombre,
                id: producto.id
            }
        });
    } catch (error) {
        console.error('❌ Error al obtener stock:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al obtener stock del producto' 
        });
    }
};


const obtenerCategorias = (req, res) => {
    const query = `
        SELECT id, nombre 
        FROM categorias 
        ORDER BY nombre ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener las categorías:', err);
            return res.status(500).json({ success: false, message: "Error al obtener las categorías" });
        }
        res.json({ success: true, data: results });
    });
};

const obtenerRemitos = (req, res) => {
    const { fecha, ciudad, provincia } = req.query;
  
    // Inicia la consulta con la cláusula básica
    let query = `
      SELECT 
          id, venta_id, fecha,
          cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, 
          cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones,
          empleado_id, empleado_nombre
      FROM remitos 
      WHERE 1=1`;
  
    const params = [];
  
    // Agregar filtros si están presentes usando parámetros seguros
    if (fecha) {
      query += ` AND DATE(fecha) = ?`;
      params.push(fecha);
    }
  
    if (ciudad) {
      query += ` AND cliente_ciudad = ?`;
      params.push(ciudad);
    }
  
    if (provincia) {
      query += ` AND cliente_provincia = ?`;
      params.push(provincia);
    }
  
    // Ordenar los resultados
    query += ` ORDER BY fecha DESC`;
  
    // Ejecutar la consulta
    db.query(query, params, (err, results) => {
      if (err) {
        console.error('Error al obtener remitos:', err);
        res.status(500).send('Error al obtener remitos');
      } else {
        console.log(`✅ Remitos obtenidos: ${results.length}`);
        res.json(results);
      }
    });
};

const filtrarProductosRemito = (req, res) => {
    const remitoId = req.params.id;

    // Consulta SQL para obtener productos del remito
    const query = `
        SELECT id, remito_id, producto_id, producto_nombre, producto_um, cantidad 
        FROM detalle_remitos
        WHERE remito_id = ?
    `;
    
    db.query(query, [remitoId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos del remito:', err);
            return res.status(500).json({ error: 'Error al obtener productos del remito' });
        }
        console.log(`📦 Productos del remito ${remitoId}: ${results.length}`);
        res.json(results);
    });
};

const generarPdfRemito = async (req, res) => {
    const { remito, productos } = req.body;

    if (!remito || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    try {
        console.log('📄 Generando PDF de remito optimizado...');
        const startTime = Date.now();

        // ✅ USAR PLANTILLA HTML EXACTA
        const pdfBuffer = await pdfGenerator.generarRemito(remito, productos);

        const generationTime = Date.now() - startTime;
        console.log(`✅ PDF de remito generado en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            registroId: remito.id,
            detallesAdicionales: `PDF de remito generado optimizado en ${generationTime}ms - Cliente: ${remito.cliente_nombre}`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="REMITO_${remito.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
        
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDF:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            registroId: remito.id,
            detallesAdicionales: `Error generando PDF de remito optimizado: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar el PDF",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const generarPdfRemitosMultiples = async (req, res) => {
    const { remitosIds } = req.body;
    
    if (!remitosIds || !Array.isArray(remitosIds) || remitosIds.length === 0) {
        return res.status(400).json({ error: "Debe proporcionar al menos un ID de remito válido" });
    }

    try {
        console.log(`📄 Generando ${remitosIds.length} remitos múltiples optimizados...`);
        const startTime = Date.now();

        const documentos = [];

        for (let i = 0; i < remitosIds.length; i++) {
            let remitoId;
            
            if (typeof remitosIds[i] === 'object' && remitosIds[i] !== null) {
                remitoId = remitosIds[i].id || remitosIds[i];
            } else {
                remitoId = remitosIds[i];
            }
            
            if (!remitoId || isNaN(parseInt(remitoId))) {
                console.warn(`ID de remito inválido: ${remitoId}, continuando`);
                continue;
            }
            
            remitoId = parseInt(remitoId);
            
            try {
                const remitoRows = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM remitos WHERE id = ?', [remitoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (remitoRows.length === 0) {
                    console.warn(`Remito con ID ${remitoId} no encontrado, continuando`);
                    continue;
                }
                
                const productos = await new Promise((resolve, reject) => {
                    db.query('SELECT * FROM detalle_remitos WHERE remito_id = ?', [remitoId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });
                
                if (productos.length === 0) {
                    console.warn(`No se encontraron productos para el remito ${remitoId}, continuando`);
                    continue;
                }
                
                documentos.push({
                    remito: remitoRows[0],
                    productos: productos
                });
                
            } catch (error) {
                console.error(`Error procesando remito ID ${remitoId}:`, error);
            }
        }
        
        if (documentos.length === 0) {
            return res.status(404).json({ error: "No se pudieron obtener datos para los remitos seleccionados" });
        }

        // ✅ USAR EL NUEVO GENERADOR OPTIMIZADO
        const pdfBuffer = await pdfGenerator.generarPDFsMultiples(documentos, 'remitos');

        const generationTime = Date.now() - startTime;
        console.log(`✅ ${documentos.length} remitos múltiples generados en ${generationTime}ms`);

        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            detallesAdicionales: `PDFs múltiples de remitos generados optimizados en ${generationTime}ms - ${remitosIds.length} remitos solicitados, ${documentos.length} generados`
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Remitos_Multiples_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.end(pdfBuffer);
        
    } catch (error) {
        console.error("❌ Error generando PDFs múltiples:", error);
        
        await auditarOperacion(req, {
            accion: 'EXPORT',
            tabla: 'remitos',
            detallesAdicionales: `Error generando PDFs múltiples de remitos optimizados: ${error.message}`
        });
        
        res.status(500).json({ 
            error: "Error al generar los PDFs múltiples",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


module.exports = {
    nuevoProducto,
    buscarProducto, 
    actualizarProducto,
    nuevoRemito,
    obtenerCategorias,
    obtenerRemitos,
    filtrarProductosRemito,
    generarPdfRemito,
    generarPdfRemitosMultiples,
    obtenerStock
};