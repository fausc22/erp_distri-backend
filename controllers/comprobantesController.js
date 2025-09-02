

const db = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auditarOperacion } = require('../middlewares/auditoriaMiddleware');
const jwt = require('jsonwebtoken');

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
        
        // Establecer headers apropiados
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
        
        // CAMBIO IMPORTANTE: usar 'inline' en lugar de 'attachment' para mostrar en el navegador
        const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `${disposition}; filename="${nombreArchivo}"`);
        
        // Headers adicionales para CORS si es necesario
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        
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



/**
 * Generar link público para cargar comprobante
 * POST /comprobantes/generar-link/venta/:id
 */
const generarLinkPublico = async (req, res) => {
    const { id } = req.params;
    const tipoRegistro = 'venta'; // Fijo para ventas
    
    try {
        const tabla = obtenerTabla(tipoRegistro);
        
        // Verificar que el registro existe y no tiene comprobante
        const checkQuery = `SELECT id, cliente_nombre, total, fecha, comprobante_path FROM ${tabla} WHERE id = ?`;
        const result = await queryPromise(checkQuery, [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `${tipoRegistro.charAt(0).toUpperCase() + tipoRegistro.slice(1)} no encontrada` 
            });
        }
        
        const registro = result[0];
        
        // Verificar si ya tiene comprobante
        if (registro.comprobante_path) {
            return res.status(400).json({ 
                success: false, 
                message: 'Esta venta ya tiene un comprobante cargado' 
            });
        }
        
        // Generar JWT con expiración de 24 horas
        const payload = {
            venta_id: parseInt(id),
            tipo: tipoRegistro,
            cliente_nombre: registro.cliente_nombre,
            total: registro.total,
            fecha: registro.fecha
        };
        
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        // Auditar generación de link
        await auditarOperacion(req, {
            accion: 'GENERATE_LINK',
            tabla: tabla,
            registroId: id,
            detallesAdicionales: `Link público generado para ${tipoRegistro} - Cliente: ${registro.cliente_nombre}`
        });
        
        // Construir URL completa
        const baseUrl = process.env.FRONTEND_URL;
        const linkPublico = `${baseUrl}/comprobante-publico/${token}`;
        
        res.json({ 
            success: true, 
            message: 'Link público generado exitosamente',
            data: {
                link: linkPublico,
                token: token,
                expira: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 horas
                cliente: registro.cliente_nombre,
                monto: registro.total
            }
        });
        
    } catch (error) {
        console.error('Error generando link público:', error);
        
        await auditarOperacion(req, {
            accion: 'GENERATE_LINK',
            tabla: obtenerTabla(tipoRegistro),
            registroId: id,
            detallesAdicionales: `Error generando link público: ${error.message}`
        });
        
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor' 
        });
    }
};

/**
 * Verificar token público
 * GET /comprobantes/publico/verificar/:token
 */
const verificarTokenPublico = async (req, res) => {
    const { token } = req.params;
    
    try {
        // Verificar y decodificar JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { venta_id, tipo, cliente_nombre, total, fecha } = decoded;
        
        // Verificar que el registro aún existe y no tiene comprobante
        const tabla = obtenerTabla(tipo);
        const checkQuery = `SELECT id, cliente_nombre, total, fecha, comprobante_path FROM ${tabla} WHERE id = ?`;
        const result = await queryPromise(checkQuery, [venta_id]);
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                valido: false,
                message: 'La venta asociada ya no existe' 
            });
        }
        
        const registro = result[0];
        
        // Verificar si ya tiene comprobante (link usado)
        if (registro.comprobante_path) {
            return res.status(400).json({ 
                success: false, 
                valido: false,
                message: 'Este enlace ya fue utilizado. El comprobante ya está cargado.' 
            });
        }
        
        res.json({ 
            success: true, 
            valido: true,
            message: 'Token válido',
            venta: {
                id: registro.id,
                cliente_nombre: registro.cliente_nombre,
                total: registro.total,
                fecha: registro.fecha
            }
        });
        
    } catch (error) {
        console.error('Error verificando token:', error);
        
        let message = 'Token no válido';
        
        if (error.name === 'TokenExpiredError') {
            message = 'El enlace ha expirado. Los enlaces son válidos por 24 horas.';
        } else if (error.name === 'JsonWebTokenError') {
            message = 'El enlace no es válido o ha sido modificado.';
        }
        
        res.status(400).json({ 
            success: false, 
            valido: false,
            message: message 
        });
    }
};

/**
 * Subir comprobante usando token público (SIN AUTENTICACIÓN)
 * POST /comprobantes/publico/subir/:token
 */
