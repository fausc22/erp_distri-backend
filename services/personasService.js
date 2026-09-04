const db = require('../db/legacyAdapter');
const { parsePagination, toPositiveInt } = require('../utils/pagination');
const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');
const { invalidate } = require('../utils/cache');
const { validarDatosCliente, normalizarCuit } = require('../utils/validadoresCliente');

const nuevoCliente = async (req, res) => {
    const { nombre, nombre_alternativo, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, ciudad_id, validado_afip } = req.body;

    // Fase 2: validaciones antes de insertar
    const { valido, errores } = validarDatosCliente(req.body);
    if (!valido) {
        return res.status(400).json({
            success: false,
            message: errores.join(' '),
            errors: errores
        });
    }

    // ciudad_id debe ser entero o null; el front puede enviar '' si no eligió ciudad
    const ciudadIdNormalizado = (ciudad_id !== '' && ciudad_id !== undefined && ciudad_id !== null && !isNaN(Number(ciudad_id)))
        ? Number(ciudad_id)
        : null;

    // Fase 4: marcar validación AFIP si el front envió el flag
    const validadoAfipAt = (validado_afip === true || validado_afip === 'true') ? new Date() : null;

    // Fase 3: guardar CUIT normalizado (solo dígitos) para consistencia
    const cuitGuardar = normalizarCuit(cuit);
    const dniGuardar = dni != null && String(dni).trim() !== '' ? String(dni).replace(/\D/g, '') : (dni || '');
    const nombreAlternativoGuardar = nombre_alternativo != null ? String(nombre_alternativo).trim() : '';

    const query = `
        INSERT INTO clientes (nombre, nombre_alternativo, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, ciudad_id, validado_afip_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, nombreAlternativoGuardar, condicion_iva, cuitGuardar, dniGuardar, direccion, ciudad, provincia, telefono, email, ciudadIdNormalizado, validadoAfipAt], async (err, results) => {
        if (err) {
            console.error('Error al insertar el cliente:', err);

            // Auditar error en creación
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'clientes',
                detallesAdicionales: `Error al crear cliente: ${err.message}`,
                datosNuevos: req.body
            });

            return res.status(500).json({ success: false, message: "Error al insertar el cliente" });
        }

        // Obtener el cliente recién creado con todos sus datos (Fase 1: siempre devolver data con id)
        const clienteId = results.insertId != null ? Number(results.insertId) : null;
        db.query('SELECT * FROM clientes WHERE id = ?', [clienteId], async (err, clienteResults) => {
            if (err) {
                console.error('Error al obtener el cliente creado:', err);
                // Fallback: data con id y campos del body para que el frontend siempre reciba objeto con id
                const dataFallback = {
                    id: clienteId,
                    nombre: nombre || '',
                    nombre_alternativo: nombreAlternativoGuardar,
                    condicion_iva: condicion_iva || '',
                    cuit: cuitGuardar || '',
                    dni: dniGuardar || '',
                    direccion: direccion || '',
                    ciudad: ciudad || '',
                    provincia: provincia || '',
                    telefono: telefono || '',
                    email: email || '',
                    ciudad_id: ciudadIdNormalizado
                };
                invalidate('clientes:*');
                return res.json({
                    success: true,
                    message: "Cliente agregado correctamente",
                    data: dataFallback,
                    insertId: clienteId
                });
            }

            let clienteCreado = clienteResults && clienteResults[0];
            if (!clienteCreado) {
                clienteCreado = {
                    id: clienteId,
                    nombre: nombre || '',
                    nombre_alternativo: nombreAlternativoGuardar,
                    condicion_iva: condicion_iva || '',
                    cuit: cuitGuardar || '',
                    dni: dniGuardar || '',
                    direccion: direccion || '',
                    ciudad: ciudad || '',
                    provincia: provincia || '',
                    telefono: telefono || '',
                    email: email || '',
                    ciudad_id: ciudadIdNormalizado
                };
            } else if (clienteCreado.id == null) {
                clienteCreado.id = clienteId;
            }

            // Auditar creación exitosa del cliente
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'clientes',
                registroId: clienteId,
                datosNuevos: clienteCreado,
                detallesAdicionales: `Cliente creado: ${nombre}`
            });

            invalidate('clientes:*');

            res.json({
                success: true,
                message: "Cliente agregado correctamente",
                data: clienteCreado,
                insertId: clienteId
            });
        });
    });
};

const buscarCliente = (req, res) => {
    const rawSearch = (req.query.search || '').toString().trim();
    const searchTerm = rawSearch ? `%${rawSearch}%` : '%';

    // Paginación opcional (compatibilidad: si no se envía pagina/porPagina, devuelve todos)
    const paginaRaw = toPositiveInt(req.query.pagina, 0);
    const porPaginaRaw = toPositiveInt(req.query.porPagina, 0);
    const usarPaginacion = paginaRaw > 0 && porPaginaRaw > 0;
    const paginacion = usarPaginacion
        ? parsePagination(req.query, { minPageSize: 10, maxPageSize: 200 })
        : null;
    const pagina = paginacion?.pagina || 1;
    const porPagina = paginacion?.porPagina || null;
    const offset = paginacion?.offset || 0;

    const sortByParam = (req.query.sortBy || 'nombre').toString().trim().toLowerCase();
    const sortOrderParam = (req.query.sortOrder || 'asc').toString().trim().toLowerCase();
    const SORTABLE_COLUMNS = {
        nombre: 'nombre',
        condicion_iva: 'condicion_iva',
        cuit: 'cuit',
        direccion: 'direccion',
        ciudad: 'ciudad'
    };
    const sortBy = SORTABLE_COLUMNS[sortByParam] || 'nombre';
    const sortOrder = sortOrderParam === 'desc' ? 'DESC' : 'ASC';

    const whereClause = 'WHERE (nombre LIKE ? OR cuit LIKE ? OR ciudad LIKE ?)';
    const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

    const queryData = usarPaginacion
        ? `SELECT * FROM clientes ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
        : `SELECT * FROM clientes ${whereClause} ${orderClause}`;
    const dataParamsBase = [searchTerm, searchTerm, searchTerm];
    const dataParams = usarPaginacion ? [...dataParamsBase, porPagina, offset] : dataParamsBase;

    db.query(queryData, dataParams, (err, results) => {
        if (err) {
            console.error('Error al obtener los clientes:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
        }

        if (!usarPaginacion) {
            return res.json({ success: true, data: results });
        }

        const queryCount = `SELECT COUNT(*) as total FROM clientes ${whereClause}`;
        db.query(queryCount, dataParamsBase, (countErr, countRows) => {
            if (countErr) {
                console.error('Error al contar clientes:', countErr);
                return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
            }

            const total = Number(countRows?.[0]?.total || 0);
            return res.json({
                success: true,
                data: results,
                total,
                pagina,
                porPagina
            });
        });
    });
};


const actualizarCliente = async (req, res) => {
    const clienteId = req.params.id;
    const { nombre, nombre_alternativo, condicion_iva, cuit, dni, direccion, ciudad, ciudad_id, provincia, telefono, email, validado_afip } = req.body;
                                                           

    // Obtener datos anteriores para auditoría
    const obtenerDatosAnterioresPromise = () => {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM clientes WHERE id = ?', [clienteId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
    };

    try {
        const datosAnteriores = await obtenerDatosAnterioresPromise();

        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: "Cliente no encontrado" });
        }

        // Fase 2: validaciones antes de actualizar
        const { valido, errores } = validarDatosCliente(req.body);
        if (!valido) {
            return res.status(400).json({
                success: false,
                message: errores.join(' '),
                errors: errores
            });
        }

        // Fase 3: normalizar CUIT/DNI al guardar
        const cuitGuardar = normalizarCuit(cuit);
        const dniGuardar = dni != null && String(dni).trim() !== '' ? String(dni).replace(/\D/g, '') : (dni || '');

        // Verificar si el cliente existe antes de actualizar
        const checkQuery = `SELECT id FROM clientes WHERE id = ?`;
        db.query(checkQuery, [clienteId], (err, results) => {
            if (err) {
                console.error('Error al verificar el cliente:', err);
                return res.status(500).json({ success: false, message: "Error al verificar el cliente" });
            }

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "Cliente no encontrado" });
            }

            // ciudad_id: entero o null (el front puede enviar '')
            const ciudadIdUpdate = (ciudad_id !== '' && ciudad_id !== undefined && ciudad_id !== null && !isNaN(Number(ciudad_id)))
                ? Number(ciudad_id)
                : null;

            // Fase 4: si el front envía validado_afip = true, actualizar validado_afip_at
            const actualizarValidadoAfip = (validado_afip === true || validado_afip === 'true') ? 1 : 0;
            const nombreAlternativoGuardar = nombre_alternativo != null ? String(nombre_alternativo).trim() : '';

            const updateQuery = `
                UPDATE clientes 
                SET nombre = ?, nombre_alternativo = ?, condicion_iva = ?, cuit = ?, dni = ?, direccion = ?, ciudad = ?, ciudad_id = ?, provincia = ?, telefono = ?, email = ?, validado_afip_at = IF(? = 1, NOW(), validado_afip_at)
                WHERE id = ?
            `;

            db.query(updateQuery, [nombre, nombreAlternativoGuardar, condicion_iva, cuitGuardar, dniGuardar, direccion, ciudad, ciudadIdUpdate, provincia, telefono, email, actualizarValidadoAfip, clienteId], async (error, updateResults) => {
                if (error) {
                    console.error('Error al actualizar el cliente:', error);
                    
                    // Auditar error en actualización
                    await auditarOperacion(req, {
                        accion: 'UPDATE',
                        tabla: 'clientes',
                        registroId: clienteId,
                        detallesAdicionales: `Error al actualizar cliente: ${error.message}`,
                        datosAnteriores,
                        datosNuevos: req.body
                    });
                    
                    return res.status(500).json({ success: false, message: "Error al actualizar el cliente" });
                }

                if (updateResults.affectedRows === 0) {
                    return res.status(400).json({ success: false, message: "No se realizaron cambios" });
                }

                // Auditar actualización exitosa
                await auditarOperacion(req, {
                    accion: 'UPDATE',
                    tabla: 'clientes',
                    registroId: clienteId,
                    datosAnteriores,
                    datosNuevos: {
                        id: clienteId,
                        ...req.body
                    },
                    detallesAdicionales: `Cliente actualizado: ${nombre}`
                });

                invalidate('clientes:*');

                // Fase 1: devolver siempre data con el cliente actualizado (cuit/dni ya normalizados en DB)
                db.query('SELECT * FROM clientes WHERE id = ?', [clienteId], (errSel, selResults) => {
                    if (errSel) {
                        console.error('Error al obtener cliente actualizado:', errSel);
                        return res.json({
                            success: true,
                            message: "Cliente actualizado correctamente",
                            data: { id: clienteId, nombre, condicion_iva, cuit: cuitGuardar, dni: dniGuardar, direccion, ciudad, provincia, telefono, email, ciudad_id: ciudadIdUpdate }
                        });
                    }
                    const clienteActualizado = selResults && selResults[0];
                    res.json({
                        success: true,
                        message: "Cliente actualizado correctamente",
                        data: clienteActualizado || { id: clienteId, nombre, condicion_iva, cuit: cuitGuardar, dni: dniGuardar, direccion, ciudad, provincia, telefono, email, ciudad_id: ciudadIdUpdate }
                    });
                });
            });
        });
    } catch (error) {
        console.error('Error al obtener datos anteriores:', error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};


// Obtener todos los clientes (sin filtro de búsqueda)
const obtenerTodosClientes = (req, res) => {
    const query = `SELECT * FROM clientes ORDER BY nombre ASC`;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener los clientes:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
        }
        res.json({ success: true, data: results });
    });
};

