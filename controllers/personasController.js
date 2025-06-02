const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const bcrypt = require('bcryptjs');
const dbPromise = require('./dbPromise');


const nuevoCliente = (req, res) => {
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    

    const query = `
        INSERT INTO clientes (nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email], (err, results) => {
        if (err) {
            console.error('Error al insertar el cliente:', err);
            return res.status(500).json({ success: false, message: "Error al insertar el cliente" });
        }
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

const actualizarCliente = (req, res) => {
    const clienteId = req.params.id;
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    

    // Verificar si el producto existe antes de actualizar
    const checkQuery = `SELECT id FROM clientes WHERE id = ?`;
    db.query(checkQuery, [clienteId], (err, results) => {
        if (err) {
            console.error('Error al verificar el cliente:', err);
            return res.status(500).json({ success: false, message: "Error al verificar el cliente" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Cliente no encontrado" });
        }

        // Si el producto existe, proceder con la actualización
        const updateQuery = `
            UPDATE clientes 
            SET nombre = ?, condicion_iva = ?, cuit = ?, dni = ?, direccion = ?, ciudad = ?, provincia = ?, telefono = ?, email = ? 
            WHERE id = ?
        `;

        db.query(updateQuery, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, clienteId], (error, updateResults) => {
            if (error) {
                console.error('Error al actualizar el cliente:', error);
                return res.status(500).json({ success: false, message: "Error al actualizar el cliente" });
            }

            if (updateResults.affectedRows === 0) {
                return res.status(400).json({ success: false, message: "No se realizaron cambios" });
            }

            res.json({ success: true, message: "Cliente actualizado correctamente" });
        });
    });
};



const nuevoProveedor = (req, res) => {
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    if (!nombre || !condicion_iva || !cuit || !dni || !direccion || !ciudad || !provincia || !telefono || email === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    const query = `
        INSERT INTO proveedores (nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email], (err, results) => {
        if (err) {
            console.error('Error al insertar el proveedor:', err);
            return res.status(500).json({ success: false, message: "Error al insertar el proveedor" });
        }
        res.json({ success: true, message: "proveedor agregado correctamente", data: results });
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
            console.error('Error al obtener los proveedor:', err);
            return res.status(500).json({ success: false, message: "Error al obtener los proveedor" });
        }
        res.json({ success: true, data: results });
    });
};

const actualizarProveedor = (req, res) => {
    const clienteId = req.params.id;
    const { nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email } = req.body;

    if (!nombre || !condicion_iva || !cuit || !dni || !direccion || !ciudad || !provincia || !telefono || email === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
    }

    // Verificar si el producto existe antes de actualizar
    const checkQuery = `SELECT id FROM proveedores WHERE id = ?`;
    db.query(checkQuery, [clienteId], (err, results) => {
        if (err) {
            console.error('Error al verificar el proveedor:', err);
            return res.status(500).json({ success: false, message: "Error al verificar el proveedor" });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "proveedor no encontrado" });
        }

        // Si el producto existe, proceder con la actualización
        const updateQuery = `
            UPDATE proveedores 
            SET nombre = ?, condicion_iva = ?, cuit = ?, dni = ?, direccion = ?, ciudad = ?, provincia = ?, telefono = ?, email = ? 
            WHERE id = ?
        `;

        db.query(updateQuery, [nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email, clienteId], (error, updateResults) => {
            if (error) {
                console.error('Error al actualizar el proveedor:', error);
                return res.status(500).json({ success: false, message: "Error al actualizar el proveedor" });
            }

            if (updateResults.affectedRows === 0) {
                return res.status(400).json({ success: false, message: "No se realizaron cambios" });
            }

            res.json({ success: true, message: "proveedor actualizado correctamente" });
        });
    });
};


