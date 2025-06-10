const db = require('./db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');


// Definir la ruta de almacenamiento para los comprobantes
const comprobantesPath = path.join(__dirname, "../storage/comprobantes");
// Si no existe la carpeta, la crea
if (!fs.existsSync(comprobantesPath)) {
    fs.mkdirSync(comprobantesPath, { recursive: true });
}

// Configuración de multer para guardar los archivos
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
    limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB
    fileFilter: (req, file, cb) => {
        // Verificar tipos de archivo permitidos
        const filetypes = /jpeg|jpg|png|pdf/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        
        cb(new Error("El archivo debe ser una imagen (JPG, PNG) o un PDF"));
    }
}).single("comprobante");



// Función para obtener todas las compras
const obtenerCompras = (req, res) => {
    const query = `
        SELECT * FROM compras
        ORDER BY fecha DESC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener compras:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener compras" 
            });
        }
        res.json({ 
            success: true, 
            data: results 
        });
    });
};

// Función para obtener todos los gastos
const obtenerGastos = (req, res) => {
    const query = `
        SELECT * FROM gastos
        ORDER BY fecha ASC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error al obtener gastos:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener gastos" 
            });
        }
        res.json({ 
            success: true, 
            data: results 
        });
    });
};

// Función para obtener un gasto específico
const obtenerGasto = (req, res) => {
    const gastoId = req.params.gastoId;
    
    const query = `
        SELECT * FROM gastos
        WHERE id = ?
    `;
    
    db.query(query, [gastoId], (err, results) => {
        if (err) {
            console.error('Error al obtener el gasto:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener el gasto" 
            });
        }
        
        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Gasto no encontrado"
            });
        }
        
        res.json({ 
            success: true, 
            data: results[0] 
        });
    });
};

// Función para obtener los productos de una compra (CORREGIDA)
const obtenerProductosCompra = (req, res) => {
    const compraId = req.params.compraId;
    
    const query = `
        SELECT 
            compra_id, producto_id, producto_nombre, producto_um, cantidad, costo, precio, IVA, subtotal
        FROM compras_cont 
        WHERE compra_id = ?
    `;
    
    db.query(query, [compraId], (err, results) => {
        if (err) {
            console.error('Error al obtener productos de la compra:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al obtener productos de la compra" 
            });
        }
        // Siempre devolvemos un array como respuesta, incluso si está vacío
        res.json(results || []);
    });
};



const nuevoGasto = (req, res) => {
    const { descripcion, monto, formaPago, observaciones, empleadoId } = req.body;
    
    const query = `
        INSERT INTO gastos (fecha, descripcion, monto, forma_pago, observaciones, empleado_id)
        VALUES (NOW(), ?, ?, ?, ?, ?)
    `;
    
    db.query(query, [descripcion, monto, formaPago, observaciones, empleadoId], (err, results) => {
        if (err) {
            console.error('Error al crear el gasto:', err);
            return res.status(500).json({ 
                success: false, 
                message: "Error al crear el gasto" 
            });
        }
        
        res.json({ 
            success: true, 
            message: "Gasto creado exitosamente", 
            data: { id: results.insertId } 
        });
    });
};




module.exports = {
    obtenerGastos,
    obtenerGasto,
    obtenerCompras,
    obtenerProductosCompra,
    nuevoGasto
    
    
};
    
