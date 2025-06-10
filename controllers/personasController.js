const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');




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




module.exports = {
    nuevoCliente,
    actualizarCliente,
    buscarCliente,
    nuevoProveedor, 
    buscarProveedor,
    actualizarProveedor
    
};