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

// Buscar ciudades por nombre (para autocomplete)
const buscarCiudades = (req, res) => {
    let searchTerm = req.query.q || req.query.search || '';

    // Si no hay término de búsqueda o es muy corto, no buscar
    if (searchTerm.length < 2) {
        return res.json({ success: true, data: [] });
    }

    // Normalizar el término de búsqueda: convertir a minúsculas y eliminar caracteres especiales
    searchTerm = searchTerm.toLowerCase().trim();

    // Crear un patrón de búsqueda más flexible
    // Dividir el término por espacios para buscar cada palabra
    const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
    
    // Construir las condiciones LIKE para cada palabra
    // Si buscamos "inten alve", debe encontrar "intendente alvear"
    const conditions = searchWords.map(() => `LOWER(TRIM(REPLACE(REPLACE(c.nombre, ',', ''), '-', ' '))) LIKE ?`).join(' AND ');
    
    // Construir los parámetros para el LIKE
    const likeParams = searchWords.map(word => `%${word}%`);

    const query = `
        SELECT c.id, c.nombre, c.id_zona, z.nombre as zona_nombre
        FROM ciudades c
        LEFT JOIN zonas z ON c.id_zona = z.id
        WHERE ${conditions}
        ORDER BY c.nombre ASC
        LIMIT 20
    `;

    db.query(query, likeParams, (err, results) => {
        if (err) {
            console.error('Error al buscar ciudades:', err);
            return res.status(500).json({
                success: false,
                message: "Error al buscar ciudades"
            });
        }

        res.json({ success: true, data: results });
    });
};

module.exports = {
    listarCiudades,
    obtenerCiudadPorId,
    buscarCiudades
};