// Obtener un cliente por ID
const obtenerClientePorId = (req, res) => {
    const clienteId = req.params.id;

    const query = `SELECT * FROM clientes WHERE id = ?`;

    db.query(query, [clienteId], (err, results) => {
        if (err) {
            console.error('Error al obtener el cliente:', err);
            return res.status(500).json({ success: false, message: "Error al obtener el cliente" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Cliente no encontrado" });
        }

        res.json({ success: true, data: results[0] });
    });
};

// Eliminar cliente (con pre-check de dependencias)
const eliminarCliente = async (req, res) => {
    const clienteId = req.params.id;

    // Primero verificar si el cliente existe
    const checkQuery = `SELECT * FROM clientes WHERE id = ?`;
    
    db.query(checkQuery, [clienteId], async (err, results) => {
        if (err) {
            console.error('Error al verificar el cliente:', err);
            return res.status(500).json({ success: false, message: "Error al verificar el cliente" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Cliente no encontrado" });
        }

        const datosAnteriores = results[0];

        // Pre-check: no eliminar si tiene pedidos asociados
        db.query('SELECT COUNT(*) as total FROM pedidos WHERE cliente_id = ?', [clienteId], async (countErr, countRows) => {
            if (countErr) {
                console.error('Error al verificar pedidos del cliente:', countErr);
                return res.status(500).json({ success: false, message: "Error al verificar dependencias del cliente" });
            }

            const totalPedidos = Number(countRows?.[0]?.total || 0);
            if (totalPedidos > 0) {
                return res.status(409).json({
                    success: false,
                    message: `Este cliente tiene ${totalPedidos} pedido${totalPedidos === 1 ? '' : 's'} asociado${totalPedidos === 1 ? '' : 's'} y no puede eliminarse`
                });
            }

            // Eliminar el cliente
            const deleteQuery = `DELETE FROM clientes WHERE id = ?`;
            
            db.query(deleteQuery, [clienteId], async (deleteErr, deleteResults) => {
                if (deleteErr) {
                    console.error('Error al eliminar el cliente:', deleteErr);
                    
                    // Auditar error en eliminación
                    await auditarOperacion(req, {
                        accion: 'DELETE',
                        tabla: 'clientes',
                        registroId: clienteId,
                        detallesAdicionales: `Error al eliminar cliente: ${deleteErr.message}`,
                        datosAnteriores
                    });
                    
                    return res.status(500).json({ success: false, message: "Error al eliminar el cliente" });
                }

                // Auditar eliminación exitosa
                await auditarOperacion(req, {
                    accion: 'DELETE',
                    tabla: 'clientes',
                    registroId: clienteId,
                    datosAnteriores,
                    detallesAdicionales: `Cliente eliminado: ${datosAnteriores.nombre}`
                });

                invalidate('clientes:*');

                res.json({ success: true, message: "Cliente eliminado correctamente" });
            });
        });
    });
};

const nuevoProveedor = async (req, res) => {
    const { nombre, nombre_alternativo, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    if (!nombre || !condicion_iva || !cuit || !dni || !direccion || !ciudad || !provincia || !telefono || email === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const nombreAlternativoGuardar = nombre_alternativo != null ? String(nombre_alternativo).trim() : '';

    const query = `
        INSERT INTO proveedores (nombre, nombre_alternativo, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, nombreAlternativoGuardar, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email], async (err, results) => {
        if (err) {
            console.error('Error al insertar el proveedor:', err);
            
            // Auditar error en creación
            await auditarOperacion(req, {
                accion: 'INSERT',
                tabla: 'proveedores',
                detallesAdicionales: `Error al crear proveedor: ${err.message}`,
                datosNuevos: req.body
            });
            
            return res.status(500).json({ success: false, message: "Error al insertar el proveedor" });
        }
        
        // Auditar creación exitosa del proveedor
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'proveedores',
            registroId: results.insertId,
            datosNuevos: { 
                id: results.insertId,
                ...req.body,
                nombre_alternativo: nombreAlternativoGuardar
            },
            detallesAdicionales: `Proveedor creado: ${nombre}`
        });

        invalidate('proveedores:*');
        
        res.json({ success: true, message: "Proveedor agregado correctamente", data: results });
    });
};

const buscarProveedor = (req, res) => {
    const rawSearch = (req.query.search || '').toString().trim();
    const searchTerm = rawSearch ? `%${rawSearch}%` : '%';

    // Paginación opcional (compatibilidad: si no se envía pagina/porPagina, devuelve todos)
    const paginaRaw = toPositiveInt(req.query.pagina, 0);
    const porPaginaRaw = toPositiveInt(req.query.porPagina, 0);
    const usarPaginacion = paginaRaw > 0 && porPaginaRaw > 0;
    const paginacion = usarPaginacion
        ? parsePagination(req.query, { minPageSize: 10, maxPageSize: 200 })
        : null;
    const pagina = paginacion?.pagina || 1;
    const porPagina = paginacion?.porPagina || null;
    const offset = paginacion?.offset || 0;

    const sortByParam = (req.query.sortBy || 'nombre').toString().trim().toLowerCase();
    const sortOrderParam = (req.query.sortOrder || 'asc').toString().trim().toLowerCase();
    const SORTABLE_COLUMNS = {
        nombre: 'nombre',
        condicion_iva: 'condicion_iva',
        cuit: 'cuit',
        direccion: 'direccion',
        ciudad: 'ciudad'
    };
    const sortBy = SORTABLE_COLUMNS[sortByParam] || 'nombre';
    const sortOrder = sortOrderParam === 'desc' ? 'DESC' : 'ASC';

    const whereClause = 'WHERE (nombre LIKE ? OR nombre_alternativo LIKE ? OR cuit LIKE ? OR ciudad LIKE ? OR provincia LIKE ?)';
    const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

    const queryData = usarPaginacion
        ? `SELECT * FROM proveedores ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
        : `SELECT * FROM proveedores ${whereClause} ${orderClause}`;
    const dataParamsBase = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];
    const dataParams = usarPaginacion ? [...dataParamsBase, porPagina, offset] : dataParamsBase;

    db.query(queryData, dataParams, (err, results) => {
        if (err) {
            console.error('Error al obtener los proveedores:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los proveedores" });
        }

        if (!usarPaginacion) {
            return res.json({ success: true, data: results });
        }

        const queryCount = `SELECT COUNT(*) as total FROM proveedores ${whereClause}`;
        db.query(queryCount, dataParamsBase, (countErr, countRows) => {
            if (countErr) {
                console.error('Error al contar proveedores:', countErr);
                return res.status(500).json({ success: false, message: "Error al obtener los proveedores" });
            }

            const total = Number(countRows?.[0]?.total || 0);
            return res.json({
                success: true,
                data: results,
                total,
                pagina,
                porPagina
            });
        });
    });
};

const actualizarProveedor = async (req, res) => {
    const proveedorId = req.params.id;
    const { nombre, nombre_alternativo, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    if (!nombre || !condicion_iva || !cuit || !dni || !direccion || !ciudad || !provincia || !telefono || email === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const nombreAlternativoGuardar = nombre_alternativo != null ? String(nombre_alternativo).trim() : '';

    // Obtener datos anteriores para auditoría
    const obtenerDatosAnterioresPromise = () => {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM proveedores WHERE id = ?', [proveedorId], (err, results) => {
                if (err) return reject(err);
                resolve(results.length > 0 ? results[0] : null);
            });
        });
    };

    try {
        const datosAnteriores = await obtenerDatosAnterioresPromise();
        
        if (!datosAnteriores) {
            return res.status(404).json({ success: false, message: "Proveedor no encontrado" });
        }

        // Verificar si el proveedor existe antes de actualizar
        const checkQuery = `SELECT id FROM proveedores WHERE id = ?`;
        db.query(checkQuery, [proveedorId], (err, results) => {
            if (err) {
                console.error('Error al verificar el proveedor:', err);
                return res.status(500).json({ success: false, message: "Error al verificar el proveedor" });
            }

            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "Proveedor no encontrado" });
            }

            // Si el proveedor existe, proceder con la actualización
            const updateQuery = `
                UPDATE proveedores 
                SET nombre = ?, nombre_alternativo = ?, condicion_iva = ?, cuit = ?, dni = ?, direccion = ?, ciudad = ?, provincia = ?, telefono = ?, email = ? 
                WHERE id = ?
            `;

            db.query(updateQuery, [nombre, nombreAlternativoGuardar, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, proveedorId], async (error, updateResults) => {
                if (error) {
                    console.error('Error al actualizar el proveedor:', error);
                    
                    // Auditar error en actualización
                    await auditarOperacion(req, {
                        accion: 'UPDATE',
                        tabla: 'proveedores',
                        registroId: proveedorId,
                        detallesAdicionales: `Error al actualizar proveedor: ${error.message}`,
                        datosAnteriores,
                        datosNuevos: req.body
                    });
                    
                    return res.status(500).json({ success: false, message: "Error al actualizar el proveedor" });
                }

                if (updateResults.affectedRows === 0) {
                    return res.status(400).json({ success: false, message: "No se realizaron cambios" });
                }

                // Auditar actualización exitosa
                await auditarOperacion(req, {
                    accion: 'UPDATE',
                    tabla: 'proveedores',
                    registroId: proveedorId,
                    datosAnteriores,
                    datosNuevos: { 
                        id: proveedorId,
                        ...req.body,
                        nombre_alternativo: nombreAlternativoGuardar
                    },
                    detallesAdicionales: `Proveedor actualizado: ${nombre}`
                });

                invalidate('proveedores:*');

                res.json({ success: true, message: "Proveedor actualizado correctamente" });
            });
        });
    } catch (error) {
        console.error('Error al obtener datos anteriores:', error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};

const obtenerTodosProveedores = (req, res) => {
    const query = `SELECT * FROM proveedores ORDER BY nombre ASC`;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener los proveedores:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los proveedores" });
        }
        res.json({ success: true, data: results });
    });
};

