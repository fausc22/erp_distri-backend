// controllers/comprobantesController.js

const db = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');

// ===========================================
// CONFIGURACIÓN MULTER
// ===========================================

// Crear directorio de comprobantes si no existe
const comprobantesPath = path.join(__dirname, "../storage/comprobantes");
if (!fs.existsSync(comprobantesPath)) {
    fs.mkdirSync(comprobantesPath, { recursive: true });
}

// Configuración de multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, comprobantesPath);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const extension = path.extname(file.originalname);
        cb(null, `temp-${timestamp}${extension}`);
    },
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
        const mimetype = allowedTypes.test(file.mimetype);
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        
        cb(new Error("Archivo no válido. Solo se permiten: JPG, PNG, PDF, DOC, DOCX"));
    }
}).single("comprobante");

// ===========================================
// FUNCIONES HELPER
// ===========================================

const validarTipo = (tipo) => {
    const tiposValidos = ['venta', 'compra', 'gasto'];
    return tiposValidos.includes(tipo.toLowerCase());
};

const obtenerTabla = (tipo) => {
    const tablas = {
        'venta': 'ventas',
        'compra': 'compras', 
        'gasto': 'gastos'
    };
    return tablas[tipo.toLowerCase()];
};

const obtenerNombreArchivo = (tipo, id) => {
    return `${tipo.toUpperCase()}-${id}`;
};

const renombrarArchivo = (rutaAnterior, nuevoNombre) => {
    return new Promise((resolve, reject) => {
        const extension = path.extname(rutaAnterior);
        const nuevaRuta = path.join(comprobantesPath, `${nuevoNombre}${extension}`);
        
        fs.rename(rutaAnterior, nuevaRuta, (err) => {
            if (err) {
                console.error('Error renombrando archivo:', err);
                reject(err);
            } else {
                resolve(nuevaRuta);
            }
        });
    });
};

