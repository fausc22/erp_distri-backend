// controllers/ciudadesController.js - CREAR ESTE NUEVO ARCHIVO

const db = require('./db');

// Listar todas las ciudades con sus zonas
const listarCiudades = (req, res) => {
    const query = `
        SELECT c.id, c.nombre, c.id_zona, z.nombre as zona_nombre
        FROM ciudades c
        LEFT JOIN zonas z ON c.id_zona = z.id
        ORDER BY c.nombre ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener las ciudades:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener las ciudades" 
            });
        }
        res.json({ success: true, data: results });
    });
};

// Obtener una ciudad por ID
const obtenerCiudadPorId = (req, res) => {
    const ciudadId = req.params.id;

    const query = `
        SELECT c.id, c.nombre, c.id_zona, z.nombre as zona_nombre
        FROM ciudades c
        LEFT JOIN zonas z ON c.id_zona = z.id
        WHERE c.id = ?
    `;

    db.query(query, [ciudadId], (err, results) => {
        if (err) {
            console.error('Error al obtener la ciudad:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener la ciudad" 
            });
        }

        if (results.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Ciudad no encontrada" 
            });
        }

        res.json({ success: true, data: results[0] });
    });
};

module.exports = {
    listarCiudades,
    obtenerCiudadPorId
};