// Obtener un proveedor por ID
const obtenerProveedorPorId = (req, res) => {
    const proveedorId = req.params.id;

    const query = `SELECT * FROM proveedores WHERE id = ?`;

    db.query(query, [proveedorId], (err, results) => {
        if (err) {
            console.error('Error al obtener el proveedor:', err);
            return res.status(500).json({ success: false, message: "Error al obtener el proveedor" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Proveedor no encontrado" });
        }

        res.json({ success: true, data: results[0] });
    });
};

// Eliminar proveedor
const eliminarProveedor = async (req, res) => {
    const proveedorId = req.params.id;

    const checkQuery = `SELECT * FROM proveedores WHERE id = ?`;
    
    db.query(checkQuery, [proveedorId], async (err, results) => {
        if (err) {
            console.error('Error al verificar el proveedor:', err);
            return res.status(500).json({ success: false, message: "Error al verificar el proveedor" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Proveedor no encontrado" });
        }

        const datosAnteriores = results[0];

        const deleteQuery = `DELETE FROM proveedores WHERE id = ?`;
        
        db.query(deleteQuery, [proveedorId], async (deleteErr, deleteResults) => {
            if (deleteErr) {
                console.error('Error al eliminar el proveedor:', deleteErr);
                
                await auditarOperacion(req, {
                    accion: 'DELETE',
                    tabla: 'proveedores',
                    registroId: proveedorId,
                    detallesAdicionales: `Error al eliminar proveedor: ${deleteErr.message}`,
                    datosAnteriores
                });
                
                return res.status(500).json({ success: false, message: "Error al eliminar el proveedor" });
            }

            await auditarOperacion(req, {
                accion: 'DELETE',
                tabla: 'proveedores',
                registroId: proveedorId,
                datosAnteriores,
                detallesAdicionales: `Proveedor eliminado: ${datosAnteriores.nombre}`
            });

            invalidate('proveedores:*');

            res.json({ success: true, message: "Proveedor eliminado correctamente" });
        });
    });
};

/**
 * Consulta datos del contribuyente en AFIP por DNI o CUIT.
 * Delega en arca-microservice (misma config cert/key que CAE).
 * POST /personas/consulta-afip
 * Body: { dni?: string, cuit?: string } (uno de los dos)
 */
const consultaAfip = async (req, res) => {
    let billingController;
    try {
        const billingModule = await import('../arca-microservice/controllers/billing.controller.js');
        billingController = billingModule.default;
    } catch (err) {
        console.error('Error cargando microservicio ARCA:', err.message);
        return res.status(503).json({
            success: false,
            message: 'Servicio AFIP no disponible. Intente nuevamente en unos segundos.'
        });
    }

    const mockReq = { body: req.body || {} };
    const mockRes = {
        statusCode: 200,
        _body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this._body = body; return this; }
    };

    await billingController.consultaContribuyente(mockReq, mockRes);
    return res.status(mockRes.statusCode).json(mockRes._body);
};

module.exports = {
    nuevoCliente,
    actualizarCliente,
    buscarCliente,
    obtenerTodosClientes,
    obtenerClientePorId,
    eliminarCliente,
    consultaAfip,

    nuevoProveedor,
    buscarProveedor,
    actualizarProveedor,
    obtenerTodosProveedores,
    obtenerProveedorPorId,
    eliminarProveedor
};