const crearEmpleado = async (req, res) => {
    try {
        const { 
            nombre, 
            apellido, 
            dni, 
            telefono, 
            email, 
            usuario, 
            password, 
            rol 
        } = req.body;

        // Validaciones básicas
        if (!nombre || !apellido || !usuario || !password || !rol) {
            return res.status(400).json({ 
                message: 'Los campos nombre, apellido, usuario, contraseña y rol son obligatorios' 
            });
        }

        // Validar rol
        if (!['GERENTE', 'VENDEDOR'].includes(rol)) {
            return res.status(400).json({ 
                message: 'El rol debe ser GERENTE o VENDEDOR' 
            });
        }

        // Validar longitud de contraseña
        if (password.length < 6) {
            return res.status(400).json({ 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        // Verificar si el usuario ya existe
        const [usuariosExistentes] = await db.execute(
            'SELECT id FROM empleados WHERE usuario = ?', 
            [usuario]
        );
        if (usuariosExistentes.length > 0) {
            return res.status(400).json({ message: 'El usuario ya existe' });
        }

        // Verificar si el DNI ya existe (si se proporciona)
        if (dni) {
            const [dniExistente] = await db.execute(
                'SELECT id FROM empleados WHERE dni = ?', 
                [dni]
            );
            if (dniExistente.length > 0) {
                return res.status(400).json({ message: 'El DNI ya está registrado' });
            }
        }

        // Encriptar contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insertar empleado
        const query = `
            INSERT INTO empleados (nombre, apellido, dni, telefono, email, usuario, password, rol) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const [result] = await db.execute(query, [
            nombre.trim(),
            apellido.trim(),
            dni?.trim() || null,
            telefono?.trim() || null,
            email?.trim() || null,
            usuario.trim(),
            hashedPassword,
            rol
        ]);

        res.status(201).json({ 
            message: 'Empleado creado exitosamente',
            id: result.insertId
        });

    } catch (error) {
        console.error('Error al crear empleado:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Buscar empleados
const buscarEmpleado = async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length < 1) {
            return res.json([]);
        }

        const searchTerm = `%${q.trim()}%`;

        const query = `
            SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo
            FROM empleados 
            WHERE (nombre LIKE ? OR apellido LIKE ? OR usuario LIKE ? OR CONCAT(nombre, ' ', apellido) LIKE ?)
            AND activo = 1
            ORDER BY nombre, apellido
            LIMIT 50
        `;

        const [empleados] = await db.execute(query, [searchTerm, searchTerm, searchTerm, searchTerm]);

        // Añadir campo nombre completo para facilitar la búsqueda
        const empleadosConNombreCompleto = empleados.map(emp => ({
            ...emp,
            nombre_completo: `${emp.nombre} ${emp.apellido}`
        }));

        res.json(empleadosConNombreCompleto);

    } catch (error) {
        console.error('Error al buscar empleados:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Actualizar empleado
const actualizarEmpleado = async (req, res) => {
    try {
        const { id } = req.body;
        const { 
            nombre, 
            apellido, 
            dni, 
            telefono, 
            email, 
            usuario, 
            password, 
            rol 
        } = req.body;

        if (!id) {
            return res.status(400).json({ message: 'ID del empleado es requerido' });
        }

        // Validaciones básicas
        if (!nombre || !apellido || !usuario || !rol) {
            return res.status(400).json({ 
                message: 'Los campos nombre, apellido, usuario y rol son obligatorios' 
            });
        }

        // Validar rol
        if (!['GERENTE', 'VENDEDOR'].includes(rol)) {
            return res.status(400).json({ 
                message: 'El rol debe ser GERENTE o VENDEDOR' 
            });
        }

        // Verificar que el empleado existe
        const [empleadoExistente] = await db.execute(
            'SELECT id FROM empleados WHERE id = ?', 
            [id]
        );
        if (empleadoExistente.length === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        // Verificar si el usuario ya existe en otro empleado
        const [usuarioExistente] = await db.execute(
            'SELECT id FROM empleados WHERE usuario = ? AND id != ?', 
            [usuario, id]
        );
        if (usuarioExistente.length > 0) {
            return res.status(400).json({ message: 'El usuario ya está en uso por otro empleado' });
        }

        // Verificar si el DNI ya existe en otro empleado (si se proporciona)
        if (dni) {
            const [dniExistente] = await db.execute(
                'SELECT id FROM empleados WHERE dni = ? AND id != ?', 
                [dni, id]
            );
            if (dniExistente.length > 0) {
                return res.status(400).json({ message: 'El DNI ya está registrado por otro empleado' });
            }
        }

        let query;
        let params;

        // Si se proporciona nueva contraseña, actualizarla también
        if (password && password.trim().length > 0) {
            if (password.length < 6) {
                return res.status(400).json({ 
                    message: 'La contraseña debe tener al menos 6 caracteres' 
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            
            query = `
                UPDATE empleados 
                SET nombre = ?, apellido = ?, dni = ?, telefono = ?, email = ?, usuario = ?, password = ?, rol = ?
                WHERE id = ?
            `;
            params = [
                nombre.trim(),
                apellido.trim(),
                dni?.trim() || null,
                telefono?.trim() || null,
                email?.trim() || null,
                usuario.trim(),
                hashedPassword,
                rol,
                id
            ];
        } else {
            // Actualizar sin cambiar la contraseña
            query = `
                UPDATE empleados 
                SET nombre = ?, apellido = ?, dni = ?, telefono = ?, email = ?, usuario = ?, rol = ?
                WHERE id = ?
            `;
            params = [
                nombre.trim(),
                apellido.trim(),
                dni?.trim() || null,
                telefono?.trim() || null,
                email?.trim() || null,
                usuario.trim(),
                rol,
                id
            ];
        }

        await db.execute(query, params);

        res.json({ message: 'Empleado actualizado exitosamente' });

    } catch (error) {
        console.error('Error al actualizar empleado:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Listar todos los empleados (para gerentes)
const listarEmpleados = async (req, res) => {
    try {
        const [empleados] = await db.execute(`
            SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo, fecha_creacion
            FROM empleados 
            WHERE activo = 1
            ORDER BY nombre, apellido
        `);

        res.json(empleados);

    } catch (error) {
        console.error('Error al listar empleados:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Obtener empleado por ID
const obtenerEmpleado = async (req, res) => {
    try {
        const { id } = req.params;

        const [empleados] = await db.execute(
            'SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo FROM empleados WHERE id = ?',
            [id]
        );

        if (empleados.length === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        res.json(empleados[0]);

    } catch (error) {
        console.error('Error al obtener empleado:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Desactivar empleado (soft delete)
const desactivarEmpleado = async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir que un empleado se desactive a sí mismo
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta' });
        }

        const [result] = await db.execute(
            'UPDATE empleados SET activo = 0 WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        res.json({ message: 'Empleado desactivado exitosamente' });

    } catch (error) {
        console.error('Error al desactivar empleado:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    nuevoCliente,
    actualizarCliente,
    buscarCliente,
    nuevoProveedor, 
    buscarProveedor,
    actualizarProveedor,
    crearEmpleado,
    buscarEmpleado,
    actualizarEmpleado,
    listarEmpleados,
    obtenerEmpleado,
    desactivarEmpleado
};