const db = require('./db');
const { auditarOperacion, obtenerDatosAnteriores } = require('../middlewares/auditoriaMiddleware');

const nuevoCliente = async (req, res) => {
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    const query = `
        INSERT INTO clientes (nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email], async (err, results) => {
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
        
        // Auditar creación exitosa del cliente
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'clientes',
            registroId: results.insertId,
            datosNuevos: { 
                id: results.insertId,
                ...req.body
            },
            detallesAdicionales: `Cliente creado: ${nombre}`
        });
        
        res.json({ success: true, message: "Cliente agregado correctamente", data: results });
    });
};

const buscarCliente = (req, res) => {
    const searchTerm = req.query.search ? `%${req.query.search}%` : '%';

    const query = `
        SELECT * FROM clientes
        WHERE nombre LIKE ?;
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los clientes:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los clientes" });
        }
        res.json({ success: true, data: results });
    });
};

const actualizarCliente = async (req, res) => {
    const clienteId = req.params.id;
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

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

            // Si el cliente existe, proceder con la actualización
            const updateQuery = `
                UPDATE clientes 
                SET nombre = ?, condicion_iva = ?, cuit = ?, dni = ?, direccion = ?, ciudad = ?, provincia = ?, telefono = ?, email = ? 
                WHERE id = ?
            `;

            db.query(updateQuery, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, clienteId], async (error, updateResults) => {
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

                res.json({ success: true, message: "Cliente actualizado correctamente" });
            });
        });
    } catch (error) {
        console.error('Error al obtener datos anteriores:', error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};

const nuevoProveedor = async (req, res) => {
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    if (!nombre || !condicion_iva || !cuit || !dni || !direccion || !ciudad || !provincia || !telefono || email === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const query = `
        INSERT INTO proveedores (nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email], async (err, results) => {
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
                ...req.body
            },
            detallesAdicionales: `Proveedor creado: ${nombre}`
        });
        
        res.json({ success: true, message: "Proveedor agregado correctamente", data: results });
    });
};

const buscarProveedor = (req, res) => {
    const searchTerm = req.query.search ? `%${req.query.search}%` : '%';

    const query = `
        SELECT * FROM proveedores
        WHERE nombre LIKE ?;
    `;

    db.query(query, [searchTerm], (err, results) => {
        if (err) {
            console.error('Error al obtener los proveedores:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los proveedores" });
        }
        res.json({ success: true, data: results });
    });
};

const actualizarProveedor = async (req, res) => {
    const proveedorId = req.params.id;
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    if (!nombre || !condicion_iva || !cuit || !dni || !direccion || !ciudad || !provincia || !telefono || email === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

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
                SET nombre = ?, condicion_iva = ?, cuit = ?, dni = ?, direccion = ?, ciudad = ?, provincia = ?, telefono = ?, email = ? 
                WHERE id = ?
            `;

            db.query(updateQuery, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, proveedorId], async (error, updateResults) => {
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
                        ...req.body
                    },
                    detallesAdicionales: `Proveedor actualizado: ${nombre}`
                });

                res.json({ success: true, message: "Proveedor actualizado correctamente" });
            });
        });
    } catch (error) {
        console.error('Error al obtener datos anteriores:', error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};

module.exports = {
    nuevoCliente,
    actualizarCliente,
    buscarCliente,
    nuevoProveedor, 
    buscarProveedor,
    actualizarProveedor
};