const db = require('./db');
const puppeteer = require("puppeteer");
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');


const nuevoProducto = (req, res) => {
    const { nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual } = req.body;

    if (!nombre || !unidad_medida || !costo || !precio || !categoria_id || !iva || stock_actual === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const query = `
        INSERT INTO productos (nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual], (err, results) => {
        if (err) {
            console.error('Error al insertar el producto:', err);
            return res.status(500).json({ success: false, message: "Error al insertar el producto" });
        }
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

const actualizarProducto = (req, res) => {
    const productoId = req.params.id;
    const { nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual } = req.body;

    if (!nombre || !unidad_medida || !costo || !precio || !categoria_id || !iva || stock_actual === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
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

        db.query(updateQuery, [nombre, unidad_medida, costo, precio, categoria_id, iva, stock_actual, productoId], (error, updateResults) => {
            if (error) {
                console.error('Error al actualizar el producto:', error);
                return res.status(500).json({ success: false, message: "Error al actualizar el producto" });
            }

            if (updateResults.affectedRows === 0) {
                return res.status(400).json({ success: false, message: "No se realizaron cambios" });
            }

            res.json({ success: true, message: "Producto actualizado correctamente" });
        });
    });
};


const registrarRemito = (pedidoData, callback) => {
    const { venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones} = pedidoData;

    const registrarVentaQuery = `
        INSERT INTO remitos
        (venta_id, fecha, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones)
        VALUES 
        (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const ventaValues = [venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones];

    db.query(registrarVentaQuery, ventaValues, (err, result) => {
        if (err) {
            console.error('Error al insertar el remito:', err);
            return callback(err);
        }
        callback(null, result.insertId); // Devuelve el ID del pedido recién insertado
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
                        console.error('Error al insertar el producto del pedido:', err);
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


const nuevoRemito = (req, res) => {
    const { venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones, productos } = req.body;
    

    registrarRemito({
        venta_id, cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones
    }, async (err, remitoId) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error al insertar el pedido' });
        }

        const errorProductos = await insertarProductos(remitoId, productos);
        if (errorProductos) {
            return res.status(500).json({ success: false, message: 'Error al insertar los productos del pedido' });
        }

        res.json({ success: true, message: 'Pedido y productos insertados correctamente'});
    });
};


const obtenerRemitos = (req, res) => {
    const { fecha, ciudad, provincia } = req.query;
  
    // Inicia la consulta con la cláusula básica
    let query = `
      SELECT 
          id, venta_id, DATE_FORMAT(fecha, '%d-%m-%Y // %H:%i:%s') AS fecha,
          cliente_id, cliente_nombre, cliente_condicion, cliente_cuit, cliente_telefono, 
          cliente_direccion, cliente_ciudad, cliente_provincia, estado, observaciones
      FROM remitos 
      WHERE 1=1`; // '1=1' permite añadir condiciones dinámicas
  
    // Agregar filtros si están presentes
    if (fecha) {
      query += ` AND DATE(fecha) = '${fecha}'`; // Ajusta el formato si es necesario
    }
  
    if (ciudad) {
      query += ` AND cliente_ciudad = '${ciudad}'`;
    }
  
    if (provincia) {
      query += ` AND cliente_provincia = '${provincia}'`;
    }
  
    // Ordenar los resultados
    query += ` ORDER BY fecha ASC`;
  
    // Ejecutar la consulta
    db.query(query, (err, results) => {
      if (err) {
        console.error('Error al obtener:', err);
        res.status(500).send('Error al obtener remitos');
      } else {
        res.json(results);
      }
    });
  };

const filtrarProductosRemito = (req, res) => {
    const remitoId = req.params.id;

    // Consulta SQL para obtener productos del pedido
    const query = `
        SELECT id, remito_id, producto_id, producto_nombre, producto_um, cantidad FROM detalle_remitos
        WHERE remito_id = ?
    `;
    
    db.query(query, [remitoId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos del pedido:', err);
            return res.status(500).json({ error: 'Error al obtener productos del pedido' });
        }
        res.json(results);
    });
};


const generarPdfRemito = async (req, res) => {
    const { remito, productos } = req.body;

    if (!remito || productos.length === 0) {
        return res.status(400).json({ error: "Datos insuficientes para generar el PDF" });
    }

    // Ruta de la plantilla HTML
    const templatePath = path.join(__dirname, "../resources/documents/remito.html");

    if (!fs.existsSync(templatePath)) {
        return res.status(500).json({ error: "Plantilla HTML no encontrada" });
    }



    try {
        // Leer y reemplazar la plantilla HTML
        let htmlTemplate = fs.readFileSync(templatePath, "utf8");

        
        
        htmlTemplate = htmlTemplate
            .replace("{{fecha}}", remito.fecha)
            .replace("{{cliente_nombre}}", remito.cliente_nombre || "No informado")
            .replace("{{cliente_cuit}}", remito.cliente_cuit || "No informado")
            .replace("{{cliente_cativa}}", remito.cliente_condicion || "No informado")
            .replace("{{cliente_direccion}}", remito.cliente_direccion || "No informado")
            .replace("{{cliente_provincia}}", remito.cliente_provincia || "No informado")
            .replace("{{cliente_telefono}}", remito.cliente_telefono || "No informado")
            .replace("{{cliente_ciudad}}", remito.cliente_ciudad || "No informado")


        const itemsHTML = productos
            .map(
                (producto) => `
                <tr>
                    
                    
                    <td>${producto.producto_nombre}</td>
                    <td>${producto.producto_um}</td>
                    <td>${producto.cantidad}</td>
                    

                </tr>`
            )
            .join("");

        htmlTemplate = htmlTemplate.replace("{{items}}", itemsHTML);
        
        

        

        // Iniciar Puppeteer y generar PDF
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" }); // ⬅️ Espera hasta que la página cargue completamente
        const pdfBuffer = await page.pdf({ format: "A4" });

        await browser.close();

        // Configurar la respuesta
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="REMITO_${remito.cliente_nombre}.pdf"`);

        
        res.end(pdfBuffer); // ⬅️ Usa res.end() en lugar de res.send() para archivos binarios
    } catch (error) {
        console.error("Error generando PDF:", error);
        res.status(500).json({ error: "Error al generar el PDF" });
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



module.exports = {
    nuevoProducto,
    buscarProducto, 
    actualizarProducto,
    nuevoRemito,
    obtenerRemitos,
    filtrarProductosRemito,
    generarPdfRemito,
    obtenerCategorias
};