const eliminarArchivo = (rutaArchivo) => {
    return new Promise((resolve) => {
        if (rutaArchivo && fs.existsSync(rutaArchivo)) {
            fs.unlink(rutaArchivo, (err) => {
                if (err) {
                    console.error('Error eliminando archivo:', err);
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
};

const queryPromise = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

// ===========================================
// CONTROLADORES
// ===========================================

/**
 * Subir comprobante
 * POST /comprobantes/subir/:tipo/:id
 */
const subirComprobante = async (req, res) => {
    const { tipo, id } = req.params;
    
    // Validar tipo
    if (!validarTipo(tipo)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tipo no válido. Debe ser: venta, compra o gasto' 
        });
    }
    
    upload(req, res, async (err) => {
        if (err) {
            console.error('Error en upload:', err);
            return res.status(400).json({ 
                success: false, 
                message: err.message 
            });
        }
        
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No se subió ningún archivo' 
            });
        }
        
        try {
            const tabla = obtenerTabla(tipo);
            
            // Verificar que el registro existe
            const checkQuery = `SELECT id, comprobante_path FROM ${tabla} WHERE id = ?`;
            const checkResult = await queryPromise(checkQuery, [id]);
            
            if (checkResult.length === 0) {
                await eliminarArchivo(req.file.path);
                return res.status(404).json({ 
                    success: false, 
                    message: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} no encontrada` 
                });
            }
            
            // Eliminar comprobante anterior si existe
            if (checkResult[0].comprobante_path) {
                const rutaAnterior = path.join(__dirname, '..', checkResult[0].comprobante_path);
                await eliminarArchivo(rutaAnterior);
            }
            
            // Renombrar archivo con formato TIPO-ID
            const nombreArchivo = obtenerNombreArchivo(tipo, id);
            const nuevaRuta = await renombrarArchivo(req.file.path, nombreArchivo);
            const rutaRelativa = path.relative(path.join(__dirname, '..'), nuevaRuta);
            
            // Actualizar base de datos
            const updateQuery = `UPDATE ${tabla} SET comprobante_path = ? WHERE id = ?`;
            await queryPromise(updateQuery, [rutaRelativa, id]);
            
            // Auditar
            await auditarOperacion(req, {
                accion: 'UPDATE',
                tabla: tabla,
                registroId: id,
                detallesAdicionales: `Comprobante subido: ${req.file.originalname} -> ${nombreArchivo}`
            });
            
            res.json({ 
                success: true, 
                message: 'Comprobante subido exitosamente',
                data: {
                    tipo,
                    registroId: id,
                    ruta: rutaRelativa,
                    nombreOriginal: req.file.originalname,
                    nombreArchivo: nombreArchivo
                }
            });
            
        } catch (error) {
            console.error('Error subiendo comprobante:', error);
            await eliminarArchivo(req.file.path);
            
            await auditarOperacion(req, {
                accion: 'UPDATE',
                tabla: obtenerTabla(tipo),
                registroId: id,
                detallesAdicionales: `Error subiendo comprobante: ${error.message}`
            });
            
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor' 
            });
        }
    });
};

/**
 * Obtener/Descargar comprobante
 * GET /comprobantes/obtener/:tipo/:id
 */
const obtenerComprobante = async (req, res) => {
    const { tipo, id } = req.params;
    
    if (!validarTipo(tipo)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tipo no válido. Debe ser: venta, compra o gasto' 
        });
    }
    
    try {
        const tabla = obtenerTabla(tipo);
        const query = `SELECT comprobante_path FROM ${tabla} WHERE id = ?`;
        const result = await queryPromise(query, [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} no encontrada` 
            });
        }
        
        const comprobantePath = result[0].comprobante_path;
        
        if (!comprobantePath) {
            return res.status(404).json({ 
                success: false, 
                message: `No hay comprobante para esta ${tipo}` 
            });
        }
        
        const rutaCompleta = path.join(__dirname, '..', comprobantePath);
        
        if (!fs.existsSync(rutaCompleta)) {
            return res.status(404).json({ 
                success: false, 
                message: 'Archivo de comprobante no encontrado' 
            });
        }
        
        // Establecer headers apropiados para descarga
        const extension = path.extname(rutaCompleta).toLowerCase();
        let contentType = 'application/octet-stream';
        
        switch (extension) {
            case '.pdf':
                contentType = 'application/pdf';
                break;
            case '.jpg':
            case '.jpeg':
                contentType = 'image/jpeg';
                break;
            case '.png':
                contentType = 'image/png';
                break;
            case '.doc':
                contentType = 'application/msword';
                break;
            case '.docx':
                contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                break;
        }
        
        const nombreArchivo = obtenerNombreArchivo(tipo, id) + extension;
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.sendFile(rutaCompleta);
        
    } catch (error) {
        console.error('Error obteniendo comprobante:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
};

/**
 * Eliminar comprobante
 * DELETE /comprobantes/eliminar/:tipo/:id
 */
const eliminarComprobante = async (req, res) => {
    const { tipo, id } = req.params;
    
    if (!validarTipo(tipo)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tipo no válido. Debe ser: venta, compra o gasto' 
        });
    }
    
    try {
        const tabla = obtenerTabla(tipo);
        const query = `SELECT comprobante_path FROM ${tabla} WHERE id = ?`;
        const result = await queryPromise(query, [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} no encontrada` 
            });
        }
        
        const comprobantePath = result[0].comprobante_path;
        
        if (comprobantePath) {
            const rutaCompleta = path.join(__dirname, '..', comprobantePath);
            await eliminarArchivo(rutaCompleta);
        }
        
        // Actualizar base de datos
        const updateQuery = `UPDATE ${tabla} SET comprobante_path = NULL WHERE id = ?`;
        await queryPromise(updateQuery, [id]);
        
        // Auditar
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: tabla,
            registroId: id,
            detallesAdicionales: `Comprobante eliminado`
        });
        
        res.json({ 
            success: true, 
            message: 'Comprobante eliminado exitosamente',
            data: {
                tipo,
                registroId: id
            }
        });
        
    } catch (error) {
        console.error('Error eliminando comprobante:', error);
        
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: obtenerTabla(tipo),
            registroId: id,
            detallesAdicionales: `Error eliminando comprobante: ${error.message}`
        });
        
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
};

/**
 * Verificar si existe comprobante
 * GET /comprobantes/verificar/:tipo/:id
 */
const verificarComprobante = async (req, res) => {
    const { tipo, id } = req.params;
    
    if (!validarTipo(tipo)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tipo no válido. Debe ser: venta, compra o gasto' 
        });
    }
    
    try {
        const tabla = obtenerTabla(tipo);
        const query = `SELECT comprobante_path FROM ${tabla} WHERE id = ?`;
        const result = await queryPromise(query, [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} no encontrada` 
            });
        }
        
        const tieneComprobante = !!result[0].comprobante_path;
        const rutaComprobante = result[0].comprobante_path;
        
        // Verificar si el archivo existe físicamente
        let archivoExiste = false;
        if (rutaComprobante) {
            const rutaCompleta = path.join(__dirname, '..', rutaComprobante);
            archivoExiste = fs.existsSync(rutaCompleta);
        }
        
        res.json({ 
            success: true, 
            data: {
                tipo,
                registroId: id,
                tieneComprobante,
                rutaComprobante,
                archivoExiste,
                nombreArchivo: tieneComprobante ? obtenerNombreArchivo(tipo, id) : null
            }
        });
        
    } catch (error) {
        console.error('Error verificando comprobante:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
};

/**
 * Listar comprobantes por tipo
 * GET /comprobantes/listar/:tipo
 */
const listarComprobantes = async (req, res) => {
    const { tipo } = req.params;
    const { limite = 50, pagina = 1 } = req.query;
    
    if (!validarTipo(tipo)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tipo no válido. Debe ser: venta, compra o gasto' 
        });
    }
    
    try {
        const tabla = obtenerTabla(tipo);
        const offset = (parseInt(pagina) - 1) * parseInt(limite);
        
        // Obtener registros con comprobantes
        let query, camposAdicionales;
        
        switch (tipo) {
            case 'venta':
                camposAdicionales = 'cliente_nombre, total, fecha';
                break;
            case 'compra':
                camposAdicionales = 'proveedor_nombre, total, fecha';
                break;
            case 'gasto':
                camposAdicionales = 'descripcion, monto, fecha';
                break;
        }
        
        query = `
            SELECT id, ${camposAdicionales}, comprobante_path,
                   CASE WHEN comprobante_path IS NOT NULL THEN 1 ELSE 0 END as tiene_comprobante
            FROM ${tabla} 
            ORDER BY fecha DESC 
            LIMIT ? OFFSET ?
        `;
        
        const resultados = await queryPromise(query, [parseInt(limite), offset]);
        
        // Contar total
        const countQuery = `SELECT COUNT(*) as total FROM ${tabla}`;
        const countResult = await queryPromise(countQuery);
        const total = countResult[0].total;
        
        res.json({ 
            success: true, 
            data: resultados,
            paginacion: {
                pagina_actual: parseInt(pagina),
                total_registros: total,
                total_paginas: Math.ceil(total / parseInt(limite)),
                registros_por_pagina: parseInt(limite)
            }
        });
        
    } catch (error) {
        console.error('Error listando comprobantes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
};

/**
 * Obtener estadísticas de comprobantes
 * GET /comprobantes/estadisticas
 */
const obtenerEstadisticas = async (req, res) => {
    try {
        const tipos = ['ventas', 'compras', 'gastos'];
        const estadisticas = {};
        
        for (const tabla of tipos) {
            const tipo = tabla.slice(0, -1); // Quitar la 's' al final
            
            // Total de registros
            const totalQuery = `SELECT COUNT(*) as total FROM ${tabla}`;
            const totalResult = await queryPromise(totalQuery);
            
            // Registros con comprobante
            const conComprobanteQuery = `SELECT COUNT(*) as con_comprobante FROM ${tabla} WHERE comprobante_path IS NOT NULL`;
            const conComprobanteResult = await queryPromise(conComprobanteQuery);
            
            // Registros sin comprobante
            const sinComprobanteQuery = `SELECT COUNT(*) as sin_comprobante FROM ${tabla} WHERE comprobante_path IS NULL`;
            const sinComprobanteResult = await queryPromise(sinComprobanteQuery);
            
            const total = totalResult[0].total;
            const conComprobante = conComprobanteResult[0].con_comprobante;
            const sinComprobante = sinComprobanteResult[0].sin_comprobante;
            
            estadisticas[tipo] = {
                total,
                con_comprobante: conComprobante,
                sin_comprobante: sinComprobante,
                porcentaje_con_comprobante: total > 0 ? Math.round((conComprobante / total) * 100) : 0
            };
        }
        
        res.json({ 
            success: true, 
            data: estadisticas
        });
        
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
};

// ===========================================
// EXPORTS
// ===========================================

module.exports = {
    subirComprobante,
    obtenerComprobante,
    eliminarComprobante,
    verificarComprobante,
    listarComprobantes,
    obtenerEstadisticas
};