const subirComprobantePublico = async (req, res) => {
    const { token } = req.params;
    
    // Configurar multer para esta request específica
    upload(req, res, async (err) => {
        if (err) {
            console.error('Error en upload público:', err);
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
            // Verificar y decodificar JWT
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const { venta_id, tipo } = decoded;
            
            const tabla = obtenerTabla(tipo);
            
            // Verificar que el registro existe y no tiene comprobante
            const checkQuery = `SELECT id, comprobante_path FROM ${tabla} WHERE id = ?`;
            const checkResult = await queryPromise(checkQuery, [venta_id]);
            
            if (checkResult.length === 0) {
                await eliminarArchivo(req.file.path);
                return res.status(404).json({ 
                    success: false, 
                    message: 'La venta asociada no existe' 
                });
            }
            
            // Verificar si ya tiene comprobante (doble verificación)
            if (checkResult[0].comprobante_path) {
                await eliminarArchivo(req.file.path);
                return res.status(400).json({ 
                    success: false, 
                    message: 'Esta venta ya tiene un comprobante. El enlace ha sido desactivado.' 
                });
            }
            
            // Renombrar archivo con formato TIPO-ID
            const nombreArchivo = obtenerNombreArchivo(tipo, venta_id);
            const nuevaRuta = await renombrarArchivo(req.file.path, nombreArchivo);
            const rutaRelativa = path.relative(path.join(__dirname, '..'), nuevaRuta);
            
            // Actualizar base de datos
            const updateQuery = `UPDATE ${tabla} SET comprobante_path = ? WHERE id = ?`;
            await queryPromise(updateQuery, [rutaRelativa, venta_id]);
            
            // Auditar (sin req.user porque es público)
            await auditarOperacionPublica({
                accion: 'UPLOAD_PUBLIC',
                tabla: tabla,
                registroId: venta_id,
                detallesAdicionales: `Comprobante subido vía link público: ${req.file.originalname} -> ${nombreArchivo}`,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            
            res.json({ 
                success: true, 
                message: 'Comprobante subido exitosamente',
                data: {
                    tipo,
                    registroId: venta_id,
                    nombreOriginal: req.file.originalname,
                    nombreArchivo: nombreArchivo
                }
            });
            
        } catch (error) {
            console.error('Error subiendo comprobante público:', error);
            await eliminarArchivo(req.file.path);
            
            let message = 'Error al subir el comprobante';
            
            if (error.name === 'TokenExpiredError') {
                message = 'El enlace ha expirado. Los enlaces son válidos por 24 horas.';
            } else if (error.name === 'JsonWebTokenError') {
                message = 'El enlace no es válido.';
            }
            
            // Auditar error
            await auditarOperacionPublica({
                accion: 'UPLOAD_PUBLIC',
                tabla: 'comprobantes_publicos',
                detallesAdicionales: `Error subiendo comprobante público: ${error.message}`,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            
            res.status(400).json({ 
                success: false, 
                message: message 
            });
        }
    });
};

// Función helper para auditoría pública (sin usuario autenticado)
const auditarOperacionPublica = async ({
    accion,
    tabla,
    registroId = null,
    detallesAdicionales = null,
    ip = null,
    userAgent = null
}) => {
    try {
        const query = `
            INSERT INTO auditoria (
                usuario_id, usuario_nombre, accion, tabla_afectada, registro_id,
                datos_anteriores, datos_nuevos, ip_address, user_agent, endpoint,
                metodo_http, detalles_adicionales, estado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const valores = [
            null, // sin usuario
            'PÚBLICO',
            accion,
            tabla,
            registroId ? registroId.toString() : null,
            null, // sin datos anteriores
            null, // sin datos nuevos
            ip,
            userAgent,
            '/comprobantes/publico/*',
            'POST',
            detallesAdicionales,
            'EXITOSO'
        ];

        await queryPromise(query, valores);
    } catch (error) {
        console.error('Error en auditoría pública:', error);
    }
};


const verificarComprobantesMasivo = async (req, res) => {
    const { ventasIds } = req.body;
    
    if (!ventasIds || !Array.isArray(ventasIds) || ventasIds.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Se requiere un array de IDs de ventas'
        });
    }
    
    try {
        const query = `SELECT id, comprobante_path FROM ventas WHERE id IN (${ventasIds.map(() => '?').join(',')})`;
        const ventas = await queryPromise(query, ventasIds);
        
        const verificaciones = ventas.map(venta => {
            const tieneComprobanteBD = !!venta.comprobante_path;
            const archivoExiste = tieneComprobanteBD ? verificarArchivoFisico(venta.comprobante_path) : false;
            
            return {
                id: venta.id,
                tieneComprobanteBD,
                archivoExiste,
                tieneComprobanteReal: archivoExiste,
                comprobante_path: venta.comprobante_path
            };
        });
        
        res.json({
            success: true,
            data: verificaciones
        });
        
    } catch (error) {
        console.error('Error en verificación masiva:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};

// Función helper para verificar archivo físico
const verificarArchivoFisico = (comprobantePath) => {
    if (!comprobantePath) return false;
    
    try {
        const rutaCompleta = path.join(__dirname, '..', comprobantePath);
        return fs.existsSync(rutaCompleta);
    } catch (error) {
        return false;
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
    obtenerEstadisticas,
    generarLinkPublico,
    verificarTokenPublico,
    subirComprobantePublico,
    verificarComprobantesMasivo
};